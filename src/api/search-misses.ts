// CRV · Búsquedas sin resultados (2026-10-13, migración 0072).
//
// Para saber qué siglas, apodos o grafías busca la gente y no encuentra. Se
// cuenta en memoria y se vuelca cada FLUSH_MS en UNA sola sentencia: una
// ráfaga de consultas inventadas no se convierte en una escritura por
// consulta. Cada lote guarda como mucho MAX_KEYS_PER_FLUSH consultas (las más
// repetidas), y lo que lleva RETENTION_DAYS sin repetirse se poda. No se
// guarda IP, usuario ni la hora de cada búsqueda.
import { sanitizeSearchText } from "../search/privacy.js";
import { getPool } from "../db/client.js";
import { moduleLogger } from "../logger/index.js";
import { normalizeEntityName } from "../normalization/entity-name.js";

const log = moduleLogger("api:search-misses");

const FLUSH_MS = 5 * 60_000;
/** Consultas distintas que se retienen entre volcados (las nuevas por encima se ignoran). */
const MAX_PENDING_KEYS = 5_000;
const MAX_KEYS_PER_FLUSH = 500;
const RETENTION_DAYS = 180;
const MIN_LENGTH = 2;
const MAX_LENGTH = 60;

const pending = new Map<string, { sample: string; misses: number }>();
let timer: NodeJS.Timeout | undefined;

export function recordSearchMiss(q: string): void {
  const sample = sanitizeSearchText(q);
  const key = normalizeEntityName(sample).secondaryKey;
  if (key.length < MIN_LENGTH || key.length > MAX_LENGTH) return;
  const entry = pending.get(key);
  if (entry) entry.misses += 1;
  else if (pending.size < MAX_PENDING_KEYS) pending.set(key, { sample, misses: 1 });
  timer ??= setInterval(() => { void flushSearchMisses(); }, FLUSH_MS).unref();
}

/** Vuelca lo pendiente en una sola sentencia. Si falla, se pierde ese lote (es una métrica). */
export async function flushSearchMisses(): Promise<number> {
  if (pending.size === 0) return 0;
  const batch = [...pending.entries()].sort((left, right) => right[1].misses - left[1].misses).slice(0, MAX_KEYS_PER_FLUSH);
  pending.clear();
  try {
    await getPool().query(
      `INSERT INTO ingest.search_misses AS m (normalized_query, sample_query, misses)
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[])
       ON CONFLICT (normalized_query) DO UPDATE
         SET misses = m.misses + EXCLUDED.misses, sample_query = EXCLUDED.sample_query, last_seen = now()`,
      [batch.map(([key]) => key), batch.map(([, entry]) => entry.sample), batch.map(([, entry]) => entry.misses)]);
    await getPool().query(`DELETE FROM ingest.search_misses WHERE last_seen < now() - make_interval(days => $1)`, [RETENTION_DAYS]);
    return batch.length;
  } catch {
    log.warn({ code: "legacy_search_misses_write_failed" }, "no se pudieron guardar las búsquedas sin resultados");
    return 0;
  }
}

export interface SearchMiss { query: string; sample: string; misses: number; firstSeen: string; lastSeen: string }

export async function listSearchMisses(limit: number, sinceDays: number): Promise<SearchMiss[]> {
  const { rows } = await getPool().query<{ normalized_query: string; sample_query: string; misses: number; first_seen: Date; last_seen: Date }>(
    `SELECT normalized_query, sample_query, misses, first_seen, last_seen FROM ingest.search_misses
      WHERE last_seen >= now() - make_interval(days => $2)
      ORDER BY misses DESC, last_seen DESC LIMIT $1`, [limit, sinceDays]);
  return rows.map((row) => ({ query: sanitizeSearchText(row.normalized_query), sample: sanitizeSearchText(row.sample_query), misses: row.misses,
    firstSeen: row.first_seen.toISOString(), lastSeen: row.last_seen.toISOString() }));
}
