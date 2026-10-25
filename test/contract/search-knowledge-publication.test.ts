import { readFile } from "node:fs/promises";
import { knowledgeInterpretationTasks, importKnowledgeInterpretations } from "../../src/search/knowledge-interpretation.js";
import { hashText } from "../../src/search/review-protocol.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRun } from "../../src/merge/run-undo.js";
import { enqueueKnowledgeBatch, runKnowledgeChunk } from "../../src/search/knowledge-feed.js";
import { decideKnowledge, publishedKnowledge, knowledgeReviewDetail } from "../../src/search/knowledge-publication.js";
import { knowledgeFixture } from "../support/knowledge-fixture.js";

describe("conocimiento: publicación atribuida y autoridad editorial", () => {
  let pg: PgContainer, artistId: number, reviewId: number, unitKey: string;
  const env = { ...process.env };
  const approve = (revision = 0) => ({ expectedRevision: revision, unitKey, status: "approved", reason: "Fuente, objeto y timbre revisados", publicQuote: "Guitarras fuzz",
    criterion: { version: "timbre-attributed-v1", basis: "attributed_description", justification: "Se publica como percepción atribuida; no acredita pedal" } });
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    artistId = Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Fixture') RETURNING id")).rows[0].id);
    const a = knowledgeFixture(); a.object.kind = "artist"; a.object.id = artistId; a.object.name = "Fixture";
    await enqueueKnowledgeBatch({ resourceId: a.observation.resourceId, sourceObject: "fixture", captureHash: a.observation.captureHash, extractorVersion: a.observation.extractorVersion, schemaVersion: a.version, annotations: [a] });
    await runKnowledgeChunk(); const row = (await getPool().query("SELECT unit_key,review_id FROM ingest.search_knowledge_units")).rows[0]; unitKey = row.unit_key; reviewId = Number(row.review_id);
  });
  afterAll(async () => { await closeDb(); await pg?.stop(); process.env = env; resetEnvCache(); });
  it("una propuesta o aprobación genérica de cola no publica evidencia", async () => {
    expect(await publishedKnowledge("artist", artistId)).toEqual([]);
    await getPool().query("UPDATE ingest.review_queue SET status='approved',resolved_by='human' WHERE id=$1", [reviewId]);
    expect(await publishedKnowledge("artist", artistId)).toEqual([]);
  });
  it("publica solo cita y alcance aprobados, sin archivos, analista ni cuentas privadas", async () => {
    const concurrent=await Promise.allSettled([decideKnowledge(reviewId,approve(),"Brian"),decideKnowledge(reviewId,approve(),"Revisor")]);
    expect(concurrent.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(concurrent.filter(r=>r.status==="rejected")).toHaveLength(1);
    const saved=concurrent.find((r):r is PromiseFulfilledResult<Awaited<ReturnType<typeof decideKnowledge>>>=>r.status==="fulfilled")!.value;
    expect(saved.result.revision).toBe(1);
    const visible = await publishedKnowledge("artist", artistId); expect(visible).toHaveLength(1);
    expect(visible[0]!.citation.quote).toBe("Guitarras fuzz"); expect(visible[0]!.object.id).toBe(artistId);
    expect(JSON.stringify(visible)).not.toContain("account-1"); expect(JSON.stringify(visible)).not.toContain("documented repertoire");
    await expect(decideKnowledge(reviewId, approve(), "Brian")).rejects.toThrow(/cambió/);
  });
  it("retiro, deshacer y rehacer tienen efecto en la siguiente lectura sin caché", async () => {
    const withdrawn = await decideKnowledge(reviewId, { ...approve(1), status: "withdrawn", publicQuote: null, criterion: null, reason: "Retirar hasta nueva evidencia" }, "Brian");
    expect(await publishedKnowledge("artist", artistId)).toEqual([]);
    const undo = await withOperatorRun({ name: "api:undo:run", operator: "Brian", note: "Revisar retiro" }, ctx => undoRun(ctx, withdrawn.runId));
    expect(await publishedKnowledge("artist", artistId)).toHaveLength(1);
    await withOperatorRun({ name: "api:undo:run", operator: "Brian", note: "Rehacer retiro" }, ctx => undoRun(ctx, undo.runId));
    expect(await publishedKnowledge("artist", artistId)).toEqual([]);
  });
  it("un cambio o fusión de identidad retira la atribución anterior hasta revisarla", async () => {
    const current = await knowledgeReviewDetail(reviewId);
    await decideKnowledge(reviewId, approve(current.revision), "Brian");
    await getPool().query("UPDATE public.artists SET name='Otro nombre' WHERE id=$1", [artistId]);
    expect(await publishedKnowledge("artist", artistId)).toEqual([]);
    await getPool().query("UPDATE public.artists SET name='Fixture' WHERE id=$1", [artistId]);
    await getPool().query("UPDATE ingest.review_queue SET artist_a_id=NULL WHERE id=$1", [reviewId]);
    expect(await publishedKnowledge("artist", artistId)).toEqual([]);
    await getPool().query("UPDATE ingest.review_queue SET artist_a_id=$2 WHERE id=$1", [reviewId, artistId]);
  });
  it("no permite ampliar una cita, publicar datos personales ni sobrepasar los bloqueos musicales", async () => {
    const current = await knowledgeReviewDetail(reviewId);
    await expect(decideKnowledge(reviewId, { ...approve(current.revision), publicQuote: "Otra observación inventada" }, "Brian")).rejects.toThrow(/requieren revisión/);
    await expect(decideKnowledge(reviewId, { ...approve(current.revision),criterion:{version:"fact-v1",basis:"documented_fact",justification:"No basta con una reseña"}}, "Brian")).rejects.toThrow(/reseña se publica como atribución/);
    const annotation = (await getPool().query("SELECT annotation FROM ingest.search_knowledge_units WHERE review_id=$1", [reviewId])).rows[0].annotation;
    annotation.assertion.state = "hypothetical";
    await getPool().query("UPDATE ingest.search_knowledge_units SET annotation=$2 WHERE review_id=$1", [reviewId, annotation]);
    expect(await publishedKnowledge("artist", artistId)).toEqual([]);
    await expect(decideKnowledge(reviewId, approve(current.revision), "Brian")).rejects.toThrow(/requieren revisión/);
  });
  it("versiona predicciones Laya sin duplicar evidencia ni tocar decisiones humanas", async () => {
    const original=(await getPool().query("SELECT annotation FROM ingest.search_knowledge_units WHERE review_id=$1",[reviewId])).rows[0].annotation;
    original.assertion.state="affirmed";await getPool().query("UPDATE ingest.search_knowledge_units SET annotation=$2 WHERE review_id=$1",[reviewId,original]);
    expect(await publishedKnowledge("artist",artistId)).toHaveLength(1);
    const raw = await readFile("docs/unified-search/stage2/laya-evidence-questions.json", "utf8"), document = JSON.parse(raw);
    const metadata = { model: "multilingual" as const, modelRevision: "b".repeat(40), sdkVersion: "fixture-sdk", questionVersion: document.version, questionHash: hashText(raw) };
    const tasks = await knowledgeInterpretationTasks(metadata); expect(tasks).toHaveLength(1);
    expect(JSON.stringify(tasks)).not.toContain("individualRating"); expect(JSON.stringify(tasks)).not.toContain("analyst");
    const answers = Object.fromEntries(Object.entries(document.questions).map(([key,q]) => {
      const options = Object.keys((q as {criteria:Record<string,string>}).criteria);
      return [key,{choice:options[0],probabilities:Object.fromEntries(options.map((o,i)=>[o,i===0?1:0]))}];
    }));
    const prediction = {...metadata,unitKey:tasks[0]!.unitKey,inputHash:tasks[0]!.inputHash,decisions:answers,routing:{model:"multilingual"}};
    const prior = (await getPool().query("SELECT payload FROM ingest.review_queue WHERE id=$1",[reviewId])).rows[0].payload;
    expect((await importKnowledgeInterpretations([prediction])).inserted).toBe(1);
    expect((await importKnowledgeInterpretations([prediction])).inserted).toBe(0);
    expect(await knowledgeInterpretationTasks(metadata)).toEqual([]);
    const divergent=structuredClone(prediction);divergent.modelRevision="c".repeat(40);
    divergent.decisions["support"]={choice:"contradicts",probabilities:{supports:0,contradicts:1,insufficient:0}};
    expect((await importKnowledgeInterpretations([divergent])).inserted).toBe(1);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE payload->>'type'='search_knowledge_model_conflict'")).rows[0].n).toBe(1);
    expect(await publishedKnowledge("artist",artistId)).toHaveLength(1);
    expect((await getPool().query("SELECT payload FROM ingest.review_queue WHERE id=$1",[reviewId])).rows[0].payload).toEqual(prior);
    await expect(importKnowledgeInterpretations([{...prediction,inputHash:"0".repeat(64)}])).rejects.toThrow(/no corresponde/);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_knowledge_interpretations")).rows[0].n).toBe(2);
    const reviewed=await knowledgeReviewDetail(reviewId);
    const reaffirm=await decideKnowledge(reviewId,approve(reviewed.revision),"Brian");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE payload->>'type'='search_knowledge_model_conflict' AND status='open'")).rows[0].n).toBe(0);
    await withOperatorRun({name:"api:undo:run",operator:"Brian",note:"Volver al contraste de modelo"},ctx=>undoRun(ctx,reaffirm.runId));
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE payload->>'type'='search_knowledge_model_conflict' AND status='open'")).rows[0].n).toBe(1);
    expect(await publishedKnowledge("artist",artistId)).toHaveLength(1);
  });

  it("Last.fm exige el perfil revisado exacto y una retirada de verificación invalida al instante", async () => {
    const a=knowledgeFixture();a.id="lastfm-proof";a.object.kind="artist";a.object.id=artistId;a.object.name="Fixture";
    a.observation.resourceId="R11";a.observation.source="https://www.last.fm/es/music/Fixture";
    await enqueueKnowledgeBatch({resourceId:"R11",sourceObject:"lastfm-fixture",captureHash:a.observation.captureHash,extractorVersion:a.observation.extractorVersion,schemaVersion:a.version,annotations:[a]});
    await runKnowledgeChunk();const row=(await getPool().query("SELECT review_id,unit_key FROM ingest.search_knowledge_units WHERE annotation->>'id'='lastfm-proof'")).rows[0];
    const request={...approve(),unitKey:row.unit_key};
    await expect(decideKnowledge(Number(row.review_id),request,"Brian")).rejects.toThrow(/vínculo documental/);
    await getPool().query("INSERT INTO ingest.lastfm_artist_verifications(artist_id,lastfm_url,evidence,reviewed_by) VALUES($1,'https://www.last.fm/music/Otro','Fixture documental','Brian')",[artistId]);
    await expect(decideKnowledge(Number(row.review_id),request,"Brian")).rejects.toThrow(/vínculo documental/);
    await getPool().query("UPDATE ingest.lastfm_artist_verifications SET lastfm_url='https://www.last.fm/music/Fixture' WHERE artist_id=$1",[artistId]);
    await decideKnowledge(Number(row.review_id),request,"Brian");
    expect((await publishedKnowledge("artist",artistId)).filter(p=>p.citation.source.includes("last.fm"))).toHaveLength(1);
    await getPool().query("DELETE FROM ingest.lastfm_artist_verifications WHERE artist_id=$1",[artistId]);
    expect((await publishedKnowledge("artist",artistId)).filter(p=>p.citation.source.includes("last.fm"))).toHaveLength(0);
  });

});
