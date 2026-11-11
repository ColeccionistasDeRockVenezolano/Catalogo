import { performance } from "node:perf_hooks";
import { loadQueryLexicon, type QueryLexicon } from "./lexicon.js";
import { catalogKey, segmentQuery, type CatalogResolver } from "./segmenter.js";
import { loadCatalogSnapshot } from "./catalog.js";
import { buildQuestions } from "./questions.js";
import { compileInterpretation, type Answers, type Canonical, type Thresholds } from "./compiler.js";
import { DEFAULT_EXTERNAL, ExternalNameCache, decideExternal, decideTrack, decideWeakArtist, externalCandidates, nameRuns, type ExternalHit } from "./external-names.js";
import { GATED_MODE_VERSION, gate, type GatedOutcome } from "./gated.js";
import type { SearchIntention } from "../contracts.js";

/**
 * Interpretación completa en el servicio con el modo «solo si coinciden» (criteria 1.10.0).
 * Mismo recorrido que se midió: segmentador → preguntas de Laya por tramo (servidor local de interpretación) → nombres
 * externos (Deezer) → compilador = plan de la 1.8.0; el estudiante da su plan en paralelo; solo si coinciden se responde.
 * Nunca lanza: cualquier fallo devuelve null y la búsqueda sigue como antes, sin interpretar.
 * Solo predice: no escribe en la base y no guarda el texto de la consulta (la caché de nombres externos vive en memoria).
 */
export const GATED_THRESHOLDS: Thresholds = { residual: 0.6, fillerAfterCue: 0.8, convention: 1 };
const DEFAULT_URL = "http://127.0.0.1:3191";
const MAX_CACHE = 2000;

export interface GatedResult { version: typeof GATED_MODE_VERSION; outcome: GatedOutcome; legacy: Canonical; legacyIntention: SearchIntention; student: Canonical; studentConfidence: number | null; ms: number }

export interface GatedConfig { url: string; catalogPath: string; timeoutMs: number; external: boolean }
export function gatedConfig(env: NodeJS.ProcessEnv = process.env): GatedConfig | null {
  const catalogPath = env["CRV_QUERY_CATALOG"] ?? (env["HOME"] ? `${env["HOME"]}/.cache/crv-stage3/catalog-names-2026-10-25.json` : "");
  if (env["CRV_QUERY_GATED"] !== "1" || !catalogPath) return null;
  return { url: env["CRV_QUERY_INTERPRETER_URL"] ?? DEFAULT_URL, catalogPath, timeoutMs: Number(env["CRV_QUERY_INTERPRET_TIMEOUT_MS"] ?? 900), external: env["CRV_QUERY_EXTERNAL_NAMES"] !== "0" };
}

async function post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Reloj duro además de la señal: un servidor que deja de responder no puede colgar la búsqueda.
    const res = await Promise.race([
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs + 50)),
    ]);
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json() as T;
  } finally { clearTimeout(timer); }
}

let loaded: { lexicon: QueryLexicon; catalog: CatalogResolver; path: string } | null = null;
let cache = new ExternalNameCache("/nonexistent/crv-external-memory-only.json", DEFAULT_EXTERNAL.externalBudgetMs);

function resources(cfg: GatedConfig) {
  if (!loaded || loaded.path !== cfg.catalogPath) loaded = { lexicon: loadQueryLexicon(), catalog: loadCatalogSnapshot(cfg.catalogPath), path: cfg.catalogPath };
  return loaded;
}

async function externalFor(seg: ReturnType<typeof segmentQuery>): Promise<Map<string, ExternalHit>> {
  const external = new Map<string, ExternalHit>();
  const th = DEFAULT_EXTERNAL;
  const runs = GATED_THRESHOLDS.convention ? nameRuns(seg) : [];
  const literals = [...new Set([...externalCandidates(seg), ...runs.map(r => r.literal)])];
  const asks = [...literals.map(l => [l, "artist"] as const), ...runs.filter(r => !r.cued && r.words >= 2).map(r => [r.literal, "track"] as const)];
  if (!asks.length) return external;
  if (cache.size > MAX_CACHE) cache = new ExternalNameCache("/nonexistent/crv-external-memory-only.json", th.externalBudgetMs);
  const got = await Promise.all(asks.map(([l, k]) => cache.resolve(l, true, k)));
  asks.forEach(([l, k], i) => {
    const key = catalogKey(l);
    const had = external.get(key);
    if (had?.kind === "artist" && !had.weak) return;
    const hit = k === "artist" ? decideExternal(l, got[i]?.raw, th) ?? (had ? null : decideWeakArtist(l, got[i]?.raw, th)) : decideTrack(l, got[i]?.raw, th);
    if (hit && !(had && hit.weak)) external.set(key, hit);
  });
  return external;
}

/** La GPU atiende de una en una: con más de MAX_INFLIGHT interpretaciones en curso, las nuevas se omiten (la búsqueda no espera). */
const MAX_INFLIGHT = 2;
let inflight = 0;

export async function interpretGated(q: string, cfg: GatedConfig | null = gatedConfig()): Promise<GatedResult | null> {
  if (!cfg) return null;
  const text = q.trim();
  if (!text || text.length > 300 || inflight >= MAX_INFLIGHT) return null;
  inflight++;
  try { return await run(text, cfg); } finally { inflight--; }
}

async function run(text: string, cfg: GatedConfig): Promise<GatedResult | null> {
  const t0 = performance.now();
  try {
    const { lexicon, catalog } = resources(cfg);
    const seg = segmentQuery(text, lexicon, catalog);
    const tasks = buildQuestions(seg, lexicon);
    const studentReq = post<{ canonical: Canonical; confidence: number }>(`${cfg.url}/student`, { text }, cfg.timeoutMs);
    const legacyReq = (async () => {
      const [laya, external] = await Promise.all([
        tasks.length ? post<{ answers: { key: string; choice: string; probabilities: Record<string, number> }[] }>(`${cfg.url}/laya`,
          { tasks: tasks.map(t => ({ qid: "q", key: t.key, family: t.family, state: t.state, question: t.question })) }, cfg.timeoutMs) : Promise.resolve({ answers: [] }),
        cfg.external ? externalFor(seg).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const answers: Answers = Object.fromEntries(laya.answers.map(a => [a.key, { choice: a.choice, probabilities: a.probabilities }]));
      if (tasks.some(t => !answers[t.key])) throw new Error("faltan_respuestas");
      const c = compileInterpretation(seg, answers, lexicon, GATED_THRESHOLDS, external);
      return { canonical: c.canonical, intention: c.intention };
    })();
    const [student, legacy] = await Promise.all([studentReq, legacyReq]);
    return { version: GATED_MODE_VERSION, outcome: gate(student.canonical, legacy.canonical), legacy: legacy.canonical, legacyIntention: legacy.intention, student: student.canonical, studentConfidence: student.confidence, ms: performance.now() - t0 };
  } catch {
    return null;
  }
}

/** Solo para pruebas: reinicia los recursos cargados. */
export function resetGatedForTests() { loaded = null; }
