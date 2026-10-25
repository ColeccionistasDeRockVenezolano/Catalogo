import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import Fastify, { type FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { registerSearchRoutes } from "../../src/api/routes/search.js";
import { enqueueKnowledgeBatch, runKnowledgeChunk, knowledgeFeedStatus, retryKnowledgeJob } from "../../src/search/knowledge-feed.js";
import { knowledgeFixture } from "../support/knowledge-fixture.js";
import { syncStudyFeed, type StudyFeedPlan } from "../../src/search/knowledge-sync.js";
import { hashText } from "../../src/search/review-protocol.js";

describe("etapa 2: alimentación transaccional y administración",()=>{
  let pg:PgContainer, app:FastifyInstance, artistId:number;
  const env={...process.env};
  const batch=()=>{const a=knowledgeFixture();a.object.kind="artist";a.object.id=artistId;a.observation.quote="private-review-sentinel-stage2-fixture";return {resourceId:a.observation.resourceId,sourceObject:"private-archive/path/album",captureHash:a.observation.captureHash,extractorVersion:a.observation.extractorVersion,schemaVersion:a.version,annotations:[a,{...a,id:"statement-2"}]};};
  beforeAll(async()=>{
    pg=await startPgContainer();process.env["DATABASE_URL"]=pg.databaseUrl;process.env["CRV_OPERATOR_TOKEN"]="stage2-internal-test-token-2026";delete process.env["CRV_COLLABORATORS_JSON"];resetEnvCache();
    await applyCore(pg.name);await migrateUp();artistId=Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Fixture') RETURNING id")).rows[0].id);
    app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);await registerOperatorAuth(app);await registerSearchRoutes(app);
  });
  afterAll(async()=>{await app?.close();await closeDb();await pg?.stop();resetAuthStateForTests();process.env=env;resetEnvCache();});
  it("repetir lote conserva un solo job; cambios con la misma clave requieren versión",async()=>{
    expect((await enqueueKnowledgeBatch(batch())).created).toBe(true);expect((await enqueueKnowledgeBatch(batch())).created).toBe(false);
    const changed=batch();changed.annotations[0]!.analysis.interpretation="otra lectura";
    await expect(enqueueKnowledgeBatch(changed)).rejects.toThrow(/otro contenido/);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_knowledge_jobs")).rows[0].n).toBe(1);
  });
  it("reanuda por cursor y no duplica evidencia ni casos; no cambia catálogo",async()=>{
    expect((await runKnowledgeChunk(1)).processed).toBe(1);
    expect((await getPool().query("SELECT cursor,state FROM ingest.search_knowledge_jobs")).rows[0]).toMatchObject({cursor:1,state:"pending"});
    expect((await runKnowledgeChunk(1)).status).toBe("review");expect((await runKnowledgeChunk()).status).toBe("idle");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_knowledge_units")).rows[0].n).toBe(2);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE payload->>'type'='search_knowledge'")).rows[0].n).toBe(2);
    expect((await getPool().query("SELECT name FROM public.artists WHERE id=$1",[artistId])).rows[0].name).toBe("Fixture");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.track_context_assignments")).rows[0].n).toBe(0);
    expect((await knowledgeFeedStatus()).counts).toContainEqual({status:"open",count:2});
  });
  it("un lease vencido se recupera; procesadores concurrentes no duplican",async()=>{
    const b=batch();b.sourceObject="second";await enqueueKnowledgeBatch(b);
    await getPool().query("UPDATE ingest.search_knowledge_jobs SET state='running',lease_token='00000000-0000-4000-8000-000000000000',lease_until=now()-interval '1 minute' WHERE source_object='second'");
    await Promise.all([runKnowledgeChunk(),runKnowledgeChunk()]);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_knowledge_units")).rows[0].n).toBe(4);
  });
  it("la identidad desaparecida va a revisión; nunca crea una ficha",async()=>{
    const b=batch();b.sourceObject="missing-identity";b.annotations=b.annotations.slice(0,1);b.annotations[0]!.object.id=999;
    await enqueueKnowledgeBatch(b);await runKnowledgeChunk();
    const row=(await getPool().query("SELECT payload FROM ingest.review_queue ORDER BY id DESC LIMIT 1")).rows[0];expect(row.payload.reasons).toContain("catalog_identity_missing");
    expect((await getPool().query("SELECT 1 FROM public.artists WHERE id=999")).rowCount).toBe(0);
  });
  it("lecturas privadas sin rutas, entradas, cuentas ni textos completos",async()=>{
    expect((await app.inject("/search/administration/knowledge")).statusCode).toBe(401);
    const review=Number((await getPool().query("SELECT review_id FROM ingest.search_knowledge_units ORDER BY id LIMIT 1")).rows[0].review_id);
    expect((await app.inject(`/search/administration/knowledge/reviews/${review}`)).statusCode).toBe(401);
    const publicRead=await app.inject(`/search/knowledge/artist/${artistId}`);
    expect(publicRead.statusCode).toBe(200);expect(publicRead.headers["cache-control"]).toBe("no-store");expect(publicRead.json()).toEqual({evidence:[]});
    const protectedWrite=await app.inject({method:"POST",url:`/search/administration/knowledge/reviews/${review}/decision`,headers:{origin:"http://localhost:5173"},payload:{}});
    expect([401,403]).toContain(protectedWrite.statusCode);
    const detail=await app.inject({url:`/search/administration/knowledge/reviews/${review}`,headers:{authorization:"Bearer stage2-internal-test-token-2026"}});
    expect(detail.statusCode).toBe(200);expect(detail.body).not.toContain("private-archive");
    const forged=await app.inject({method:"POST",url:`/search/administration/knowledge/reviews/${review}/decision`,headers:{authorization:"Bearer stage2-internal-test-token-2026",origin:"http://localhost:5173"},
      payload:{expectedRevision:0,unitKey:detail.json().unitKey,status:"approved",reason:"test",publicQuote:"Guitarras fuzz",criterion:null,actor:"Brian"}});
    expect(forged.statusCode).toBe(400);
    const result=await app.inject({url:"/search/administration/knowledge",headers:{authorization:"Bearer stage2-internal-test-token-2026"}});
    expect(result.statusCode).toBe(200);expect(result.body).not.toContain("private-archive");expect(result.body).not.toContain("account-1");expect(result.body).not.toContain("private-review-sentinel-stage2-fixture");
  });
  it("rollback elimina staging y conserva historial editorial",async()=>{
    await getPool().query(await readFile("migrations/0087_search_knowledge_interpretations.down.sql","utf8"));
    await getPool().query(await readFile("migrations/0086_search_knowledge_feed.down.sql","utf8"));
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE payload->>'type'='search_knowledge'")).rows[0].n).toBe(5);
    expect((await knowledgeFeedStatus()).available).toBe(false);
    await getPool().query(await readFile("migrations/0086_search_knowledge_feed.up.sql","utf8"));
    await getPool().query(await readFile("migrations/0087_search_knowledge_interpretations.up.sql","utf8"));
    await enqueueKnowledgeBatch(batch());await runKnowledgeChunk();
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE payload->>'type'='search_knowledge'")).rows[0].n).toBe(5);
  });
  it("un fallo revierte casos/cursor, aplica backoff y permite reintento explícito",async()=>{
    const b=batch();b.sourceObject="forced-failure";const job=await enqueueKnowledgeBatch(b);
    await getPool().query(`CREATE FUNCTION ingest.test_knowledge_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private SQL detail'; END $$;
      CREATE TRIGGER test_knowledge_failure BEFORE INSERT ON ingest.search_knowledge_units FOR EACH ROW EXECUTE FUNCTION ingest.test_knowledge_failure()`);
    const count=Number((await getPool().query("SELECT count(*) AS n FROM ingest.review_queue")).rows[0].n);
    await expect(runKnowledgeChunk()).rejects.toThrow(/lote se conserva/);
    let state=(await getPool().query("SELECT state,cursor,attempts,next_attempt_at>now() AS delayed FROM ingest.search_knowledge_jobs WHERE id=$1",[job.id])).rows[0];
    expect(state).toMatchObject({state:"pending",cursor:0,attempts:1,delayed:true});
    expect(Number((await getPool().query("SELECT count(*) AS n FROM ingest.review_queue")).rows[0].n)).toBe(count);
    await getPool().query("UPDATE ingest.search_knowledge_jobs SET attempts=4,next_attempt_at=now() WHERE id=$1",[job.id]);
    await expect(runKnowledgeChunk()).rejects.toThrow(/lote se conserva/);
    state=(await getPool().query("SELECT state,cursor,attempts FROM ingest.search_knowledge_jobs WHERE id=$1",[job.id])).rows[0];
    expect(state).toMatchObject({state:"failed",cursor:0,attempts:5});
    await getPool().query("DROP TRIGGER test_knowledge_failure ON ingest.search_knowledge_units; DROP FUNCTION ingest.test_knowledge_failure()");
    await retryKnowledgeJob(job.id);expect((await runKnowledgeChunk()).processed).toBe(2);
  });

  it("sincronización reanudada y concurrente conserva jobs y distingue captura nueva, cambiada y reprocesada",async()=>{
    const first=batch();first.sourceObject="stable-release-page";
    const changed=structuredClone(first);changed.captureHash="b".repeat(64);
    changed.annotations.forEach(a=>{a.observation.captureHash=changed.captureHash;});
    const reprocessed=structuredClone(changed);reprocessed.extractorVersion="test-v2";
    reprocessed.annotations.forEach(a=>{a.observation.extractorVersion=reprocessed.extractorVersion;});
    const batches=[first,changed,reprocessed];
    const plan:StudyFeedPlan={version:"crv-study-feed-plan-v1",inputs:[],batches,planHash:hashText(JSON.stringify([[],batches]))};
    const before=Number((await getPool().query("SELECT count(*) AS n FROM ingest.search_knowledge_jobs")).rows[0].n);
    const preview=await syncStudyFeed(plan,{dryRun:true,limit:1});
    expect(preview.jobs[0]!.id).toBeNull();
    expect(Number((await getPool().query("SELECT count(*) AS n FROM ingest.search_knowledge_jobs")).rows[0].n)).toBe(before);
    const partial=await syncStudyFeed(plan,{limit:1});expect(partial.created).toBe(1);
    const simultaneous=await Promise.all([syncStudyFeed(plan,{limit:2,cursor:partial.nextCursor!}),syncStudyFeed(plan,{limit:2,cursor:partial.nextCursor!})]);
    expect(simultaneous.reduce((n,r)=>n+r.created,0)).toBe(2);
    expect(simultaneous.reduce((n,r)=>n+r.reused,0)).toBe(2);
    expect((await syncStudyFeed(plan)).reused).toBe(3);
    expect(Number((await getPool().query("SELECT count(*) AS n FROM ingest.search_knowledge_jobs")).rows[0].n)).toBe(before+3);
    const status=await knowledgeFeedStatus();
    const jobs=status.jobs.filter(j=>!j.errorCode&&j.total===2&&j.extracted===0).sort((a,b)=>a.id-b.id);
    expect(jobs.map(j=>j.inputChange)).toEqual(["new_source","changed_capture","reprocessed_capture"]);
    const read=await app.inject({url:"/search/administration/knowledge",headers:{authorization:"Bearer stage2-internal-test-token-2026"}});
    expect(read.statusCode).toBe(200);expect(read.body).toContain("changed_capture");expect(read.body).not.toContain("stable-release-page");
    await runKnowledgeChunk();await runKnowledgeChunk();await runKnowledgeChunk();
    const counts=(await getPool().query(`SELECT count(*)::int AS n FROM ingest.search_knowledge_units u JOIN ingest.search_knowledge_jobs j ON j.id=u.job_id WHERE j.source_object='stable-release-page'`)).rows[0];
    expect(counts.n).toBe(6);expect((await runKnowledgeChunk()).status).toBe("idle");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.track_context_assignments")).rows[0].n).toBe(0);
  });

  it("un bloqueo de encolado vence sin escribir parcialmente y el mismo corte se puede reintentar",async()=>{
    const input=batch();input.sourceObject="bounded-enqueue";
    const blocker=await getPool().connect();
    try {
      await blocker.query("BEGIN");await blocker.query("LOCK TABLE ingest.search_knowledge_jobs IN SHARE MODE");
      await expect(enqueueKnowledgeBatch(input)).rejects.toMatchObject({statusCode:503,code:"knowledge_enqueue_failed"});
      expect((await blocker.query("SELECT count(*)::int AS n FROM ingest.search_knowledge_jobs WHERE source_object=$1",[input.sourceObject])).rows[0].n).toBe(0);
    } finally {await blocker.query("ROLLBACK");blocker.release();}
    expect((await enqueueKnowledgeBatch(input)).created).toBe(true);
    expect((await enqueueKnowledgeBatch(input)).created).toBe(false);
  });

});
