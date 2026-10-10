import { getPool } from "../db/client.js";
import { closedUtcDay } from "./aggregate.js";
import { z } from "zod";

const sampleSchema = z.object({ impressions: z.number().int().nonnegative(), acceptances: z.number().int().nonnegative(),
  searches: z.number().int().nonnegative(), visits: z.number().int().nonnegative(), days: z.number().int().nonnegative(), configs: z.array(z.string()) });
const windowSchema = z.object({ from: z.string(), until: z.string() });
export const trendPrototypeSchema = z.object({
  title: z.literal("Tendencia en CRV"), internal: z.literal(true), published: z.literal(false), source: z.string(),
  methodology: z.string(), thresholds: z.object({ days: z.number(), impressionsPerWindow: z.number(), acceptancesPerWindow: z.number() }),
  limitations: z.string(), status: z.enum(["not_migrated","not_aggregated","stale","ready"]),
  updatedAt: z.union([z.date(),z.string()]).nullable(),
  period: z.object({ previous: windowSchema, current: windowSchema, timezone: z.literal("UTC"), untilExclusive: z.literal(true) }).nullable(),
  results: z.array(z.object({ id: z.number(), name: z.string().nullable(), status: z.enum(["insufficient_data","evaluated"]),
    reasons: z.array(z.string()), direction: z.enum(["rising","falling","inconclusive"]).nullable(), previous: sampleSchema, current: sampleSchema,
    previousRate: z.number(), currentRate: z.number(), difference: z.number(), interval95: z.array(z.number()).length(2) })),
});

export interface WindowSample {
  impressions: number; acceptances: number; searches: number; visits: number;
  days: number; configs: string[];
}
export const TREND_METHOD = "crv-acceptance-rate-beta1-v1";
export function compareWindows(previous: WindowSample, current: WindowSample, identityStable = true) {
  const rate = (s: WindowSample) => (s.acceptances + 1) / (s.impressions + 2);
  const reasons: string[] = [];
  if (!identityStable) reasons.push("identity_changed");
  if (previous.days !== 7 || current.days !== 7) reasons.push("incomplete_days");
  if (previous.impressions < 100 || current.impressions < 100 || previous.acceptances < 20 || current.acceptances < 20) reasons.push("insufficient_volume");
  if (!previous.configs.length || JSON.stringify([...previous.configs].sort()) !== JSON.stringify([...current.configs].sort())
    || previous.configs.length !== 1 || current.configs.length !== 1) reasons.push("exposure_changed");
  if ([previous,current].some(s => s.acceptances>s.impressions || s.searches>s.acceptances || s.visits>s.searches)) reasons.push("invalid_funnel");
  const before = rate(previous), after = rate(current);
  const difference = after - before;
  const standardError = Math.sqrt(before * (1-before)/(previous.impressions+3) + after*(1-after)/(current.impressions+3));
  return { status: reasons.length ? "insufficient_data" : "evaluated", reasons,
    direction: reasons.length ? null : Math.abs(difference) <= 1.96 * standardError ? "inconclusive" : difference > 0 ? "rising" : "falling",
    previous, current, previousRate: before, currentRate: after, difference,
    interval95: [difference-1.96*standardError,difference+1.96*standardError] };
}
export async function trendPrototype(now = new Date()) {
  const pool = getPool();
  const exists = (await pool.query("SELECT to_regclass('ingest.discovery_metric_daily') AS t")).rows[0]?.t;
  const base = { title: "Tendencia en CRV", internal: true, published: false, source: "CRV: sugerencias del buscador principal",
    period: null,
    methodology: TREND_METHOD, thresholds: { days: 7, impressionsPerWindow: 100, acceptancesPerWindow: 20 },
    limitations: "Sesiones efímeras, no personas únicas. Comparación descriptiva exploratoria, sesgo residual de exposición; no popularidad ni reconocimiento editorial." };
  if (!exists) return { ...base, status: "not_migrated", updatedAt: null, results: [] };
  const job = (await pool.query("SELECT finished_at,summary FROM ingest.discovery_metric_jobs WHERE status='completed' ORDER BY id DESC LIMIT 1")).rows[0];
  if (!job) return { ...base, status: "not_aggregated", updatedAt: null, results: [] };
  const end = job.summary.closedBefore as string;
  // Si el actualizador se detiene, jamás presentar una fotografía vieja como vigente.
  if (end !== closedUtcDay(now)) return { ...base, status: "stale", updatedAt: job.finished_at, results: [] };
  const rows = (await pool.query(`SELECT d.*,s.artist_id,a.name,
    (SELECT count(*) FROM ingest.discovery_metric_subjects other WHERE other.artist_id=s.artist_id) AS identity_count
    FROM ingest.discovery_metric_daily d JOIN ingest.discovery_metric_subjects s ON s.id=d.subject_id
    LEFT JOIN public.artists a ON a.id=s.artist_id WHERE day >= $1::date - 14 AND day < $1::date
    ORDER BY d.subject_id,d.day,d.kind`, [end])).rows;
  const subjects = new Map<number, { id: number; name: string | null; stable: boolean; previous: WindowSample; current: WindowSample }>();
  const empty = (): WindowSample => ({ impressions: 0, acceptances: 0, searches: 0, visits: 0, days: 0, configs: [] });
  const boundary = new Date(Date.parse(`${end}T00:00:00Z`) - 7*86400000).toISOString().slice(0,10);
  const fields = { impression: "impressions", acceptance: "acceptances", search: "searches", visit: "visits" } as const;
  for (const row of rows) {
    const id = Number(row.subject_id);
    if (!subjects.has(id)) subjects.set(id, { id, name: row.name, stable: Number(row.artist_id) === id && Number(row.identity_count) === 1, previous: empty(), current: empty() });
    const s = subjects.get(id)!; const w = row.day < boundary ? s.previous : s.current;
    w[fields[row.kind as keyof typeof fields]] += row.count;
    if (row.kind === "impression") { w.days++; w.configs = [...new Set([...w.configs,...row.exposure_configs])]; }
  }
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 14*86400000).toISOString().slice(0,10);
  return { ...base, status: "ready", updatedAt: job.finished_at,
    period: { previous: { from: start, until: boundary }, current: { from: boundary, until: end }, timezone: "UTC", untilExclusive: true },
    results: [...subjects.values()].map(s => ({ id: s.id, name: s.name, ...compareWindows(s.previous,s.current,s.stable) })) };
}
