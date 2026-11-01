// Informe de tráfico para la ventana 3.7 del panel (C7).
//
// Portado de Herra 1.1.36 (`dist/services/metrics.service.js`) a PostgreSQL.
// Lee solo el agregado diario (traffic_daily): nada de lo que devuelve permite
// reconocer a una persona. Las cifras de visitantes son persona-día —la misma
// unidad del contador público—, porque la huella cambia cada medianoche y dos
// días no se pueden deduplicar entre sí sin guardar lo que no se quiere guardar.
import { getPool } from "../db/client.js";
import { countryName, localDay, normalizeCountry } from "../api/roadmap/visits.js";
import { agentInfo } from "./agents.js";
import { ALL_PAGES, TRAFFIC_PAGES } from "./record.js";
import { rangeListStatus } from "./verify.js";

export const METRICS_RANGES = [7, 30, 90] as const;
export type MetricsRange = typeof METRICS_RANGES[number];

export function parseMetricsRange(value: unknown): MetricsRange {
  const days = Number(value);
  return (METRICS_RANGES as readonly number[]).includes(days) ? days as MetricsRange : 30;
}

const CATEGORIES = ["human", "ai", "search", "bot", "suspicious"] as const;
type Category = typeof CATEGORIES[number];
const AUTOMATED: Category[] = ["ai", "search", "bot"];
const MAX_COUNTRIES = 8;

const AGENT_LABEL_KEYS: Record<string, string> = {
  "other-bot": "Otros bots",
  "no-user-agent": "Sin User-Agent",
  "signed-agent": "Agente con firma HTTP",
  "headless-browser": "Navegador sin interfaz",
  "google-fetcher": "Google (fetchers)",
};

interface Pair { requests: number; visitors: number }
type Pairs = Record<Category, Pair>;

function emptyPairs(): Pairs {
  return {
    human: { requests: 0, visitors: 0 }, ai: { requests: 0, visitors: 0 }, search: { requests: 0, visitors: 0 },
    bot: { requests: 0, visitors: 0 }, suspicious: { requests: 0, visitors: 0 },
  };
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

function shiftDay(day: string, offset: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
}

export interface MetricsReport {
  days: MetricsRange;
  from: string;
  to: string;
  since: string | null;
  totals: {
    confirmed: { current: number; previous: number };
    categories: { current: Pairs; previous: Pairs };
    jsAgents: number;
  };
  daily: Array<{ day: string; confirmed: number } & Pairs>;
  agents: Array<{
    key: string; label: string; operator: string; category: string; purpose: string;
    requests: number; visitors: number; jsVisitors: number;
    verification: { verified: number; unverified: number; spoofed: number; none: number };
    lastAt: string | null;
  }>;
  pages: Array<{ page: string; total: number; human: number; ai: number; search: number; bot: number; suspicious: number }>;
  countries: {
    people: Array<{ code: string; name: string; flag: string | null; count: number }>;
    automated: Array<{ code: string; name: string; flag: string | null; count: number }>;
  };
  verification: { network: boolean; lists: number; listsTotal: number; updatedAt: string | null };
  publicCounter: { total: number };
}

export async function trafficReport(projectId: number, days: MetricsRange, lang: "es" | "en" = "es"): Promise<MetricsReport> {
  const pool = getPool();
  const to = localDay();
  const from = shiftDay(to, -(days - 1));
  const prevTo = shiftDay(from, -1);
  const prevFrom = shiftDay(prevTo, -(days - 1));

  const sumByCategory = async (page: string, start: string, end: string): Promise<Pairs> => {
    const { rows } = await pool.query<{ category: string; requests: string; visitors: string }>(
      `SELECT category, COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(visitors),0) AS visitors
         FROM auth.traffic_daily
        WHERE project_id = $1 AND page = $2::text AND day BETWEEN $3 AND $4
        GROUP BY category`, [projectId, page, start, end]);
    const pairs = emptyPairs();
    for (const row of rows) {
      if (isCategory(row.category)) pairs[row.category] = { requests: Number(row.requests), visitors: Number(row.visitors) };
    }
    return pairs;
  };

  const currentJs = await sumByCategory("js", from, to);
  const previousJs = await sumByCategory("js", prevFrom, prevTo);

  // ---- Serie diaria -----------------------------------------------------------
  const { rows: dailyRows } = await pool.query<{ day: string; page: string; category: string; requests: string; visitors: string }>(
    `SELECT day, page, category, COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(visitors),0) AS visitors
       FROM auth.traffic_daily
      WHERE project_id = $1 AND page IN ($2::text, 'js') AND day BETWEEN $3 AND $4
      GROUP BY day, page, category`, [projectId, ALL_PAGES, from, to]);
  const dailyMap = new Map<string, { day: string; confirmed: number } & Pairs>();
  for (let offset = 0; offset < days; offset += 1) {
    const day = shiftDay(from, offset);
    dailyMap.set(day, { day, confirmed: 0, ...emptyPairs() });
  }
  for (const row of dailyRows) {
    const entry = dailyMap.get(row.day);
    if (!entry || !isCategory(row.category)) continue;
    if (row.page === "js") {
      if (row.category === "human") entry.confirmed += Number(row.visitors);
    } else {
      entry[row.category] = { requests: Number(row.requests), visitors: Number(row.visitors) };
    }
  }

  // ---- Agentes ----------------------------------------------------------------
  const { rows: agentRows } = await pool.query<{
    agent: string; category: string; verification: string; requests: string; visitors: string; last_at: string | null;
  }>(
    `SELECT agent, category, verification, COALESCE(SUM(requests),0) AS requests,
            COALESCE(SUM(visitors),0) AS visitors, MAX(last_at) AS last_at
       FROM auth.traffic_daily
      WHERE project_id = $1 AND page = $2::text AND category IN ('ai','search','bot') AND day BETWEEN $3 AND $4
      GROUP BY agent, category, verification`, [projectId, ALL_PAGES, from, to]);
  const { rows: jsAgentRows } = await pool.query<{ agent: string; visitors: string }>(
    `SELECT agent, COALESCE(SUM(visitors),0) AS visitors
       FROM auth.traffic_daily
      WHERE project_id = $1 AND page = 'js' AND category IN ('ai','search','bot') AND day BETWEEN $2 AND $3
      GROUP BY agent`, [projectId, from, to]);
  const jsByAgent = new Map(jsAgentRows.map((row) => [row.agent, Number(row.visitors)]));

  type AgentRow = MetricsReport["agents"][number];
  const agents = new Map<string, AgentRow>();
  const ensureAgent = (key: string, category: string): AgentRow => {
    const existing = agents.get(key);
    if (existing) return existing;
    const info = agentInfo(key);
    const created: AgentRow = {
      key,
      label: AGENT_LABEL_KEYS[key] ?? info?.label ?? key,
      operator: info?.operator ?? "—",
      category: info?.category ?? category,
      purpose: info?.purpose ?? "other",
      requests: 0,
      visitors: 0,
      jsVisitors: jsByAgent.get(key) ?? 0,
      verification: { verified: 0, unverified: 0, spoofed: 0, none: 0 },
      lastAt: null,
    };
    agents.set(key, created);
    return created;
  };
  for (const row of agentRows) {
    const agent = ensureAgent(row.agent, row.category);
    agent.requests += Number(row.requests);
    agent.visitors += Number(row.visitors);
    if (row.verification in agent.verification) agent.verification[row.verification as keyof AgentRow["verification"]] += Number(row.requests);
    if (row.last_at && (!agent.lastAt || row.last_at > agent.lastAt)) agent.lastAt = row.last_at;
  }
  // Un agente que solo se vio ejecutando JavaScript también debe aparecer.
  for (const row of jsAgentRows) ensureAgent(row.agent, agentInfo(row.agent)?.category ?? "bot");

  // ---- Pantallas ---------------------------------------------------------------
  const { rows: pageRows } = await pool.query<{ page: string; category: string; requests: string }>(
    `SELECT page, category, COALESCE(SUM(requests),0) AS requests
       FROM auth.traffic_daily
      WHERE project_id = $1 AND page NOT IN ($2::text, 'js') AND day BETWEEN $3 AND $4
      GROUP BY page, category`, [projectId, ALL_PAGES, from, to]);
  const pages = new Map<string, MetricsReport["pages"][number]>();
  for (const row of pageRows) {
    if (!(TRAFFIC_PAGES as readonly string[]).includes(row.page) || !isCategory(row.category)) continue;
    const entry = pages.get(row.page)
      ?? { page: row.page, total: 0, human: 0, ai: 0, search: 0, bot: 0, suspicious: 0 };
    entry[row.category] += Number(row.requests);
    entry.total += Number(row.requests);
    pages.set(row.page, entry);
  }

  // ---- Países ------------------------------------------------------------------
  const peopleCountries = await pool.query<{ country: string; count: string }>(
    `SELECT country, COALESCE(SUM(visitors),0) AS count
       FROM auth.traffic_daily
      WHERE project_id = $1 AND page = 'js' AND category = 'human' AND day BETWEEN $2 AND $3
      GROUP BY country HAVING COALESCE(SUM(visitors),0) > 0 ORDER BY count DESC, country ASC LIMIT $4::int`,
    [projectId, from, to, MAX_COUNTRIES]);
  const automatedCountries = await pool.query<{ country: string; count: string }>(
    `SELECT country, COALESCE(SUM(requests),0) AS count
       FROM auth.traffic_daily
      WHERE project_id = $1 AND page = $2 AND category IN ('ai','search','bot') AND day BETWEEN $3 AND $4
      GROUP BY country HAVING COALESCE(SUM(requests),0) > 0 ORDER BY count DESC, country ASC LIMIT $5::int`,
    [projectId, ALL_PAGES, from, to, MAX_COUNTRIES]);
  const { rows: sinceRows } = await pool.query<{ day: string | null }>(
    "SELECT MIN(day) AS day FROM auth.traffic_daily WHERE project_id = $1", [projectId]);

  const lists = rangeListStatus();
  const loaded = lists.filter((list) => list.prefixes > 0);
  const updatedAt = loaded.map((list) => list.fetchedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const { rows: counterRows } = await pool.query<{ total: string }>(
    "SELECT COALESCE(SUM(visits),0) AS total FROM auth.project_visit_stats WHERE project_id = $1", [projectId]);

  const toCountry = (rows: Array<{ country: string; count: string }>) => rows.map((row) => ({
    code: normalizeCountry(row.country),
    name: countryName(normalizeCountry(row.country), lang),
    flag: normalizeCountry(row.country) === "zz" ? null : normalizeCountry(row.country),
    count: Number(row.count),
  }));

  return {
    days,
    from,
    to,
    since: sinceRows[0]?.day ?? null,
    totals: {
      confirmed: { current: currentJs.human.visitors, previous: previousJs.human.visitors },
      categories: {
        current: await sumByCategory(ALL_PAGES, from, to),
        previous: await sumByCategory(ALL_PAGES, prevFrom, prevTo),
      },
      jsAgents: AUTOMATED.reduce((sum, category) => sum + currentJs[category].visitors, 0) + currentJs.suspicious.visitors,
    },
    daily: [...dailyMap.values()],
    agents: [...agents.values()].sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label)),
    pages: [...pages.values()].sort((a, b) => b.total - a.total),
    countries: { people: toCountry(peopleCountries.rows), automated: toCountry(automatedCountries.rows) },
    verification: { network: process.env["CRV_TRAFFIC_VERIFY_NETWORK"] === "1", lists: loaded.length, listsTotal: lists.length, updatedAt },
    publicCounter: { total: Number(counterRows[0]?.total ?? 0) },
  };
}
