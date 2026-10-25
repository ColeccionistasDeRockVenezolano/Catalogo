import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashText } from "./review-protocol.js";
const text=z.string().trim().min(1);
export const semanticReviewSchema=z.object({
  version:z.literal("crv-semantic-review-0.1.0"),reviewer:text,reviewType:z.literal("analytical_not_independent"),policy:z.literal("analytical_dispositions_never_catalog_authority"),
  sources:z.array(z.object({path:text,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1),
  entries:z.array(z.object({id:text,kind:z.enum(["concept","facet"]),disposition:z.enum(["reuse","refine","propose_attribute","propose_relation","defer","reject"]),
    target:z.enum(["listener_request","perceived_energy_method","dimension","attribute","relation"]),definition:text,rationale:text,
    falseFriends:z.array(text).min(1),scope:z.array(z.enum(["listener","artist","album","track","recording","edition"])).min(1),assignmentCriterion:text,
    aliasRules:z.array(z.object({term:text,usage:z.enum(["context_required","candidate_in_explicit_request"]),reason:text}).strict()).min(1),
    motivation:z.array(z.object({kind:z.enum(["dictionary_case","pilot_finding"]),id:text,relation:z.enum(["motivates_request_not_work_evidence","motivates_attribute_not_global_validation"])}).strict()).min(1),
    annotationRefs:z.array(text),
  }).strict()).min(1),
}).strict().superRefine((r,ctx)=>{
  if(new Set(r.entries.map(e=>e.id)).size!==r.entries.length)ctx.addIssue({code:"custom",message:"Decisión semántica duplicada"});
  if(new Set(r.sources.map(e=>e.path)).size!==r.sources.length)ctx.addIssue({code:"custom",message:"Fuente semántica duplicada"});
  for(const e of r.entries){
    if(new Set(e.aliasRules.map(a=>a.term)).size!==e.aliasRules.length)ctx.addIssue({code:"custom",message:`Alias duplicado: ${e.id}`});
    if(e.id.startsWith("energy:")&&(e.target!=="perceived_energy_method"||e.disposition!=="reuse"||!e.assignmentCriterion.includes("perceived-energy-v1")))ctx.addIssue({code:"custom",message:"Energía conserva su método y niveles"});
    if(e.disposition==="propose_relation"&&e.target!=="relation")ctx.addIssue({code:"custom",message:"Una relación no se publica como dimensión de la obra"});
  }
});
export type SemanticReview=z.infer<typeof semanticReviewSchema>;
export interface OriginalConcept {id:string;dimension:string;proposalStatus:string;existingReference?:string|null;labelEs:string;aliasesEs:string[];definitionEs:string;assignmentCriterionEs:string}
export interface OriginalFacet {id:string;aliasesEs:string[];definition:string;findingRefs:string}
export function parseOriginalFacets(markdown:string):OriginalFacet[]{
  return [...markdown.matchAll(/^\| `(candidate:[^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gmu)]
    .map(m=>({id:m[1]!,aliasesEs:m[2]!.split(";").map(s=>s.trim()),definition:m[3]!.trim(),findingRefs:m[4]!.trim()}));
}
/** An explicit analytical disposition is not a human editorial approval or
 * permission to classify a catalog entity. Original definitions and aliases
 * are kept byte-for-byte, alongside the reviewed interpretation. */
export function buildReviewedVocabulary(input:{dictionary:{version:string;concepts:OriginalConcept[]};facets:OriginalFacet[];review:unknown;
  queries:Array<{id:string;expected:{expression?:string|undefined}}>;findingIds:string[];annotationIds:string[]}){
  const review=semanticReviewSchema.parse(input.review),original=[...input.dictionary.concepts.map(c=>({...c,kind:"concept" as const})),...input.facets.map(f=>({...f,kind:"facet" as const}))];
  const originals=new Map(original.map(c=>[c.id,c])),entries=new Map(review.entries.map(e=>[e.id,e]));
  if(originals.size!==original.length)throw new Error("IDs duplicados en el vocabulario original");
  if(entries.size!==originals.size||[...originals.keys()].some(id=>!entries.has(id)))throw new Error("Revisión semántica incompleta o con IDs ajenos al diccionario/familias");
  for(const e of review.entries){
    const source=originals.get(e.id)!;
    if(e.kind!==source.kind)throw new Error(`Tipo de concepto/familia alterado: ${e.id}`);
    if(e.aliasRules.length!==source.aliasesEs.length||e.aliasRules.some(a=>!source.aliasesEs.includes(a.term)))throw new Error(`Se perdieron o inventaron sinónimos: ${e.id}`);
    if(e.disposition==="reuse"&&(!("existingReference" in source)||!source.existingReference))throw new Error(`Reutilización sin referencia existente: ${e.id}`);
    for(const m of e.motivation){
      if(m.kind==="dictionary_case"){
        const q=input.queries.find(q=>q.id===m.id);
        if(!q||q.expected.expression!==e.id||m.relation!=="motivates_request_not_work_evidence")throw new Error(`Consulta motivadora no corresponde al concepto: ${e.id}`);
      }else if(!input.findingIds.includes(m.id)||m.relation!=="motivates_attribute_not_global_validation"||!("findingRefs" in source)||!source.findingRefs.split(",").map(h=>h.trim()).includes(m.id))throw new Error(`Hallazgo motivador no corresponde a la familia: ${e.id}`);
    }
    if(source.kind==="facet"&&new Set(e.motivation.filter(m=>m.kind==="pilot_finding").map(m=>m.id)).size!==source.findingRefs.split(",").length)throw new Error(`Se perdió un hallazgo motivador: ${e.id}`);
    for(const id of e.annotationRefs)if(!input.annotationIds.includes(id))throw new Error(`Anotación de contraste inexistente: ${id}`);
  }
  function reviewed(id:string){const e=entries.get(id)!;return {disposition:e.disposition,reason:e.rationale,active:false as const,
    semanticReview:{version:review.version,reviewer:review.reviewer,reviewType:review.reviewType,status:"reviewed_analytically",definition:e.definition,target:e.target,scope:e.scope,
      falseFriends:e.falseFriends,assignmentCriterion:e.assignmentCriterion,aliasRules:e.aliasRules,motivation:e.motivation,annotationRefs:e.annotationRefs,
      annotationMeaning:"Contrastes y límites analizados; no validación automática del atributo ni testigos adicionales",editorialApproved:false as const,entityAssignmentsAuthorized:false as const}};}
  return {version:"crv-human-intents-0.3.0-reviewed",predecessor:input.dictionary.version,semanticReviewVersion:review.version,active:false,
    coverage:{concepts:input.dictionary.concepts.length,facets:input.facets.length,analyticalDispositions:review.entries.length,
      dispositions:Object.fromEntries([...new Set(review.entries.map(e=>e.disposition))].map(d=>[d,review.entries.filter(e=>e.disposition===d).length])),
      contextualAliases:review.entries.reduce((n,e)=>n+e.aliasRules.filter(a=>a.usage==="context_required").length,0),editorialApprovals:0,automaticAssignments:0},
    concepts:input.dictionary.concepts.map(c=>({...c,...reviewed(c.id)})),facets:input.facets.map(f=>({...f,...reviewed(f.id)}))};
}
/** The semantic decisions were made over this immutable study cut; later study
 * versions add annotations without silently extending those decisions. */
const ANNOTATION_CUT="reports/unified-search-stage2/study-cuts/development-0.5.0/reports/unified-search-stage2/development-annotations.json";
export async function readReviewedVocabulary(root:string){
  const read=async(p:string)=>JSON.parse(await readFile(path.join(root,p),"utf8"));
  const review=semanticReviewSchema.parse(await read("docs/unified-search/stage2/semantic-review.json"));
  for(const source of review.sources){
    // Manifests cannot read arbitrary files, symlinks aside; the source set is
    // also pinned exactly below to the original development artifacts and the reviewed annotation cut.
    if(!["reports/intenciones-humanas/v0.1.0/diccionario.json","reports/intenciones-humanas/v0.1.0/matriz-consultas.json","reports/rym-reviews-piloto/v0.1.0/FACETAS_PROPUESTAS.md","reports/rym-reviews-piloto/v0.1.0/hallazgos.json",ANNOTATION_CUT].includes(source.path))throw new Error("Fuente semántica fuera del corte original");
    if(hashText(await readFile(path.join(root,source.path),"utf8"))!==source.sha256)throw new Error(`Fuente semántica cambió; revisar decisiones: ${source.path}`);
  }
  if(review.sources.length!==5)throw new Error("Falta una fuente original del corte semántico");
  const [dictionary,facetText,queries,findings,annotations]=await Promise.all([read("reports/intenciones-humanas/v0.1.0/diccionario.json"),readFile(path.join(root,"reports/rym-reviews-piloto/v0.1.0/FACETAS_PROPUESTAS.md"),"utf8"),read("reports/intenciones-humanas/v0.1.0/matriz-consultas.json"),read("reports/rym-reviews-piloto/v0.1.0/hallazgos.json"),read(ANNOTATION_CUT)]);
  return buildReviewedVocabulary({dictionary,facets:parseOriginalFacets(facetText),review,queries:queries.cases,findingIds:findings.map((f:{id:string})=>f.id),annotationIds:annotations.annotations.map((a:{id:string})=>a.id)});
}
