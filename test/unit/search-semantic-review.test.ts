import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { buildReviewedVocabulary, parseOriginalFacets, readReviewedVocabulary, semanticReviewSchema, type OriginalConcept } from "../../src/search/semantic-review.js";
const read=async(p:string)=>JSON.parse(await readFile(p,"utf8"));
const [dictionary,facetText,review,queries,findings,annotations]=await Promise.all([read("reports/intenciones-humanas/v0.1.0/diccionario.json"),readFile("reports/rym-reviews-piloto/v0.1.0/FACETAS_PROPUESTAS.md","utf8"),read("docs/unified-search/stage2/semantic-review.json"),read("reports/intenciones-humanas/v0.1.0/matriz-consultas.json"),read("reports/rym-reviews-piloto/v0.1.0/hallazgos.json"),read("reports/unified-search-stage2/study-cuts/development-0.5.0/reports/unified-search-stage2/development-annotations.json")]);
function input(){return structuredClone({dictionary,facets:parseOriginalFacets(facetText),review,queries:queries.cases,findingIds:findings.map((f:{id:string})=>f.id),annotationIds:annotations.annotations.map((a:{id:string})=>a.id)});}
it("cubre cada concepto/familia conservando definición y sinónimos, sin aprobación ni activación",()=>{
 const data=input(),result=buildReviewedVocabulary(data);
 expect(result.coverage).toMatchObject({concepts:64,facets:22,analyticalDispositions:86,editorialApprovals:0,automaticAssignments:0});
 for(const c of data.dictionary.concepts as OriginalConcept[]){const row=result.concepts.find(r=>r.id===c.id)!;expect(row.aliasesEs).toEqual(c.aliasesEs);expect(row.definitionEs).toBe(c.definitionEs);expect(row.active).toBe(false);expect(row.semanticReview.editorialApproved).toBe(false);}
 expect(data.review).toEqual(review);
});
it("no permite revisiones parciales, duplicadas o con IDs ajenos",()=>{
 const data=input();data.review.entries.pop();expect(()=>buildReviewedVocabulary(data)).toThrow(/incompleta/);
 data.review.entries.push(data.review.entries[0]);expect(semanticReviewSchema.safeParse(data.review).success).toBe(false);
 data.review.entries[data.review.entries.length-1]={...review.entries.at(-1),id:"candidate:invented"};expect(()=>buildReviewedVocabulary(data)).toThrow(/incompleta/);
});
it("preserva sinónimos ambiguos y exige regla para cada uno",()=>{
 const result=buildReviewedVocabulary(input());const sex=result.concepts.find(c=>c.id==="activity:intimacy")!;
 expect(sex.aliasesEs).toContain("coger");expect(sex.semanticReview.aliasRules.find(a=>a.term==="coger")?.usage).toBe("context_required");
 const data=input();data.review.entries[0].aliasRules.pop();expect(()=>buildReviewedVocabulary(data)).toThrow(/sinónimos/);
});
it("reutilizar exige un concepto existente y energía conserva su método",()=>{
 const data=input();const entry=data.review.entries.find((r:{id:string})=>r.id==="theme:love");entry.disposition="reuse";
 // Themes have an existing artist-level reference, so refining remains essential
 // to scope, even though reuse of its literal lexicon is not inherently invalid.
 entry.id="theme:new";expect(()=>buildReviewedVocabulary(data)).toThrow(/incompleta/);
 const energy=input();energy.review.entries.find((r:{id:string})=>r.id==="energy:energy-high").assignmentCriterion="deducir desde energetic";
 expect(()=>buildReviewedVocabulary(energy)).toThrow(/Energía/);
 const novel=input();novel.review.entries.find((r:{id:string})=>r.id==="activity:sleep").disposition="reuse";expect(()=>buildReviewedVocabulary(novel)).toThrow(/referencia existente/);
});
it("consulta, hallazgo y anotación deben existir y corresponder a su concepto",()=>{
 const data=input();data.review.entries[0].motivation[0].id="Q002";expect(()=>buildReviewedVocabulary(data)).toThrow(/Consulta motivadora/);
 const facet=input();facet.review.entries.find((r:{id:string})=>r.id==="candidate:timbre.fuzz").motivation[0].id="H42";expect(()=>buildReviewedVocabulary(facet)).toThrow(/Hallazgo motivador/);
 const missing=input();missing.review.entries.find((r:{id:string})=>r.id==="candidate:production.sources").annotationRefs.push("invented");expect(()=>buildReviewedVocabulary(missing)).toThrow(/inexistente/);
});
it("no pierde hallazgos de una familia ni convierte una relación en dimensión",()=>{
 const data=input();data.review.entries.find((r:{id:string})=>r.id==="candidate:production.sources").motivation.pop();expect(()=>buildReviewedVocabulary(data)).toThrow(/perdió un hallazgo/);
 const relation=input();relation.review.entries.find((r:{id:string})=>r.id==="candidate:affinity.aspect").target="dimension";expect(()=>buildReviewedVocabulary(relation)).toThrow(/relación/);
});
it("valida las huellas del corte y materializa el artefacto sin consultar la base",async()=>{
 const result=await readReviewedVocabulary(process.cwd());expect(result.semanticReviewVersion).toBe("crv-semantic-review-0.1.0");expect(result.coverage.analyticalDispositions).toBe(86);
});
