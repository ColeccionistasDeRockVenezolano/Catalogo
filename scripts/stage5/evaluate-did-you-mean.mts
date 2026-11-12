/**
 * Etapa 5 · «¿Quisiste decir…?»: evaluación contra el catálogo real. Solo lee.
 *   evaluate-did-you-mean.mts <out.json> [--sheet hoja.md] [--labels labels.json] [--per-kind 400] [--c tmp-analysis/stage4/live-dev.json]
 * Conjunto A: erratas sintéticas de nombres reales (semilla fija). B: consultas reales sin resultados (search_misses).
 * C: consultas en lenguaje natural (no son erratas). Criterios congelados en docs/unified-search/stage5/fuzzy/CRITERIOS.md.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getPool } from "../../src/db/client.js";
import { normalizeEntityName } from "../../src/normalization/entity-name.js";
import { searchAllIds, searchIndexEntries, warmSearchIndex, type IndexedKind } from "../../src/api/search-index.js";
import { buildFuzzyIndex, DID_YOU_MEAN_VERSION, suggest, type FuzzyIndex, type FuzzyKind } from "../../src/search/did-you-mean.js";
import { clearDidYouMeanCache, didYouMean, FUZZY_KINDS } from "../../src/search/did-you-mean-service.js";

const [out, ...rest] = process.argv.slice(2);
const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const perKind = Number(flag("--per-kind") ?? 400);
const cPath = flag("--c") ?? "tmp-analysis/stage4/live-dev.json";
const keep = setInterval(() => {}, 1000);

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261112);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const norm = (s: string) => normalizeEntityName(s).secondaryKey;

function oneEdit(s: string): string {
  for (;;) {
    const i = Math.floor(rand() * s.length);
    const op = pick(["del", "ins", "sub", "swap"] as const);
    let r: string;
    if (op === "del") r = s.slice(0, i) + s.slice(i + 1);
    else if (op === "ins") r = s.slice(0, i) + pick([...LETTERS]) + s.slice(i);
    else if (op === "sub") { const c = pick([...LETTERS]); if (c === s[i]) continue; r = s.slice(0, i) + c + s.slice(i + 1); }
    else { if (i + 1 >= s.length || s[i] === s[i + 1]) continue; r = s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); }
    r = r.replace(/\s+/g, " ").trim();
    if (r && r !== s) return r;
  }
}
const STOP = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "un", "una", "the", "of", "and", "a", "en"]);
function dropStop(s: string): string | null {
  const toks = s.split(" "); const idx = toks.map((t, i) => (STOP.has(t) ? i : -1)).filter(i => i > 0 && i < toks.length - 1);
  if (!idx.length) return null;
  const r = toks.filter((_, i) => i !== pick(idx)).join(" ");
  return r.length >= 5 ? r : null;
}

await warmSearchIndex();
const kinds = FUZZY_KINDS as readonly FuzzyKind[];
const t0 = performance.now(), rss0 = process.memoryUsage().rss;
const entriesByKind = new Map<FuzzyKind, Awaited<ReturnType<typeof searchIndexEntries>>>();
for (const k of kinds) entriesByKind.set(k, await searchIndexEntries(k as IndexedKind));
const indexes: FuzzyIndex[] = kinds.map(k => buildFuzzyIndex(k, entriesByKind.get(k)!));
const buildMs = performance.now() - t0, rssMb = (process.memoryUsage().rss - rss0) / 1048576;
const totalKeys = indexes.reduce((n, i) => n + i.keys.length, 0);

async function emptyEverywhere(q: string): Promise<boolean> {
  for (const k of kinds) if ((await searchAllIds(k as IndexedKind, q, 1)).length) return false;
  return true;
}
const lat: number[] = [];
type Cat = "edit1" | "edit2" | "stop";
interface Tally { n: number; top1: number; top3: number; none: number; wrongTop: number }
const A: Record<string, Tally> = {};
const tally = (key: string): Tally => (A[key] ??= { n: 0, top1: 0, top3: 0, none: 0, wrongTop: 0 });
const misses: { cat: Cat; kind: FuzzyKind; target: string; query: string; got: string[] }[] = [];
let discardedNonEmpty = 0;

for (const kind of kinds) {
  const entries = entriesByKind.get(kind)!;
  const names = shuffle(entries.map(e => ({ id: e.id, name: e.name, key: norm(e.name) })).filter(e => e.key.length >= 6));
  for (const cat of ["edit1", "edit2", "stop"] as Cat[]) {
    let used = 0;
    for (const e of names) {
      if (used >= perKind) break;
      let q: string | null;
      if (cat === "edit1") q = oneEdit(e.key);
      else if (cat === "edit2") { if (e.key.length < 10) continue; q = oneEdit(oneEdit(e.key)); }
      else q = dropStop(e.key);
      if (!q || q === e.key || norm(q) === e.key) continue;
      if (!(await emptyEverywhere(q))) { discardedNonEmpty++; continue; }
      used++;
      const s0 = performance.now(); const found = suggest(norm(q), indexes); lat.push(performance.now() - s0);
      const t = tally(`${cat}:${kind}`), all = tally(`${cat}:*`);
      const isTarget = (x: { kind: FuzzyKind; id: number; name: string }) => (x.kind === kind && x.id === e.id) || norm(x.name) === e.key;
      for (const tt of [t, all]) {
        tt.n++;
        if (!found.length) tt.none++;
        else if (isTarget(found[0]!)) tt.top1++;
        else tt.wrongTop++;
        if (found.some(isTarget)) tt.top3++;
      }
      if (!found.some(isTarget) && misses.length < 120) misses.push({ cat, kind, target: e.name, query: q, got: found.map(x => `${x.kind}:${x.name}`) });
    }
  }
}
// Criterio 9: consultas de ≤ 4 letras nunca reciben sugerencia.
let shortWithSuggestion = 0;
for (let i = 0; i < 500; i++) { const len = 1 + Math.floor(rand() * 4); const q = Array.from({ length: len }, () => pick([...LETTERS])).join(""); if (suggest(q, indexes).length) shortWithSuggestion++; }

// B: consultas reales sin resultados. C: lenguaje natural.
interface Row { query: string; set: "B" | "C"; empty: boolean; ms: number; suggestions: { type: string; label: string; context: string | null }[] }
const rows: Row[] = [];
const misses90 = (await getPool().query<{ sample_query: string; misses: number }>("SELECT sample_query, misses FROM ingest.search_misses ORDER BY misses DESC")).rows;
const confirmed = (await getPool().query<{ sample: string }>("SELECT DISTINCT sample FROM ingest.search_operations WHERE sample IS NOT NULL AND snapshot->>'outcome'='empty'")).rows;
const bTexts = [...new Set([...misses90.map(r => r.sample_query), ...confirmed.map(r => r.sample)])];
const cTexts = existsSync(cPath) ? [...new Set((JSON.parse(readFileSync(cPath, "utf8")) as { rows: { text: string }[] }).rows.map(r => r.text))] : [];
for (const [set, texts] of [["B", bTexts], ["C", cTexts]] as const) {
  for (const q of texts) {
    clearDidYouMeanCache();
    const empty = await emptyEverywhere(q);
    if (!empty) { rows.push({ query: q, set, empty, ms: 0, suggestions: [] }); continue; }
    const r = await didYouMean(q);
    rows.push({ query: q, set, empty, ms: r.ms, suggestions: r.hits.map(h => ({ type: h.type, label: h.label, context: h.context })) });
  }
}
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? null;
const rate = (x: Tally | undefined, f: keyof Tally) => (x && x.n ? x[f] / x.n : null);
const emptyRows = (set: "B" | "C") => rows.filter(r => r.set === set && r.empty);
const withSug = (set: "B" | "C") => emptyRows(set).filter(r => r.suggestions.length);
const summary = {
  version: DID_YOU_MEAN_VERSION, evaluatedAt: new Date().toISOString(), perKind, seed: 20261112,
  index: { kinds, keys: totalKeys, buildMs: Math.round(buildMs), approxRssMb: Math.round(rssMb) },
  setA: Object.fromEntries(Object.entries(A).map(([k, v]) => [k, { ...v, top1Rate: rate(v, "top1"), top3Rate: rate(v, "top3") }])),
  discardedNonEmpty, latencyMs: { n: lat.length, p50: q(lat, 0.5), p95: q(lat, 0.95), p99: q(lat, 0.99) },
  shortQueriesWithSuggestion: shortWithSuggestion,
  setB: { total: rows.filter(r => r.set === "B").length, stillEmpty: emptyRows("B").length, withSuggestion: withSug("B").length },
  setC: { total: rows.filter(r => r.set === "C").length, empty: emptyRows("C").length, withSuggestion: withSug("C").length },
  serviceLatencyMs: { p50: q(rows.filter(r => r.empty).map(r => r.ms), 0.5), p95: q(rows.filter(r => r.empty).map(r => r.ms), 0.95) },
};
// Juicio manual (hoja de etiquetas) → criterios 5 y 6.
const labelsPath = flag("--labels");
if (labelsPath && existsSync(labelsPath)) {
  const labels = JSON.parse(readFileSync(labelsPath, "utf8")) as Record<string, "plausible" | "no">;
  const judged = (set: "B" | "C") => withSug(set).map(r => ({ r, label: labels[`${set}|${r.query}`] }));
  const all = [...judged("B"), ...judged("C")];
  const unlabeled = all.filter(x => !x.label).length;
  const plausible = all.filter(x => x.label === "plausible").length;
  const cNo = judged("C").filter(x => x.label === "no").length;
  Object.assign(summary, { judging: { shown: all.length, unlabeled, plausible, precision: all.length ? plausible / all.length : null,
    naturalLanguageEmpty: emptyRows("C").length, naturalLanguageWrongSuggestions: cNo, naturalLanguageWrongRate: emptyRows("C").length ? cNo / emptyRows("C").length : null } });
}
console.log(JSON.stringify(summary, null, 1));
writeFileSync(out!, JSON.stringify({ summary, rows, missesA: misses }, null, 1));
if (flag("--sheet")) {
  const L = (r: Row) => r.suggestions.map(s => `${s.label}${s.context ? ` (${s.context})` : ""} [${s.type}]`).join(" · ");
  const md = ["# Hoja de juicio · «¿Quisiste decir…?»", "", "Cada línea: consulta → sugerencias mostradas. Etiqueta en `labels.json` como `\"B|consulta\": \"plausible\"|\"no\"`.", "",
    `## B · consultas reales sin resultados (${withSug("B").length} con sugerencia de ${emptyRows("B").length})`, ...withSug("B").map(r => `- «${r.query}» → ${L(r)}`), "",
    `## C · lenguaje natural con 0 resultados (${withSug("C").length} con sugerencia de ${emptyRows("C").length})`, ...withSug("C").map(r => `- «${r.query}» → ${L(r)}`), ""];
  writeFileSync(flag("--sheet")!, md.join("\n"));
}
clearInterval(keep);
await getPool().end();
