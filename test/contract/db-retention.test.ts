import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { RETENTION_LOCK, runRetention } from "../../src/db/retention.js";

// 2026-11-08 — Lo que llenaba el diario de cambios: (1) actualizaciones de
// claims que solo movían `updated_at` y (2) entradas de colas que nunca se
// podaban. El disparador de 0130 descarta (1) en origen; `runRetention` poda
// (2) sin tocar jamás el diario del catálogo ni lo que está dentro de la ventana.
describe("diario de cambios: guardián de claims y retención (contrato)", () => {
  let container: PgContainer;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
  }, 120_000);

  afterAll(async () => { await closeDb(); await container?.stop(); }, 60_000);

  const one = async (sql: string, params: unknown[] = []): Promise<number> =>
    Number((await getPool().query<{ id: string }>(sql, params)).rows[0]!.id);

  async function newClaim(): Promise<number> {
    const artistId = await one("INSERT INTO public.artists(name) VALUES('Guardián de prueba') RETURNING id");
    const sourceId = await one(`
      INSERT INTO ingest.sources(slug,name,site_type,trust_level,enabled)
      VALUES('test-retencion','Fuente de prueba','website','high',false)
      ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
    const rawHash = createHash("sha256").update(`retencion:${artistId}`).digest("hex");
    return one(
      "INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,raw_hash,status) VALUES($1,'artist',$2,'biography','\"ficha\"'::jsonb,$3,'conflict') RETURNING id",
      [sourceId, artistId, rawHash]);
  }

  const journalOf = async (claimId: number): Promise<number> => Number((await getPool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM ingest.change_journal WHERE table_name='ingest.claims' AND row_pk=jsonb_build_object('id',$1::bigint)",
    [claimId])).rows[0]!.n);

  it("una actualización que solo mueve updated_at no reescribe el claim ni llega al diario", async () => {
    const claimId = await newClaim();
    const before = (await getPool().query<{ updated_at: string }>("SELECT updated_at::text FROM ingest.claims WHERE id=$1", [claimId])).rows[0]!.updated_at;
    const journalBefore = await journalOf(claimId);

    const touch = await getPool().query("UPDATE ingest.claims SET status='conflict', updated_at=now() + interval '1 hour' WHERE id=$1", [claimId]);
    expect(touch.rowCount).toBe(0);
    const after = (await getPool().query<{ updated_at: string }>("SELECT updated_at::text FROM ingest.claims WHERE id=$1", [claimId])).rows[0]!.updated_at;
    expect(after).toBe(before);
    expect(await journalOf(claimId)).toBe(journalBefore);

    const real = await getPool().query("UPDATE ingest.claims SET status='rejected', updated_at=now() WHERE id=$1", [claimId]);
    expect(real.rowCount).toBe(1);
    expect(await journalOf(claimId)).toBe(journalBefore + 1);
  });

  it("poda el diario de las tablas soft fuera de la ventana y compacta las corridas de IA viejas", async () => {
    const pool = getPool();
    await pool.query("DELETE FROM ingest.change_journal");
    const entry = (table: string, daysAgo: number) => pool.query(
      `INSERT INTO ingest.change_journal(table_name, op, row_pk, new_data, at)
       VALUES($1, 'I', '{"id": 1}', '{"id": 1}', now() - make_interval(days => $2::int))`, [table, daysAgo]);
    await entry("ingest.review_queue", 60);
    await entry("ingest.claims", 45);
    await entry("public.albums", 60);
    await entry("ingest.review_queue", 5);

    const run = (daysAgo: number, tag: string) => pool.query(`
      INSERT INTO ingest.ai_runs(prompt_hash, task_kind, model, schema_version, status, input_summary, output_summary,
                                 request_payload, response_payload, raw_response, created_at)
      VALUES($1, 'biography', 'modelo', 'v1', 'validated', '{}', '{"bio": "resumen"}',
             '{"prompt": "largo"}', '{"respuesta": "larga"}', 'cruda', now() - make_interval(days => $2::int))`,
    [createHash("sha256").update(tag).digest("hex"), daysAgo]);
    await run(40, "vieja");
    await run(2, "reciente");

    const dry = await runRetention({ dryRun: true, keepDays: 30, pauseMs: 0 });
    expect(dry).toMatchObject({ status: "ok", journalPruned: 2, aiRunsCompacted: 1 });
    expect(Number((await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM ingest.change_journal")).rows[0]!.n)).toBe(4);

    const real = await runRetention({ dryRun: false, keepDays: 30, batchSize: 1, pauseMs: 0 });
    expect(real).toMatchObject({ status: "ok", journalPruned: 2, aiRunsCompacted: 1 });
    const left = await pool.query<{ table_name: string }>("SELECT table_name FROM ingest.change_journal ORDER BY id");
    expect(left.rows.map((row) => row.table_name)).toEqual(["public.albums", "ingest.review_queue"]);

    const runs = await pool.query<{ created_old: boolean; request_payload: unknown; response_payload: unknown; raw_response: string | null; output_summary: unknown }>(
      "SELECT created_at < now() - interval '30 days' AS created_old, request_payload, response_payload, raw_response, output_summary FROM ingest.ai_runs ORDER BY id");
    const [old, recent] = runs.rows;
    expect(old).toMatchObject({ created_old: true, request_payload: "compactado por retención", response_payload: null, raw_response: null, output_summary: { bio: "resumen" } });
    expect(recent).toMatchObject({ created_old: false, request_payload: { prompt: "largo" }, raw_response: "cruda" });

    expect(await runRetention({ dryRun: false, keepDays: 30, pauseMs: 0 })).toMatchObject({ journalPruned: 0, aiRunsCompacted: 0 });
  });

  it("no pisa a otro proceso que tenga el candado", async () => {
    const holder = await getPool().connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext($1))", [RETENTION_LOCK]);
      expect((await runRetention({ dryRun: false, pauseMs: 0 })).status).toBe("skipped");
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext($1))", [RETENTION_LOCK]);
      holder.release();
    }
  });
});
