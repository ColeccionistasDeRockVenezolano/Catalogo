import { getPool } from "../db/client.js";
import { getEnv } from "../config/env.js";
import type { PoolClient } from "pg";
import { dailyCycleForDate, dailyDate } from "../shared/daily-cycle.js";

export const DISCOVERY_FALLBACK = "Busca artistas, bandas, álbumes o canciones";
export async function searchSuggestions(client?: PoolClient, date = dailyDate()) {
  const env = getEnv();
  const config = { dailyCycle: dailyCycleForDate(date), enabled: env.CRV_DISCOVERY_ENABLED, intervalMs: env.CRV_DISCOVERY_INTERVAL_MS,
    refreshMs: 15000, fallback: DISCOVERY_FALLBACK,
    groupPolicy: env.CRV_DISCOVERY_GROUP_POLICY.split(",").map(x => x.trim()).filter(Boolean) };
  if (!config.enabled) return { ...config, suggestions: [] };
  const pool = client ?? getPool();
  if (!(await pool.query("SELECT to_regclass('ingest.artist_search_suggestions') AS t")).rows[0]?.t) return { ...config, suggestions: [] };
  // Caché de servidor y HTTP de duración cero: cada lectura refleja renombres,
  // retiros, fusiones, deshacer y cambios SQL, incluso desde otro proceso.
  const { rows } = await pool.query<{
    id: string; name: string; exposure_group: string; priority: number; valid_until: Date | null;
  }>(`SELECT DISTINCT ON (a.id) a.id::text,a.name,s.exposure_group,s.priority,s.valid_until
    FROM ingest.artist_search_suggestions s JOIN ingest.catalog_artists a ON a.id=s.artist_id
    JOIN ingest.claim_evidence e ON e.id=s.evidence_id JOIN ingest.claims c ON c.id=e.claim_id
    WHERE s.state='approved' AND s.valid_from<=now() AND (s.valid_until IS NULL OR s.valid_until>now())
      AND c.artist_id=a.id AND c.status NOT IN ('rejected','superseded')
      AND a.name ~ '[[:alpha:]]' AND lower(trim(a.name)) NOT IN ('various artists','unknown','desconocido','varios artistas')
      AND NOT EXISTS (SELECT 1 FROM ingest.artist_search_suggestions conflict
        WHERE conflict.artist_id=a.id AND conflict.state IN ('proposed','rejected','withdrawn'))
    ORDER BY a.id,s.priority DESC,s.id DESC`);
  return { ...config, suggestions: rows.map(row => ({ id: Number(row.id), name: row.name,
    group: row.exposure_group, priority: row.priority, validUntil: row.valid_until?.toISOString() ?? null })) };
}
