import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { projectRoot } from "../src/config/project-root.js";
import { genreKnowledgeFileSchema } from "../src/search/genre-map.js";
import { verifyGenreSourceCaptures } from "../src/search/genre-source-captures.js";
import { preserveGenreCut } from "../src/search/genre-cuts.js";
import { inspectGenreDescription } from "../src/search/taxonomy-knowledge.js";
const root=projectRoot(import.meta.url),bookPath="docs/unified-search/stage2/genre-descriptions.json",mapPath="reports/unified-search-stage2/genre-map.json";
const [bookText,mapText]=await Promise.all([readFile(path.join(root,bookPath),"utf8"),readFile(path.join(root,mapPath),"utf8")]);
const book=genreKnowledgeFileSchema.parse(JSON.parse(bookText));
assert(book.sourceCaptureManifest,"Falta declarar el corte de fuentes");
const sources=await verifyGenreSourceCaptures(root,book.sourceCaptureManifest,book.descriptions);
const map=JSON.parse(mapText) as {version:string;coverage:Record<string,number>;genres:Array<{slug:string;proposedDefinition:string|null;characteristics:unknown[];sources:unknown[];description:string|null;existingDescription:string|null;entityAssignmentsAuthorized:boolean;categoryKind?:string|null;profileLimits?:string|null;scope:unknown;researchStatus:string;analyst:string|null;missingAspects:string[]}>};
assert.equal(map.version,book.version,"Regenerar el mapa tras cambiar su definición");
for(const d of book.descriptions){
 const row=map.genres.find(g=>g.slug===d.slug);assert(row,`Propuesta sin identidad activa: ${d.slug}`);
 assert.equal(row.proposedDefinition,d.definition,`Propuesta derivada obsoleta: ${d.slug}`);
 assert.deepEqual(row.characteristics,d.characteristics);assert.deepEqual(row.sources,d.sources);
 assert.equal(row.categoryKind??null,d.categoryKind??null);assert.equal(row.profileLimits??null,d.profileLimits??null);
 assert.deepEqual(row.scope,d.scope);assert.equal(row.researchStatus,d.status);assert.equal(row.analyst,d.analyst);
 assert.deepEqual(row.missingAspects,inspectGenreDescription(d).missingAspects);
 assert.equal(row.description,row.existingDescription??d.definition);
}
for(const g of map.genres){assert.equal(g.entityAssignmentsAuthorized,false);if(g.existingDescription)assert.equal(g.description,g.existingDescription);}
assert.equal(map.coverage["documentedProposals"],book.descriptions.length);
assert.equal(map.coverage["active"],map.genres.length);
assert.equal(map.coverage["described"],map.genres.filter(g=>g.description).length);
const excludedSlugs=new Set((book.exclusions??[]).map(e=>e.slug));
for(const g of map.genres)assert.equal((g as {descriptionStatus?:string}).descriptionStatus==="excluded_by_decision",excludedSlugs.has(g.slug)&&!g.description,`Exclusión derivada obsoleta: ${g.slug}`);
assert.equal(map.coverage["excludedByDecision"]??0,excludedSlugs.size);
assert.equal(map.coverage["missingDescriptions"],map.genres.filter(g=>!g.description&&!excludedSlugs.has(g.slug)).length);
assert.equal(map.coverage["existingDescriptions"],map.genres.filter(g=>g.existingDescription).length);
assert.equal(map.coverage["allSixAspectsDocumented"],map.genres.filter(g=>!g.missingAspects.length).length);
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const manifestText=await readFile(path.join(root,book.sourceCaptureManifest.path),"utf8");
assert.equal(hash(manifestText),book.sourceCaptureManifest.sha256,"El manifiesto cambió durante la auditoría");
const immutableCut=await preserveGenreCut(root,book.version,{book:bookText,manifest:manifestText,map:mapText});
const result={version:"crv-genre-source-audit-0.1.0",bookVersion:book.version,coverage:map.coverage,sources,
 immutableCut,
 inputs:[{path:bookPath,sha256:hash(bookText)},{path:mapPath,sha256:hash(mapText)},{path:book.sourceCaptureManifest.path,sha256:book.sourceCaptureManifest.sha256}],
 descriptionsWithoutStableAspects:book.descriptions.map(d=>({slug:d.slug,missingAspects:["instruments_roles","timbre","rhythm","form","voice","production"].filter(aspect=>!d.characteristics.some(c=>c.aspect===aspect))})).filter(d=>d.missingAspects.length),
 missingDescriptionSlugs:map.genres.filter(g=>!g.description&&!excludedSlugs.has(g.slug)).map(g=>g.slug),
 excludedByDecision:book.exclusions??[],derivedMapMatchesAuthoredDescriptions:true,existingDescriptionsPreserved:true,
 categoryKinds:Object.fromEntries([...new Set(book.descriptions.map(d=>d.categoryKind??"not_reviewed"))].map(kind=>[kind,book.descriptions.filter(d=>(d.categoryKind??"not_reviewed")===kind).length])),
 operationalDatabaseWrites:0,publicationAuthorized:false,musicalValidation:"proposed_general_knowledge_not_independent_work_validation"};
await mkdir(path.join(root,"reports/unified-search-stage2/verification"),{recursive:true});
await writeFile(path.join(root,"reports/unified-search-stage2/verification/genre-source-audit.json"),`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({coverage:map.coverage,sources}));
