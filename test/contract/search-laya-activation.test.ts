import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { layaAdministration, recordLayaActivation } from "../../src/search/laya-models.js";
import { knowledgeInterpretationTasks, importKnowledgeInterpretations } from "../../src/search/knowledge-interpretation.js";
import { enqueueKnowledgeBatch, runKnowledgeChunk } from "../../src/search/knowledge-feed.js";
import { decideKnowledge, knowledgeReviewDetail, publishedKnowledge } from "../../src/search/knowledge-publication.js";
import { hashText } from "../../src/search/review-protocol.js";
import { knowledgeFixture } from "../support/knowledge-fixture.js";

function evaluation(task: string, modelId: string, passed: boolean) {
  return { version: "crv-stage3-evaluation-1", task, modelId, baseRevision: "a".repeat(40), weightsSha256: "b".repeat(64),
    card: { id: modelId, trainedAt: "2026-10-25T00:00:00Z" }, criteriaVersion: "crv-stage3-criteria-1.0.0", evaluatedAt: "2026-10-25T00:00:00Z",
    reservedTestRuns: 1, datasets: { reserved: { path: "fixture.json", sha256: "c".repeat(64), cases: 10 } },
    checks: [{ name: "fixture", value: passed ? 1 : 0, threshold: ">= 1", pass: passed }], comparison: [{ system: "tuned", fixture: 1 }], passed, notes: [] };
}

describe("Laya: activación atribuida, reversible y sin autoridad sobre decisiones humanas", () => {
  let pg: PgContainer, dir: string, reviewId: number, artistId: number;
  const env = { ...process.env };
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    dir = await mkdtemp(path.join(os.tmpdir(), "crv-stage3-")); process.env["CRV_STAGE3_RESULTS"] = dir;
    await writeFile(path.join(dir, "evidence_typed_decision--crv-evidence-pass.json"), JSON.stringify(evaluation("evidence_typed_decision", "crv-evidence-pass", true)));
    await writeFile(path.join(dir, "query_interpretation--crv-query-fail.json"), JSON.stringify(evaluation("query_interpretation", "crv-query-fail", false)));
    artistId = Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Fixture') RETURNING id")).rows[0].id);
    const a = knowledgeFixture(); a.object.kind = "artist"; a.object.id = artistId; a.object.name = "Fixture";
    await enqueueKnowledgeBatch({ resourceId: a.observation.resourceId, sourceObject: "fixture", captureHash: a.observation.captureHash, extractorVersion: a.observation.extractorVersion, schemaVersion: a.version, annotations: [a] });
    await runKnowledgeChunk();
    reviewId = Number((await getPool().query("SELECT review_id FROM ingest.search_knowledge_units")).rows[0].review_id);
  });
  afterAll(async () => { await closeDb(); await pg?.stop(); await rm(dir, { recursive: true, force: true }); process.env = env; resetEnvCache(); });

  it("una evaluación que no cumple los umbrales no se activa", async () => {
    await expect(recordLayaActivation({ task: "query_interpretation", modelId: "crv-query-fail", action: "activate", reason: "Prueba" }, "Brian")).rejects.toThrow(/umbrales/);
    await expect(recordLayaActivation({ task: "claim_extraction", modelId: "crv-evidence-pass", action: "activate", reason: "Prueba" }, "Brian")).rejects.toThrow(/evaluación/);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_model_activations")).rows[0].n).toBe(0);
  });

  it("activar y desactivar agregan filas atribuidas con run; las filas no se editan ni se borran", async () => {
    const on = await recordLayaActivation({ task: "evidence_typed_decision", modelId: "crv-evidence-pass", action: "activate", reason: "Cumple los criterios" }, "Brian");
    expect(on.runId).toBeGreaterThan(0);
    await expect(recordLayaActivation({ task: "evidence_typed_decision", modelId: "crv-evidence-pass", action: "activate", reason: "Otra vez" }, "Brian")).rejects.toThrow(/ya está activo/);
    let admin = await layaAdministration();
    expect(admin.active).toEqual([expect.objectContaining({ task: "evidence_typed_decision", model_id: "crv-evidence-pass", actor: "Brian" })]);
    expect(admin.publicUse).toBe(false);
    const row = (await getPool().query("SELECT evaluation_sha256,run_id FROM ingest.search_model_activations")).rows[0];
    expect(row.evaluation_sha256).toBe(hashText(await readFile(path.join(dir, "evidence_typed_decision--crv-evidence-pass.json"), "utf8")));
    await expect(getPool().query("UPDATE ingest.search_model_activations SET reason='x'")).rejects.toThrow(/solo admite filas nuevas/);
    await expect(getPool().query("DELETE FROM ingest.search_model_activations")).rejects.toThrow(/solo admite filas nuevas/);
    await recordLayaActivation({ task: "evidence_typed_decision", modelId: "crv-evidence-pass", action: "deactivate", reason: "Revertir" }, "Brian");
    admin = await layaAdministration();
    expect(admin.active).toEqual([]);
    expect(admin.history.map(h => h.action)).toEqual(["deactivate", "activate"]);
    await expect(recordLayaActivation({ task: "evidence_typed_decision", modelId: "crv-evidence-pass", action: "deactivate", reason: "Dos veces" }, "Brian")).rejects.toThrow(/no está activo/);
  });

  it("una predicción contradictoria con probabilidad casi 1 de un modelo activo no cambia la decisión humana", async () => {
    await recordLayaActivation({ task: "evidence_typed_decision", modelId: "crv-evidence-pass", action: "activate", reason: "Prueba de autoridad" }, "Brian");
    const detail = await knowledgeReviewDetail(reviewId);
    await decideKnowledge(reviewId, { expectedRevision: detail.revision, unitKey: detail.unitKey, status: "approved", reason: "Revisado", publicQuote: "Guitarras fuzz",
      criterion: { version: "timbre-attributed-v1", basis: "attributed_description", justification: "Percepción atribuida" } }, "Brian");
    const published = await publishedKnowledge("artist", artistId);
    const prior = (await getPool().query("SELECT payload FROM ingest.review_queue WHERE id=$1", [reviewId])).rows[0].payload;
    const raw = await readFile("docs/unified-search/stage2/laya-evidence-questions.json", "utf8"), document = JSON.parse(raw);
    const metadata = { model: "multilingual" as const, modelRevision: "a".repeat(40), sdkVersion: "crv-evidence-pass", questionVersion: document.version, questionHash: hashText(raw) };
    const [task] = await knowledgeInterpretationTasks(metadata);
    const sure = (options: string[], pick: string) => ({ choice: pick, probabilities: Object.fromEntries(options.map(o => [o, o === pick ? 0.999 : 0.001 / (options.length - 1)])) });
    const decisions = Object.fromEntries(Object.entries(document.questions).map(([key, q]) => {
      const options = Object.keys((q as { criteria: Record<string, string> }).criteria);
      return [key, sure(options, key === "support" ? "contradicts" : key === "object_scope" ? "different_object" : options[0]!)];
    }));
    expect((await importKnowledgeInterpretations([{ ...metadata, unitKey: task!.unitKey, inputHash: task!.inputHash, decisions, routing: { model: "multilingual" } }])).inserted).toBe(1);
    expect((await getPool().query("SELECT payload FROM ingest.review_queue WHERE id=$1", [reviewId])).rows[0].payload).toEqual(prior);
    expect(await publishedKnowledge("artist", artistId)).toEqual(published);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE payload->>'type'='search_knowledge_model_conflict' AND status='open'")).rows[0].n).toBe(1);
  });
});
