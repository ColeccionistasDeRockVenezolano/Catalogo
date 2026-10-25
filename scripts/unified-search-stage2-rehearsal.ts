import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { getPool, closeDb } from "../src/db/client.js";
import { resetEnvCache } from "../src/config/env.js";
import { migrateUp } from "../src/db/migrate.js";
import { startPgContainer, type PgContainer } from "../test/support/pg-container.js";
import { applyCore } from "../test/support/apply-core.js";
import { annotationSchema } from "../src/search/knowledge-contracts.js";
import { runKnowledgeChunk, knowledgeFeedStatus } from "../src/search/knowledge-feed.js";
import { importKnowledgeInterpretations } from "../src/search/knowledge-interpretation.js";
import { knowledgeModelState } from "../src/search/knowledge-interpretation.js";
import { hashText } from "../src/search/review-protocol.js";
import { prepareStudyFeed, syncStudyFeed, type StudyFeedPlan } from "../src/search/knowledge-sync.js";
import { projectRoot } from "../src/config/project-root.js";

const study=JSON.parse(await readFile("reports/unified-search-stage2/development-annotations.json","utf8"));
const annotations=(study.annotations as unknown[]).map(a=>annotationSchema.parse(a));
const inference=JSON.parse(await readFile("reports/unified-search-stage2/laya-development-interpretations.json","utf8"));
const feedPlan=await prepareStudyFeed(projectRoot(import.meta.url));
async function syncAll(plan:StudyFeedPlan) {
  let result=await syncStudyFeed(plan,{limit:2});
  let created=result.created,reused=result.reused;
  while(result.nextCursor){result=await syncStudyFeed(plan,{limit:2,cursor:result.nextCursor});created+=result.created;reused+=result.reused;}
  return {created,reused};
}
// A SELECT-only snapshot of the specific existing IDs. Never write to operational DB.
const trackIds=annotations.filter(a=>a.object.kind==="track").map(a=>a.object.id);
const trackRows=(await getPool().query("SELECT id,title,album_id,track_number,disc_number FROM public.tracks WHERE id=ANY($1::bigint[])",[trackIds])).rows;
const albumIds=[...annotations.filter(a=>a.object.kind==="album").map(a=>a.object.id),...trackRows.map(t=>t.album_id)];
const albumRows=(await getPool().query("SELECT id,title,artist_id FROM public.albums WHERE id=ANY($1::bigint[])",[albumIds])).rows;
const artistRows=(await getPool().query("SELECT id,name FROM public.artists WHERE id=ANY($1::bigint[])",[albumRows.map(a=>a.artist_id)])).rows;
await closeDb();
const originalEnv={...process.env};let pg:PgContainer|undefined;
try {
  pg=await startPgContainer();process.env["DATABASE_URL"]=pg.databaseUrl;resetEnvCache();await applyCore(pg.name);await migrateUp();
  for(const a of artistRows)await getPool().query("INSERT INTO public.artists(id,name) OVERRIDING SYSTEM VALUE VALUES($1,$2)",[a.id,a.name]);
  for(const a of albumRows)await getPool().query("INSERT INTO public.albums(id,title,artist_id) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3)",[a.id,a.title,a.artist_id]);
  for(const t of trackRows)await getPool().query("INSERT INTO public.tracks(id,title,album_id,track_number,disc_number) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,$5)",[t.id,t.title,t.album_id,t.track_number,t.disc_number]);
  assert.deepEqual(await syncAll(feedPlan),{created:feedPlan.batches.length,reused:0});
  let chunks=0;
  while((await runKnowledgeChunk(2)).status!=="idle"){chunks++;assert(chunks<100);}
  const units=(await getPool().query("SELECT unit_key,annotation->>'id' AS id FROM ingest.search_knowledge_units")).rows;
  assert.equal(units.length,annotations.length);
  const predictions=annotations.map(a=>{
    const artifactKey=hashText(`study:${a.study}:${a.id}`);
    const matches=inference.interpretations.filter((p:{unitKey:string})=>p.unitKey===artifactKey);
    assert.equal(matches.length,1,"Cada anotación requiere una predicción identificada; el orden no acredita el vínculo");
    assert.equal(matches[0].inputHash,hashText(JSON.stringify(knowledgeModelState(a))),"La entrada del modelo cambió; reinterpretar antes de importar");
    return {...matches[0],unitKey:units.find(u=>u.id===a.id)!.unit_key};
  });
  let inserted=0;
  for(let offset=0;offset<predictions.length;offset+=20)inserted+=(await importKnowledgeInterpretations(predictions.slice(offset,offset+20))).inserted;
  assert.equal(inserted,annotations.length);
  assert.deepEqual(await syncAll(feedPlan),{created:0,reused:feedPlan.batches.length});
  assert.equal((await runKnowledgeChunk()).status,"idle");for(let offset=0;offset<predictions.length;offset+=20)assert.equal((await importKnowledgeInterpretations(predictions.slice(offset,offset+20))).inserted,0);
  const status=await knowledgeFeedStatus();assert(status.jobs.every(j=>j.interpreted===j.extracted&&j.published===0&&j.approved===0));
  const counts=(await getPool().query(`SELECT (SELECT count(*)::int FROM ingest.search_knowledge_jobs) AS jobs,
    (SELECT count(*)::int FROM ingest.search_knowledge_units) AS units,
    (SELECT count(*)::int FROM ingest.search_knowledge_interpretations) AS interpretations,
    (SELECT count(*)::int FROM ingest.review_queue WHERE payload->>'type'='search_knowledge') AS reviews`)).rows[0];
  const report={version:"crv-knowledge-chain-rehearsal-v2",measuredAt:new Date().toISOString(),operationalDatabaseWrites:false,disposablePostgreSQL:true,
    input:`${study.examined.reduce((n:number,e:{reviewIds:string[]})=>n+e.reviewIds.length,0)} reseñas estudiadas / ${annotations.length} afirmaciones reales; predicciones Laya locales fijadas por checkpoint`,
    developmentRoles:{newDevelopmentReleases:study.examined.filter((e:{studyRole?:string})=>e.studyRole!=="pilot_development").length,pilotReanalysisReleases:study.examined.filter((e:{studyRole?:string})=>e.studyRole==="pilot_development").length},
    strata:{multipleReviewPages:study.examined.filter((e:{stratum:string})=>e.stratum==="multiple_review_pages").length,singlePageExceptions:study.examined.filter((e:{stratum:string})=>e.stratum==="single_release_page_exception").length},counts,chunks,
    fourSourceAnnotations:annotations.filter(a=>a.layers.community.length&&a.layers.genreKnowledge.length&&a.layers.individualRating!==null).length,
    predictionIdentity:"artifact unit key and exact model input hash; never array position",
    discovery:{adapter:feedPlan.version,planHash:feedPlan.planHash,inputs:feedPlan.inputs,sourceObjects:"stable release/page identifiers without capture or study version",boundedJobsPerCall:2},
    repeatedBatch:{createdJobs:0,createdUnits:0,createdInterpretations:0},publications:0,
    limits:["No simula aprobación musical real ni valida pertinencia del modelo","Retiro/deshacer/identidad se verifican con decisiones explícitamente sintéticas en contrato separado"]};
  await writeFile("reports/unified-search-stage2/chain-rehearsal.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
}finally{await closeDb();await pg?.stop();process.env=originalEnv;resetEnvCache();}
