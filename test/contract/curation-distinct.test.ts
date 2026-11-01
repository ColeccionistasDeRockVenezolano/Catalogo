import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { distinctAction, undoDistinct, type DistinctParams } from "../../src/curation/actions/distinct.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import type { ActionFinding, ActionPreview } from "../../src/curation/actions/types.js";

// Etapa 3: declarar «son distintas» cierra la tarea y no reaparece; deshacer
// borra la declaración y reabre la tarea.
describe("descartar duplicado y su inversa (contrato)", () => {
  let container: PgContainer;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
  }, 120_000);

  afterAll(async () => { await closeDb(); await container?.stop(); }, 60_000);

  async function one(sql: string, params: unknown[] = []): Promise<number> {
    return Number((await getPool().query<{ id: string }>(sql, params)).rows[0]!.id);
  }

  it("declara distintas, cierra la revisión y el undo reabre", async () => {
    const a = await one("INSERT INTO public.artists(name) VALUES('Par A') RETURNING id");
    const b = await one("INSERT INTO public.artists(name) VALUES('Par B') RETURNING id");
    const reviewId = await one(`
      INSERT INTO ingest.review_queue(kind,artist_a_id,artist_b_id,priority,status,payload,notes)
      VALUES ('possible_duplicate',$1,$2,8,'open','{}'::jsonb,'contrato') RETURNING id`, [Math.min(a, b), Math.max(a, b)]);
    const finding: ActionFinding = {
      id: 1, detector: "artistas_duplicados_evidencia", signature: "evidencia_determinista", status: "open",
      entity: { kind: "artist", id: a, label: "Par A" }, field: "name", value: "Par A", suggestedValue: null,
      related: [{ kind: "artist", id: b, label: "Par B" }], title: "Par A y Par B",
      evidence: { pair: [Math.min(a, b), Math.max(a, b)] },
    };
    const params: DistinctParams = {
      kind: "artist", aId: a, bId: b,
    };
    const preview: ActionPreview = {
      touched: [], before: {}, after: {}, blocked: null, collisions: [], warnings: [], proposal: null,
    };
    const { runId } = await withOperatorRun({
      name: "test:distinct", operator: "prueba", note: "Son dos bandas distintas del mismo nombre.",
      params: { pair: [a, b] },
    }, async (context) => distinctAction.apply(context, finding, params, preview));

    const declared = (await getPool().query<{ note: string; run_id: string; review_id: string }>(
      "SELECT note,run_id::text,review_id::text FROM ingest.curation_distinct_pairs WHERE kind='artist' AND a_id=$1 AND b_id=$2",
      [Math.min(a, b), Math.max(a, b)])).rows[0]!;
    expect(declared.note).toContain("distintas");
    expect(Number(declared.run_id)).toBe(runId);
    expect(Number(declared.review_id)).toBe(reviewId);
    expect((await getPool().query<{ status: string }>("SELECT status FROM ingest.review_queue WHERE id=$1", [reviewId])).rows[0]!.status).toBe("dismissed");

    await withOperatorRun({
      name: "test:distinct:undo", operator: "prueba", note: "undo del contrato",
      params: { runId },
    }, async (context) => undoDistinct(context, runId));

    expect((await getPool().query("SELECT 1 FROM ingest.curation_distinct_pairs WHERE kind='artist' AND a_id=$1 AND b_id=$2",
      [Math.min(a, b), Math.max(a, b)])).rowCount).toBe(0);
    expect((await getPool().query<{ status: string }>("SELECT status FROM ingest.review_queue WHERE id=$1", [reviewId])).rows[0]!.status).toBe("open");
  }, 60_000);
});
