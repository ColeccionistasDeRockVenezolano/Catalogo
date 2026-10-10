import { z } from "zod";
import { getEnv } from "../config/env.js";
import { recommendationIntentSchema, RECOMMENDATION_VERSION, type RecommendationIntent } from "./recommendation-contract.js";

const GROUPS = {
  context: {concentration:"Music to concentrate or study. Música para estudiar y concentrarse.",relaxation:"Music to relax or rest. Música para relajarme.",celebration:"Music to celebrate a party. Música para celebrar una fiesta.",none:"No context specified."},
  mood: {joyful:"Música alegre.",melancholic:"Música melancólica.",tense:"Música tensa.",serene:"Música serena.",none:"Ningún ánimo musical solicitado."},
  energy: {"energy-low":"Intensidad musical baja.","energy-medium":"Intensidad musical media.","energy-high":"Intensidad musical alta.",none:"No especifica intensidad musical."},
};
type Group = keyof typeof GROUPS;
export function intentQuestions() {
  return {
    context:{type:"choice",instructions:"What context does the user request music for? Choose none if absent.",criteria:GROUPS.context},
    mood:{type:"choice",instructions:"¿Qué carácter musical pide la persona? No deduzcas de otros criterios.",criteria:GROUPS.mood},
    energy:{type:"choice",instructions:"¿Qué intensidad musical solicita explícitamente?",criteria:GROUPS.energy},
  };
}
// Bound semantic classification to explicit spans. Unknown words can contain a
// restriction (artist, genre, dates, OR, duration); never silently discard them.
const PATTERNS: [Group,string,RegExp][] = [
  ["context","concentration",/\b(?:concentracion|concentrar(?:me|se|nos)?|concentrad[oa]s?|estudiar|estudiando)\b/g],
  ["context","relaxation",/\b(?:relajacion|relajante?s?|relajar(?:me|se|nos)?|relajad[oa]s?|descansar|descanso)\b/g],
  ["context","celebration",/\b(?:celebrar|celebracion|fiestas?)\b/g],
  ["mood","joyful",/\b(?:alegres?|alegria)\b/g], ["mood","melancholic",/\b(?:melancolia|melancolic[oa]s?)\b/g],
  ["mood","tense",/\b(?:tens[oa]s?|tension)\b/g], ["mood","serene",/\b(?:seren[oa]s?|serenidad)\b/g],
  ["energy","energy-low",/\b(?:energia|intensidad)\s+baj[oa]s?\b/g],
  ["energy","energy-medium",/\b(?:energia|intensidad)\s+medi[oa]s?\b/g],
  ["energy","energy-high",/\b(?:energia|intensidad)\s+alt[oa]s?\b/g],
];
const FILLERS = new Set("recomiendame recomienda recomendarme quiero quisiera necesito busco dame ponme musica musical musicales cancion canciones temas piezas una un unas unos de del la el las los para por al a en y con que sean sea caracter oir escuchar me mi ahora favor".split(" "));
interface Span {text:string;excluded:boolean;groups:Partial<Record<Group,string>>}
export function explicitRequestSpans(text:string): Span[] | null {
  const normalized=text.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
  // A single final negative clause is supported. Complex scope/alternatives
  // require an explicit structured intent instead of a guessed interpretation.
  const parts=normalized.split(/\b(?:sin|evita|excluye|no quiero)\b/);
  if (parts.length>2 || (parts[1] && /[,;:]/u.test(parts[1]))) return null;
  const spans:Span[]=[];
  for (const [i,part] of parts.entries()) {
    let remaining=part;
    const found:Partial<Record<Group,string>>={};
    for (const [group,label,pattern] of PATTERNS) {
      if (part.match(pattern)) {
        if (found[group] && found[group]!==label) return null;
        found[group]=label; remaining=remaining.replace(pattern," ");
      }
    }
    const words=remaining.replace(/[.,!?¿¡]/gu," ").trim().split(/\s+/u).filter(Boolean);
    if (words.some(w=>!FILLERS.has(w))) return null;
    if (Object.keys(found).length) spans.push({text:part.trim(),excluded:i>0,groups:found});
  }
  return spans.length ? spans : null;
}
const answerSchema=z.object({choice:z.string(),probabilities:z.record(z.number().min(0).max(1))}).passthrough();
const resultSchema=z.object({model:z.string().min(1),answers:z.record(answerSchema),routing:z.unknown().optional()}).passthrough();
export interface Interpretation {
  intent:RecommendationIntent|null; status:"interpreted"|"unsupported"|"uncertain"|"unavailable";
  model:string|null; version:string; decisions?:unknown; routing?:unknown;
}
export function decodeIntent(raw:unknown,threshold:number,expected?:Partial<Record<Group,string>>):Interpretation {
  const result=resultSchema.parse(raw);
  const base={model:result.model,version:RECOMMENDATION_VERSION,
    decisions:Object.fromEntries(Object.entries(result.answers).map(([k,a])=>[k,{choice:a.choice,probabilities:a.probabilities}])),routing:result.routing ?? null};
  const requiredLabels:string[]=[];
  for (const group of Object.keys(GROUPS) as Group[]) {
    if (expected && !expected[group]) continue;
    const a=result.answers[group],options=GROUPS[group];
    if (!a || !Object.hasOwn(options,a.choice) || Object.keys(a.probabilities).length!==Object.keys(options).length ||
      Object.keys(a.probabilities).some(k=>!Object.hasOwn(options,k)) ||
      Math.abs(Object.values(a.probabilities).reduce((sum,p)=>sum+p,0)-1)>0.01 ||
      a.probabilities[a.choice]!==Math.max(...Object.values(a.probabilities))) throw new Error("Respuesta tipada inválida");
    if ((a.probabilities[a.choice] ?? 0)<threshold || (expected && expected[group]!==a.choice)) return {...base,intent:null,status:"uncertain"};
    if (a.choice!=="none") requiredLabels.push(a.choice);
  }
  if (!requiredLabels.length) return {...base,intent:null,status:"uncertain"};
  return {...base,intent:recommendationIntentSchema.parse({requiredLabels}),status:"interpreted"};
}
let inFlight=0;
export async function interpretRecommendation(text:string,fetcher:typeof fetch=fetch):Promise<Interpretation> {
  const env=getEnv(),base={intent:null,model:null,version:RECOMMENDATION_VERSION} as const;
  if (text.length>1000 || !text.trim()) return {...base,status:"unsupported"};
  if (env.CRV_RECOMMENDATION_PROVIDER==="disabled" || inFlight>=2) return {...base,status:"unavailable"};
  const spans=explicitRequestSpans(text);
  if (!spans) return {...base,status:"unsupported"};
  const requiredLabels:string[]=[],excludedLabels:string[]=[],decisions:unknown[]=[],routing:unknown[]=[];
  let model:string|null=null;
  inFlight++;
  try {
    const signal=AbortSignal.timeout(env.CRV_RECOMMENDATION_TIMEOUT_MS);
    for (const span of spans) {
      const response=await fetcher(new URL("v1/systemone",env.CRV_RECOMMENDATION_BASE_URL.endsWith("/") ? env.CRV_RECOMMENDATION_BASE_URL : `${env.CRV_RECOMMENDATION_BASE_URL}/`),{
        method:"POST",signal,headers:{"content-type":"application/json",...(env.CRV_RECOMMENDATION_API_KEY ? {authorization:`Bearer ${env.CRV_RECOMMENDATION_API_KEY}`} : {})},
        body:JSON.stringify({model:env.CRV_RECOMMENDATION_MODEL,state:span.text,questions:intentQuestions()}),
      });
      if (!response.ok) return {...base,status:"unavailable"};
      const reader=response.body?.getReader(); if (!reader) return {...base,status:"unavailable"};
      const chunks:Uint8Array[]=[];let size=0;
      while(true) {
        const {done,value}=await reader.read();if(done)break;
        size+=value.length;if(size>100000){await reader.cancel();return {...base,status:"unavailable"};}chunks.push(value);
      }
      const decoded=decodeIntent(JSON.parse(Buffer.concat(chunks).toString("utf8")),env.CRV_RECOMMENDATION_THRESHOLD,span.groups);
      model=decoded.model;decisions.push({excluded:span.excluded,decisions:decoded.decisions});routing.push(decoded.routing);
      if (!decoded.intent) return {...base,model,decisions,routing,status:"uncertain"};
      (span.excluded ? excludedLabels : requiredLabels).push(...decoded.intent.requiredLabels);
    }
    const intent=recommendationIntentSchema.safeParse({requiredLabels,excludedLabels});
    return intent.success ? {...base,model,decisions,routing,intent:intent.data,status:"interpreted"} : {...base,model,decisions,routing,status:"uncertain"};
  } catch {return {...base,status:"unavailable"};} finally {inFlight--;}
}
