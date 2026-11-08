// CRV · Retención del diario de cambios y de las corridas de IA (2026-11-08).
//
// DIARIO (`ingest.change_journal`). El diario permite deshacer un run. Para
// las tablas `strict` (el catálogo) se conserva entero y para siempre. Las
// `soft` (colas, conflictos, claims, revisiones, métricas sociales) solo se
// conservan `keepDays` días: el deshacer ya trata esas filas como «se dejan y
// se informa», y eran el 90 % del diario (9,5 de 10,5 millones de filas el
// 2026-11-08). Pasada la ventana, deshacer un run viejo sigue devolviendo el
// catálogo; sus colas quedan como están.
//
// IA (`ingest.ai_runs`). La caché del gateway solo lee `prompt_hash`, `model`
// y `output_summary` (src/ai/gateway.ts). Pasada la ventana se vacían el
// prompt completo y las dos copias de la respuesta (`response_payload` y
// `raw_response`); quedan el hash, los resúmenes, los tokens y el error.
//
// Ambas tareas van por lotes cortos (una transacción por lote), recorriendo
// la clave primaria hacia adelante, bajo un candado de sesión: dos procesos no
// se pisan y un corte se reanuda solo, porque cada lote es idempotente.
import type { PoolClient } from "pg";
import { getPool } from "./client.js";

export const RETENTION_LOCK = "crv:db:retention";
export const DEFAULT_KEEP_DAYS = 30;
const COMPACTED_REQUEST = "compactado por retención";

export interface RetentionOptions {
  dryRun: boolean;
  keepDays?: number;
  /** Filas de clave primaria recorridas por lote (por defecto 20.000). */
  batchSize?: number;
  /** Pausa entre lotes, para no acaparar disco ni WAL (por defecto 50 ms). */
  pauseMs?: number;
}

export interface RetentionResult {
  status: "ok" | "skipped";
  dryRun: boolean;
  keepDays: number;
  journalPruned: number;
  aiRunsCompacted: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function softTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    "SELECT table_name FROM ingest.change_journal_tables WHERE policy='soft' ORDER BY table_name");
  return rows.map((row) => row.table_name);
}

/** Primer id del diario que ya está dentro de la ventana (o el siguiente al último). */
async function journalLimit(client: PoolClient, keepDays: number): Promise<number> {
  // `at` crece con `id`: el primero dentro de la ventana marca el final del barrido.
  const { rows } = await client.query<{ id: string | null }>(`
    SELECT coalesce(
      (SELECT id FROM ingest.change_journal WHERE at >= now() - make_interval(days => $1::int) ORDER BY id LIMIT 1),
      (SELECT max(id) + 1 FROM ingest.change_journal)) AS id`, [keepDays]);
  return Number(rows[0]?.id ?? 0);
}

async function pruneJournal(client: PoolClient, options: Required<Omit<RetentionOptions, "dryRun">> & { dryRun: boolean }): Promise<number> {
  const tables = await softTables(client);
  if (tables.length === 0) return 0;
  const limit = await journalLimit(client, options.keepDays);
  if (options.dryRun) {
    const { rows } = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM ingest.change_journal WHERE id < $1 AND table_name = ANY($2::text[])", [limit, tables]);
    return Number(rows[0]?.n ?? 0);
  }
  let from = Number((await client.query<{ id: string | null }>("SELECT min(id) AS id FROM ingest.change_journal")).rows[0]?.id ?? limit);
  let pruned = 0;
  while (from < limit) {
    const to = Math.min(from + options.batchSize, limit);
    const result = await client.query(
      "DELETE FROM ingest.change_journal WHERE id >= $1 AND id < $2 AND table_name = ANY($3::text[])", [from, to, tables]);
    pruned += result.rowCount ?? 0;
    from = to;
    if (options.pauseMs > 0) await sleep(options.pauseMs);
  }
  return pruned;
}

const AI_PENDING = `created_at < now() - make_interval(days => $1::int)
  AND (request_payload IS DISTINCT FROM to_jsonb($2::text) OR response_payload IS NOT NULL OR raw_response IS NOT NULL)`;

async function compactAiRuns(client: PoolClient, options: Required<Omit<RetentionOptions, "dryRun">> & { dryRun: boolean }): Promise<number> {
  if (options.dryRun) {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ingest.ai_runs WHERE ${AI_PENDING}`, [options.keepDays, COMPACTED_REQUEST]);
    return Number(rows[0]?.n ?? 0);
  }
  const bounds = (await client.query<{ lo: string | null; hi: string | null }>(
    "SELECT min(id) AS lo, max(id) AS hi FROM ingest.ai_runs")).rows[0];
  let from = Number(bounds?.lo ?? 0);
  const hi = Number(bounds?.hi ?? -1);
  let compacted = 0;
  // Las corridas pesan ~13 kB: lotes más chicos que los del diario.
  const step = Math.max(1, Math.floor(options.batchSize / 10));
  while (from <= hi) {
    const result = await client.query(`
      UPDATE ingest.ai_runs SET request_payload = to_jsonb($2::text), response_payload = NULL, raw_response = NULL
       WHERE id >= $3 AND id < $4 AND ${AI_PENDING}`, [options.keepDays, COMPACTED_REQUEST, from, from + step]);
    compacted += result.rowCount ?? 0;
    from += step;
    if (options.pauseMs > 0 && (result.rowCount ?? 0) > 0) await sleep(options.pauseMs);
  }
  return compacted;
}

/** Poda el diario de las tablas `soft` y compacta las corridas de IA más viejas que la ventana. */
export async function runRetention(options: RetentionOptions): Promise<RetentionResult> {
  const keepDays = Math.max(1, options.keepDays ?? DEFAULT_KEEP_DAYS);
  const settings = { dryRun: options.dryRun, keepDays, batchSize: Math.max(1, options.batchSize ?? 20_000), pauseMs: Math.max(0, options.pauseMs ?? 50) };
  const base = { dryRun: options.dryRun, keepDays };
  const client = await getPool().connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [RETENTION_LOCK])).rows[0]?.locked === true;
    if (!locked) return { ...base, status: "skipped", journalPruned: 0, aiRunsCompacted: 0 };
    // Una tarea de mantenimiento, no una consulta de la web: sin tope de tiempo por sentencia.
    await client.query("SET statement_timeout = 0");
    const journalPruned = await pruneJournal(client, settings);
    const aiRunsCompacted = await compactAiRuns(client, settings);
    return { ...base, status: "ok", journalPruned, aiRunsCompacted };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [RETENTION_LOCK]).catch(() => undefined);
    client.release();
  }
}
