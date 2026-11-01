import { afterAll, beforeAll, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { closeEvidenceReview, evidenceHash } from "../../src/review/evidence-closure.js";
let container: PgContainer;
const originalUrl = process.env["DATABASE_URL"];
beforeAll(async () => {
  container = await startPgContainer(); process.env["DATABASE_URL"] = container.databaseUrl; resetEnvCache();
  await applyCore(container.name); await migrateUp();
});
afterAll(async () => {
  await closeDb(); await container?.stop();
  if (originalUrl === undefined) delete process.env["DATABASE_URL"]; else process.env["DATABASE_URL"] = originalUrl;
  resetEnvCache();
});
it("bloquea cierres obsoletos, conserva el veredicto, es idempotente y respeta el ensayo con rollback", async () => {
  const payload = { name: "Músico sin identidad establecida", reason: "membership_identity" };
  const outcome = await withOperatorRun({ name: "test:evidence-closure", operator: "test", note: "Verificar cierre reversible con evidencia" }, async context => {
    const id = Number((await context.client.query("INSERT INTO ingest.review_queue(kind,payload) VALUES('manual_review',$1::jsonb) RETURNING id", [JSON.stringify(payload)])).rows[0].id);
    const decision = { reviewId: id, expectedPayloadHash: evidenceHash(payload), sourceFingerprint: evidenceHash("source"), verdict: "unverifiable" as const,
      reason: "No se establece una identidad con las fuentes consultadas; se conserva la afirmación sin declararla falsa.", identityClaim: false,
      evidence: [{ url: "https://example.org/source", kind: "secondary" as const, quote: "Músico (guitarra)", consultedAt: "2026-10-30" }],
      research: [{ query: "Músico banda", status: 200, receipt: "one.json" }, { query: "Músico banda integrantes", status: 200, receipt: "two.json" }] };
    await expect(closeEvidenceReview(context, { ...decision, expectedPayloadHash: evidenceHash("changed") })).rejects.toThrow("cambió");
    expect(await closeEvidenceReview(context, decision)).toEqual({ id, changed: true });
    expect(await closeEvidenceReview(context, decision)).toEqual({ id, changed: false });
    const row = (await context.client.query("SELECT status,payload FROM ingest.review_queue WHERE id=$1", [id])).rows[0];
    expect(row.status).toBe("dismissed"); expect(row.payload.name).toBe(payload.name);
    expect(row.payload.rhvClosure.verdict).toBe("unverifiable"); expect(row.payload.rhvClosure.reopenOnEvidenceChange).toBe(true);
    return id;
  }, { rollbackOnly: true });
  expect((await getPool().query("SELECT id FROM ingest.review_queue WHERE id=$1", [outcome.result])).rowCount).toBe(0);
});
