import { z } from "zod";
import { words } from "./proof.js";
import type { ExtractedAssertion, VerificationKind } from "./types.js";

// Etiquetas del corpus documental del Plan 20/20 (M03 recuperación, M04 precisión).
// Una etiqueta describe un hecho que un documento congelado respalda (positivo) o
// una atribución que no debe emitirse como documentada (negativo).
const term=z.string().trim().min(1);
export const corpusLabelsSchema=z.object({
  version:z.string(),
  frozenAt:z.string(),
  reviewStatus:z.enum(["implementation_labels_pending_curator","curator_reviewed"]),
  entities:z.array(z.object({
    kind:z.enum(["artist","person","album","organization","track"]),
    id:z.number().int().positive(),
    name:z.string(),
    partition:z.enum(["development","reserved"]),
    /** Frozen copies: each file is a serialized page whose content hash is checked before reading. */
    documents:z.array(z.object({id:term,file:term,url:z.string(),sha256:z.string().regex(/^[0-9a-f]{64}$/u),format:z.enum(["html","structured","rendered","pdf","ocr"])})).min(1),
    positives:z.array(z.object({
      id:term,area:z.string(),documentId:term,
      /** All terms must appear in the emitted value or context; "a|b" accepts either alternative. */
      match:z.array(term).min(1),
      quote:term,critical:z.boolean(),scope:z.enum(["identity","edition","chronology","other"]),
      reviewed:z.boolean().default(false),
    })),
    negatives:z.array(z.object({
      id:term,type:z.enum(["identity","edition","chronology","unofficial_link","wrong_image","insufficient_citation","untrusted_instruction"]),
      match:z.array(term).min(1),reason:term,
      reviewed:z.boolean().default(false),
    })),
  })),
});
export type CorpusLabels=z.infer<typeof corpusLabelsSchema>;
type Entity=CorpusLabels["entities"][number];

const normalized=(value:string)=>` ${words(value)} `;
// A term may list alternatives separated by "|" (e.g. "marzo 2000|2000-03"): emitted values are often normalized.
const containsAll=(text:string,terms:string[])=>{const haystack=normalized(text);return terms.every(t=>t.split("|").some(alt=>alt.trim()&&haystack.includes(normalized(alt))));};
const emittedText=(item:ExtractedAssertion)=>[item.value??"",...item.context,item.key??""].join(" ");
/** Facts the report presents as documented: a valid citation and a non-discarded destination. */
export const documented=(item:ExtractedAssertion)=>item.state!=="invalid"&&item.destination!=="discarded"&&item.evidence.some(e=>e.valid);

export interface EntityScore{
  kind:VerificationKind;id:number;name:string;partition:Entity["partition"];
  positives:number;recovered:number;criticalPositives:number;criticalRecovered:number;
  missed:Array<{id:string;critical:boolean;scope:string;area:string}>;
  emitted:number;emittedMatchingPositives:number;negativeHits:Array<{id:string;type:string;value:string|null}>;
  traced:number;extracted:number;
  byArea:Record<string,{positives:number;recovered:number}>;byFormat:Record<string,{positives:number;recovered:number}>;
}

/** Deterministic scoring: a positive is recovered when a documented assertion cites its document and names all its terms. */
export function scoreEntity(entity:Entity,extractions:ExtractedAssertion[]):EntityScore{
  const urlOf=new Map(entity.documents.map(d=>[d.id,d.url]));
  const formatOf=new Map(entity.documents.map(d=>[d.id,d.format]));
  const emitted=extractions.filter(documented);
  // A synthetic injection variant is the same document plus one inserted passage: a valid citation of it
  // (never one inside the injection, which the citation check rejects) cites the original's words.
  const sameDocument=(url:string|null,original:string|undefined)=>!!url&&url.replace(/#corpus-injection-[^#]*$/u,"")===original;
  const recoveredBy=(positive:Entity["positives"][number])=>emitted.filter(item=>item.evidence.some(e=>e.valid&&sameDocument(e.url,urlOf.get(positive.documentId)))&&containsAll(emittedText(item),positive.match));
  const byArea:EntityScore["byArea"]={},byFormat:EntityScore["byFormat"]={};
  const missed:EntityScore["missed"]=[];
  const matching=new Set<ExtractedAssertion>();
  let recovered=0,criticalRecovered=0;
  for(const positive of entity.positives){
    const hits=recoveredBy(positive);hits.forEach(hit=>matching.add(hit));
    const area=byArea[positive.area]??={positives:0,recovered:0};
    const format=byFormat[formatOf.get(positive.documentId)??"html"]??={positives:0,recovered:0};
    area.positives++;format.positives++;
    if(hits.length){recovered++;area.recovered++;format.recovered++;if(positive.critical)criticalRecovered++;}
    else missed.push({id:positive.id,critical:positive.critical,scope:positive.scope,area:positive.area});
  }
  const negativeHits=entity.negatives.flatMap(negative=>emitted.filter(item=>containsAll(emittedText(item),negative.match)).map(item=>({id:negative.id,type:negative.type,value:item.value})));
  // M02 traceability: every extracted assertion carries a state, a source and a destination.
  const traced=extractions.filter(item=>item.state&&item.destination&&item.evidence.length>0&&item.evidence.every(e=>e.url||e.reason)).length;
  return {kind:entity.kind,id:entity.id,name:entity.name,partition:entity.partition,positives:entity.positives.length,recovered,
    criticalPositives:entity.positives.filter(p=>p.critical).length,criticalRecovered,missed,emitted:emitted.length,emittedMatchingPositives:matching.size,
    negativeHits,traced,extracted:extractions.length,byArea,byFormat};
}

export function summarize(scores:EntityScore[]){
  const sum=(pick:(s:EntityScore)=>number)=>scores.reduce((n,s)=>n+pick(s),0);
  const positives=sum(s=>s.positives),recovered=sum(s=>s.recovered),critical=sum(s=>s.criticalPositives),criticalRecovered=sum(s=>s.criticalRecovered);
  const extracted=sum(s=>s.extracted),traced=sum(s=>s.traced);
  const merge=(key:"byArea"|"byFormat")=>{const out:Record<string,{positives:number;recovered:number;recall:number|null}>={};
    for(const s of scores)for(const [k,v] of Object.entries(s[key])){const o=out[k]??={positives:0,recovered:0,recall:null};o.positives+=v.positives;o.recovered+=v.recovered;}
    for(const o of Object.values(out))o.recall=o.positives?o.recovered/o.positives:null;return out;};
  return {
    entities:scores.length,positives,recovered,
    // A metric over an empty denominator is not evaluated, never a pass.
    m03Recall:positives?recovered/positives:null,m03CriticalRecall:critical?criticalRecovered/critical:null,
    m02Traceability:extracted?traced/extracted:null,
    negativeHits:sum(s=>s.negativeHits.length),emitted:sum(s=>s.emitted),emittedMatchingPositives:sum(s=>s.emittedMatchingPositives),
    byArea:merge("byArea"),byFormat:merge("byFormat"),
  };
}
