import { z } from "zod";
import { recommendationRequestSchema, CONTEXTS } from "./recommendation-contract.js";
import { recommend } from "./recommendations.js";
import { interpretRecommendation } from "./recommendation-interpreter.js";

const reviewedCase = z.object({
  key:z.string().min(1), reviewer:z.string().trim().min(1), rationale:z.string().trim().min(1),
  request:recommendationRequestSchema,
  relevantTrackIds:z.array(z.number().int().positive().safe()),
  expectAbstention:z.boolean(),
}).strict().refine(x=>!x.expectAbstention || x.relevantTrackIds.length===0,"Caso de abstención sin pistas relevantes");
export const recommendationEvaluationSchema=z.object({
  name:z.string().min(1), reviewedAt:z.string().datetime({offset:true}),
  cases:z.array(reviewedCase).min(1).max(100),
}).strict().refine(x=>new Set(x.cases.map(c=>c.key)).size===x.cases.length,"Claves de caso repetidas");
type Response = Awaited<ReturnType<typeof recommend>>;
export function evaluateRecommendationCase(gold:z.infer<typeof reviewedCase>, response:Response) {
  const ids=response.results.map(x=>Number(x.id));
  const pertinent=ids.filter(id=>gold.relevantTrackIds.includes(id)).length;
  const abstained=response.status==="abstained" || response.status==="insufficient_coverage";
  const excluded=response.effectiveIntent?.excludeTrackIds ?? [];
  return {key:gold.key,reviewer:gold.reviewer,rationale:gold.rationale,status:response.status,
    delivered:ids.length,pertinent,pertinence:ids.length ? pertinent/ids.length : null,
    coverage:gold.relevantTrackIds.length ? pertinent/gold.relevantTrackIds.length : null,
    fulfillment:ids.length/gold.request.limit,diversity:response.diversity,
    abstained,correctAbstention:gold.expectAbstention===abstained && response.status!=="disabled",
    duplicates:ids.length-new Set(ids).size,
    excludedReturned:ids.filter(x=>excluded.includes(x)),response};
}
export async function evaluateRecommendations(input:unknown,runner:typeof recommend=recommend) {
  const suite=recommendationEvaluationSchema.parse(input), cases:ReturnType<typeof evaluateRecommendationCase>[]=[];
  for (const gold of suite.cases) cases.push(evaluateRecommendationCase(gold,await runner(gold.request,gold.reviewer,false)));
  const delivered=cases.reduce((n,c)=>n+c.delivered,0), pertinent=cases.reduce((n,c)=>n+c.pertinent,0);
  const mean=(key:"coverage"|"diversity")=> {
    const values=cases.map(c=>c[key]).filter((v):v is number=>v!==null);
    return values.length ? values.reduce((n,v)=>n+v,0)/values.length : null;
  };
  return {name:suite.name,reviewedAt:suite.reviewedAt,evaluatedAt:new Date().toISOString(),
    summary:{cases:cases.length,delivered,pertinence:delivered ? pertinent/delivered : null,
      coverage:mean("coverage"),diversity:mean("diversity"),abstentions:cases.filter(c=>c.abstained).length,
      correctAbstentionDecisions:cases.filter(c=>c.correctAbstention).length,disabled:cases.filter(c=>c.status==="disabled").length},cases};
}

const interpretationSuiteSchema=z.object({
  name:z.string().min(1),reviewedAt:z.string().datetime({offset:true}),
  cases:z.array(z.object({key:z.string().min(1),reviewer:z.string().trim().min(1),rationale:z.string().trim().min(1),
    text:z.string().trim().min(1).max(1000),requiredLabels:z.array(z.enum(CONTEXTS)),excludedLabels:z.array(z.enum(CONTEXTS)),expectAbstention:z.boolean(),
  }).strict()).min(1).max(100),
}).strict().refine(x=>new Set(x.cases.map(c=>c.key)).size===x.cases.length,"Claves repetidas");
export async function evaluateInterpretations(input:unknown,interpreter=interpretRecommendation) {
  const suite=interpretationSuiteSchema.parse(input),cases=[];
  for (const gold of suite.cases) {
    const result=await interpreter(gold.text);
    const equal=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
    const unavailable=result.status==="unavailable";
    const abstained=result.intent===null && !unavailable;
    const exact=!unavailable && (gold.expectAbstention ? abstained : result.intent!==null && equal(gold.requiredLabels,result.intent.requiredLabels) && equal(gold.excludedLabels,result.intent.excludedLabels));
    cases.push({...gold,result,exact,abstained,unavailable});
  }
  const correct=cases.filter(c=>c.exact).length;
  return {name:suite.name,reviewedAt:suite.reviewedAt,evaluatedAt:new Date().toISOString(),
    summary:{cases:cases.length,correct,accuracy:correct/cases.length,abstentions:cases.filter(c=>c.abstained).length,
      unavailable:cases.filter(c=>c.unavailable).length,unsafeInterpretations:cases.filter(c=>c.expectAbstention && !c.abstained && !c.unavailable).length},cases};
}
