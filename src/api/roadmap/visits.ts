// CRV · Contador de visitas y métricas (Fase 2).
//
// Cuenta personas por día, no cargas: la identidad es un HMAC de la IP con el
// secreto de la instancia y la fecha, y solo sirve para deduplicar ese día. El
// histórico agregado por país vive en `project_visit_stats`; el registro fino
// de `project_visits` se poda a los 3 días.
import { createHmac } from "node:crypto";
import { getEnv } from "../../config/env.js";
import { getPool } from "../../db/client.js";
import { withTransaction } from "../community/store.js";
import { DAILY_TIME_ZONE } from "../../shared/daily-cycle.js";

const NOW = "to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')";
const ONLINE_MINUTES = 5;
const RETENTION_DAYS = 3;
const UNKNOWN_COUNTRY = "zz";
const NON_COUNTRIES = new Set(["xx", "t1", "zz"]);
const CODE_RE = /^[a-z]{2}$/u;

export type Lang = "es" | "en";
export interface CountryCount { code: string; flag: string | null; name: string; count: number }
export interface VisitStats {
  today: number; total: number; online: number;
  todayCountries: CountryCount[]; onlineCountries: CountryCount[]; totalCountries: CountryCount[];
}

export function localDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function dayOffset(days: number): string {
  return localDay(new Date(Date.now() + days * 24 * 3600 * 1000));
}

export function normalizeCountry(raw: string | null | undefined): string {
  const code = String(raw ?? "").trim().toLowerCase();
  if (!CODE_RE.test(code) || NON_COUNTRIES.has(code)) return UNKNOWN_COUNTRY;
  return code;
}

function secret(): string {
  return getEnv().CRV_VISITS_SECRET ?? getEnv().CRV_CHAT_SECRET;
}

export function visitorFingerprint(projectId: number, day: string, ip: string): string {
  return createHmac("sha256", secret()).update(`visit:${projectId}:${day}:${ip}`).digest("hex").slice(0, 32);
}

/** Los rastreadores no suman al contador de personas. */
export function isBot(userAgent: string | undefined): boolean {
  if (!userAgent || !userAgent.trim()) return true;
  return /bot|crawl|spider|slurp|headless|phantom|curl|wget|python-requests|httpclient|facebookexternalhit|preview|monitor/iu.test(userAgent);
}

export async function recordVisit(projectId: number, input: { ip: string | null; country: string; userAgent: string | undefined }): Promise<boolean> {
  if (!input.ip || isBot(input.userAgent)) return false;
  const day = localDay();
  const visitor = visitorFingerprint(projectId, day, input.ip);
  const country = normalizeCountry(input.country);
  const inserted = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO auth.project_visits (project_id, day, country, visitor) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, day, visitor) DO NOTHING RETURNING id`, [projectId, day, country, visitor]);
    if (result.rowCount) {
      await client.query(
        `INSERT INTO auth.project_visit_stats (project_id, country, visits) VALUES ($1, $2, 1)
         ON CONFLICT (project_id, country) DO UPDATE SET visits = auth.project_visit_stats.visits + 1, updated_at = ${NOW}`,
        [projectId, country]);
    } else {
      await client.query(`UPDATE auth.project_visits SET last_seen = ${NOW} WHERE project_id = $1 AND day = $2 AND visitor = $3`,
        [projectId, day, visitor]);
    }
    return Boolean(result.rowCount);
  });
  await getPool().query("DELETE FROM auth.project_visits WHERE project_id = $1 AND day < $2", [projectId, dayOffset(-RETENTION_DAYS)]);
  return inserted;
}

export function countryName(code: string, lang: Lang): string {
  if (code === UNKNOWN_COUNTRY || code === "other") {
    return lang === "en" ? (code === "other" ? "Other countries" : "Unknown") : (code === "other" ? "Otros países" : "Desconocido");
  }
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function toCountryCounts(rows: Array<{ country: string; count: number }>, lang: Lang, max = 5): CountryCount[] {
  const visible = rows.slice(0, max).map((row) => ({
    code: row.country,
    flag: CODE_RE.test(row.country) && !NON_COUNTRIES.has(row.country) ? row.country : null,
    name: countryName(row.country, lang),
    count: row.count,
  }));
  const rest = rows.slice(max).reduce((sum, row) => sum + row.count, 0);
  if (rest > 0) visible.push({ code: "other", flag: null, name: countryName("other", lang), count: rest });
  return visible;
}

export async function visitStats(projectId: number, lang: Lang = "es"): Promise<VisitStats> {
  const pool = getPool();
  const day = localDay();
  const [today, total, online, todayRows, onlineRows, totalRows] = await Promise.all([
    pool.query<{ n: number }>("SELECT count(*)::int AS n FROM auth.project_visits WHERE project_id = $1 AND day = $2", [projectId, day]),
    pool.query<{ n: number }>("SELECT coalesce(sum(visits), 0)::int AS n FROM auth.project_visit_stats WHERE project_id = $1", [projectId]),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM auth.project_visits WHERE project_id = $1
      AND last_seen >= to_char(timezone('UTC', statement_timestamp()) - interval '${ONLINE_MINUTES} minutes', 'YYYY-MM-DD HH24:MI:SS')`, [projectId]),
    pool.query<{ country: string; count: number }>(
      `SELECT country, count(*)::int AS count FROM auth.project_visits WHERE project_id = $1 AND day = $2
       GROUP BY country ORDER BY count DESC, country ASC`, [projectId, day]),
    pool.query<{ country: string; count: number }>(
      `SELECT country, count(*)::int AS count FROM auth.project_visits WHERE project_id = $1
       AND last_seen >= to_char(timezone('UTC', statement_timestamp()) - interval '${ONLINE_MINUTES} minutes', 'YYYY-MM-DD HH24:MI:SS')
       GROUP BY country ORDER BY count DESC, country ASC`, [projectId]),
    pool.query<{ country: string; count: number }>(
      `SELECT country, visits::int AS count FROM auth.project_visit_stats WHERE project_id = $1 AND visits > 0
       ORDER BY count DESC, country ASC`, [projectId]),
  ]);
  return {
    today: today.rows[0]?.n ?? 0,
    total: total.rows[0]?.n ?? 0,
    online: online.rows[0]?.n ?? 0,
    todayCountries: toCountryCounts(todayRows.rows, lang),
    onlineCountries: toCountryCounts(onlineRows.rows, lang),
    totalCountries: toCountryCounts(totalRows.rows, lang),
  };
}

export interface AdminVisits extends VisitStats {
  days: number;
  daily: Array<{ day: string; visits: number; requests: number; visitors: number; uniqueVisitors: number }>;
  pages: Array<{ page: string; category: string; requests: number; visitors: number }>;
  agents: Array<{ agent: string; requests: number }>;
  trafficRequests: number;
}

export async function adminVisits(projectId: number, days: number, lang: Lang = "es"): Promise<AdminVisits> {
  const stats = await visitStats(projectId, lang);
  const span = Math.min(90, Math.max(1, Math.trunc(days)));
  const from = dayOffset(-(span - 1));
  const pool = getPool();
  const [visitsRows, trafficRows, uniqueRows, pageRows, agentRows] = await Promise.all([
    pool.query<{ day: string; n: number }>(
      "SELECT day, count(*)::int AS n FROM auth.project_visits WHERE project_id = $1 AND day >= $2 GROUP BY day ORDER BY day DESC",
      [projectId, from]),
    pool.query<{ day: string; requests: number; visitors: number }>(
      `SELECT day, sum(requests)::int AS requests, sum(visitors)::int AS visitors
         FROM auth.traffic_daily WHERE coalesce(project_id, 0) = $1 AND day >= $2
        GROUP BY day ORDER BY day DESC`, [projectId, from]),
    pool.query<{ day: string; n: number }>(
      "SELECT day, count(*)::int AS n FROM auth.traffic_visitors WHERE project_key = $1 AND day >= $2 GROUP BY day",
      [projectId, from]),
    pool.query<{ page: string; category: string; requests: number; visitors: number }>(
      `SELECT page, category, sum(requests)::int AS requests, sum(visitors)::int AS visitors
         FROM auth.traffic_daily WHERE coalesce(project_id, 0) = $1 AND day >= $2
        GROUP BY page, category ORDER BY requests DESC`, [projectId, from]),
    pool.query<{ agent: string; requests: number }>(
      `SELECT agent, sum(requests)::int AS requests FROM auth.traffic_daily
        WHERE coalesce(project_id, 0) = $1 AND day >= $2 GROUP BY agent ORDER BY requests DESC`, [projectId, from]),
  ]);
  const visits = new Map(visitsRows.rows.map((row) => [row.day, row.n]));
  const unique = new Map(uniqueRows.rows.map((row) => [row.day, row.n]));
  return {
    ...stats,
    days: span,
    daily: trafficRows.rows.map((row) => ({
      day: row.day, visits: visits.get(row.day) ?? 0, requests: row.requests,
      visitors: row.visitors, uniqueVisitors: unique.get(row.day) ?? 0,
    })),
    pages: pageRows.rows,
    agents: agentRows.rows,
    trafficRequests: trafficRows.rows.reduce((sum, row) => sum + row.requests, 0),
  };
}
