import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { z } from "zod";
import { evidenceQuerySchema, evaluateEvidenceQuery } from "../src/search/evidence-query.js";
import { annotationSchema } from "../src/search/knowledge-contracts.js";

const states=z.enum(["supported","contradicted","conflicted","unknown"]);
const matrixSchema=z.object({
  version:z.literal("crv-query-matrix-0.3.0"),authoredBy:z.string().min(1),scope:z.string().min(1),sourceReadingsVersion:z.string().min(1),engineFieldMeaning:z.string().min(1),
  cases:z.array(z.object({id:z.string().min(1),needAnnotationIds:z.array(z.string()).min(1),input:z.string().min(1),synonyms:z.array(z.string()),request:evidenceQuerySchema,
    expected:z.object({status:z.enum(["supported_as_attributed","not_supported","conflicted","unresolved","preference_only","direct_lookup"]),conditionStates:z.record(states),supportingIds:z.record(z.array(z.string()))}).strict(),
    allowedExplanation:z.string().min(1),forbiddenExplanation:z.string().min(1),
  }).strict()).min(1),
}).strict();
const paths={matrix:"docs/unified-search/stage2/query-matrix.json",annotations:"reports/unified-search-stage2/development-annotations.json",readings:"docs/unified-search/stage2/development-readings.json"};
const files=await Promise.all(Object.values(paths).map(p=>readFile(p,"utf8")));
const matrix=matrixSchema.parse(JSON.parse(files[0]!));
const annotations=z.object({annotations:z.array(annotationSchema)}).parse(JSON.parse(files[1]!)).annotations;
const readings=z.object({version:z.string(),readings:z.array(z.object({id:z.string()}))}).parse(JSON.parse(files[2]!));
assert.equal(readings.version,matrix.sourceReadingsVersion,"La matriz necesita revisión ante otra versión de lecturas");
assert.equal(new Set(matrix.cases.map(c=>c.id)).size,matrix.cases.length,"IDs de consulta duplicados");
assert.deepEqual([...new Set(matrix.cases.flatMap(c=>c.needAnnotationIds))].sort(),readings.readings.map(r=>r.id).sort(),"Todas las necesidades deben cubrirse exactamente en el conjunto de referencias");
assert.deepEqual(annotations.map(a=>a.id).sort(),readings.readings.map(r=>r.id).sort(),"El corpus y las lecturas deben coincidir");
const cases=matrix.cases.map(c=>{
  assert.equal(c.request.planOrigin,"authored_development_plan");
  const result=evaluateEvidenceQuery(c.request,annotations);
  assert.equal(result.status,c.expected.status,`${c.id}: estado`);
  assert.deepEqual(Object.fromEntries(result.conditions.map(r=>[r.id,r.state])),c.expected.conditionStates,`${c.id}: condiciones`);
  assert.deepEqual(Object.fromEntries(result.conditions.map(r=>[r.id,[...r.supportingIds].sort()])),Object.fromEntries(Object.entries(c.expected.supportingIds).map(([id,ids])=>[id,[...ids].sort()])),`${c.id}: soporte`);
  return {...c,result,expectationsPassed:true};
});
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const report={version:matrix.version,authoredBy:matrix.authoredBy,scope:matrix.scope,engineFieldMeaning:matrix.engineFieldMeaning,
  inputs:Object.fromEntries(Object.entries(paths).map(([key,path],i)=>[key,{path,sha256:hash(files[i]!)}])),
  coverage:{cases:cases.length,annotatedNeeds:readings.readings.length,annotationsExaminedPerCase:annotations.length,statuses:Object.fromEntries([...new Set(cases.map(c=>c.result.status))].map(status=>[status,cases.filter(c=>c.result.status===status).length]))},
  verification:{expectationsPassed:true,parserExecuted:false,publicSearchExecuted:false,modelEvaluated:false,independentMusicalReview:false,operationalDatabaseWrites:0,publications:0,automaticLabels:0,
    explanationRules:"Las frases permitidas y prohibidas son criterios de revisión authored; se verifican estados y IDs, no comprensión automática de esas frases.",
    legacyCorpus:"Las 56 consultas heredadas y las 133 humanas se conservan en pilot-findings.json; esta ejecución no acredita su resolución."},cases};
await mkdir("reports/unified-search-stage2",{recursive:true});
await writeFile("reports/unified-search-stage2/query-matrix.json",`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report.coverage));
