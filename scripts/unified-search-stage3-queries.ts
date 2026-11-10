/**
 * Etapa 3 · interpretación de consultas.
 *   tasks <dataset.json> <tasks.jsonl>                 preguntas para Laya (una por fragmento)
 *   eval  <dataset.json> <answers.jsonl|rules|legacy> [--thresholds t.json] [--out r.json]
 *         [--external cache.json [--external-live]]   1.7.0: nombres fuera del catálogo (Deezer); con
 *         --external-live consulta lo que falte en la caché y mide el tiempo de cada consulta.
 * Solo lee la instantánea del catálogo y el léxico; no escribe en la base.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { loadQueryLexicon } from "../src/search/query-interpretation/lexicon.js";
import { segmentQuery } from "../src/search/query-interpretation/segmenter.js";
import { loadCatalogSnapshot } from "../src/search/query-interpretation/catalog.js";
import { buildQuestions } from "../src/search/query-interpretation/questions.js";
import { compileInterpretation, type Answers, type Canonical } from "../src/search/query-interpretation/compiler.js";
import { aggregate, noInvention, type QueryCase } from "../src/search/query-interpretation/evaluation.js";
import { hybridAnswers, legacyCanonical, rulesAnswers } from "../src/search/query-interpretation/baselines.js";
import { DEFAULT_EXTERNAL, EXTERNAL_VERSION, ExternalNameCache, loadDictionary, lookupDeezer, decideExternal, decideTrack, decideWeakArtist, externalCandidates, nameRuns, type ExternalHit } from "../src/search/query-interpretation/external-names.js";
import { catalogKey } from "../src/search/query-interpretation/segmenter.js";

const CATALOG = process.env["CRV_STAGE3_CATALOG"] ?? `${process.env["HOME"]}/.cache/crv-stage3/catalog-names-2026-10-25.json`;
const [cmd, datasetPath, arg, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const lexicon = loadQueryLexicon();
const catalog = loadCatalogSnapshot(CATALOG);
const dataset = JSON.parse(readFileSync(datasetPath!, "utf8")) as { version: string; cases: (QueryCase & { allowed?: string[] })[] };

if (cmd === "tasks") {
  const lines: string[] = [];
  for (const c of dataset.cases) {
    const seg = segmentQuery(c.text, lexicon, catalog);
    for (const t of buildQuestions(seg, lexicon)) lines.push(JSON.stringify({ qid: c.id, key: t.key, family: t.family, state: t.state, question: t.question }));
  }
  writeFileSync(arg!, lines.join("\n") + "\n");
  console.log(JSON.stringify({ cases: dataset.cases.length, tasks: lines.length }));
} else if (cmd === "eval") {
  const thresholds = flag("--thresholds") ? JSON.parse(readFileSync(flag("--thresholds")!, "utf8")).thresholds : {};
  const byQ = new Map<string, Answers>();
  const hybrid = arg!.startsWith("hybrid:");
  const answersFile = hybrid ? arg!.slice(7) : arg!;
  if (arg !== "rules" && arg !== "legacy") {
    for (const line of readFileSync(answersFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as { qid: string; key: string; choice: string; probabilities: Record<string, number> };
      (byQ.get(r.qid) ?? byQ.set(r.qid, {}).get(r.qid)!)[r.key] = { choice: r.choice, probabilities: r.probabilities };
    }
  }
  const preds: Canonical[] = [], details: unknown[] = [], compileMs: number[] = [], externalMs: number[] = [], caseExtMs: number[] = [];
  const thrDoc = flag("--thresholds") ? JSON.parse(readFileSync(flag("--thresholds")!, "utf8")) : {};
  const extTh = { ...DEFAULT_EXTERNAL, ...(thrDoc.external ?? {}) };
  const cache = flag("--external") ? new ExternalNameCache(flag("--external")!, extTh.externalBudgetMs) : null;
  const live = rest.includes("--external-live");
  // «En caliente»: se abre la conexión con una consulta fija ajena a la prueba, que no entra en la caché.
  if (cache && live) await lookupDeezer("crv warmup", extTh.externalBudgetMs * 5);
  let externalHits = 0;
  for (const c of dataset.cases) {
    if (arg === "legacy") { preds.push(legacyCanonical(c.text, c.gold)); details.push(null); continue; }
    const t0 = performance.now();
    const seg = segmentQuery(c.text, lexicon, catalog);
    const tasks = buildQuestions(seg, lexicon);
    const answers = arg === "rules" ? rulesAnswers(seg, tasks) : hybrid ? hybridAnswers(seg, tasks, byQ.get(c.id) ?? {}) : byQ.get(c.id) ?? {};
    const missing = tasks.filter(t => !answers[t.key]).map(t => t.key);
    if (missing.length) throw new Error(`Faltan respuestas para ${c.id}: ${missing.join(",")}`);
    let external: Map<string, ExternalHit> | undefined;
    let tExt = 0, extMs = 0;
    if (cache) {
      const e0 = performance.now();
      external = new Map();
      // 0.3.0: los tramos de nombre se buscan como artista y como canción.
      const runs = thresholds.convention ? nameRuns(seg) : [];
      const literals = [...new Set([...externalCandidates(seg), ...runs.map(r => r.literal)])];
      const asks = [...literals.map(l => [l, "artist"] as const), ...runs.filter(r => !r.cued && r.words >= 2).map(r => [r.literal, "track"] as const)];
      const fetched = asks.filter(([l, k]) => !cache.get(l, k));
      // Las consultas de una misma búsqueda van en paralelo: su tiempo es el de la más lenta.
      const got = await Promise.all(asks.map(([l, k]) => cache.resolve(l, live, k)));
      const fresh = got.filter((g, i) => g && fetched.includes(asks[i]!)).map(g => g!.ms);
      if (live && fresh.length) externalMs.push(extMs = Math.max(...fresh));
      asks.forEach(([l, k], i) => {
        const key = catalogKey(l);
        const had = external!.get(key);
        if (had?.kind === "artist" && !had.weak) return;
        const hit = k === "artist" ? decideExternal(l, got[i]?.raw, extTh) ?? (had ? null : decideWeakArtist(l, got[i]?.raw, extTh)) : decideTrack(l, got[i]?.raw, extTh);
        if (hit && !(had && hit.weak)) { if (!had && !hit.weak) externalHits++; external!.set(key, hit); }
      });
      if (fetched.length) cache.save();
      // La espera de red se mide aparte (externalMs); no entra en el tiempo de compilación.
      tExt = performance.now() - e0;
    }
    const interp = compileInterpretation(seg, answers, lexicon, thresholds, external);
    compileMs.push(performance.now() - t0 - tExt);
    caseExtMs.push(extMs);
    preds.push(interp.canonical);
    details.push({ id: c.id, text: c.text, externalMs: extMs, canonical: interp.canonical, trace: interp.trace, intention: interp.intention });
  }
  const real = dataset.cases.every(c => c.allowed);
  const summary = real
    ? { n: dataset.cases.length, noInvention: dataset.cases.filter((c, i) => noInvention(c.allowed!, preds[i]!)).length / dataset.cases.length,
        invented: dataset.cases.flatMap((c, i) => noInvention(c.allowed!, preds[i]!) ? [] : [{ id: c.id, text: c.text, pred: preds[i] }]) }
    : aggregate(dataset.cases, preds);
  cache?.save();
  const sorted = [...compileMs].sort((a, b) => a - b);
  const extSorted = [...externalMs].sort((a, b) => a - b);
  const caseExtSorted = [...caseExtMs].sort((a, b) => a - b);
  const out = { dataset: dataset.version, answers: arg, lexicon: lexicon.doc.version, lexiconHash: lexicon.hash, catalogHash: catalog.hash, thresholds,
    compileMsP50: sorted[Math.floor(sorted.length * 0.5)] ?? null, compileMsP95: sorted[Math.floor(sorted.length * 0.95)] ?? null,
    external: cache ? { version: EXTERNAL_VERSION, thresholds: extTh, live, hits: externalHits, lookups: externalMs.length, failures: cache.failures, dictionary: loadDictionary()?.files ?? null,
      msP50: extSorted[Math.floor(extSorted.length * 0.5)] ?? null, msP95: extSorted[Math.floor(extSorted.length * 0.95)] ?? null,
      // Sobre todas las consultas (0 si no salió a la red): es lo que suma a la interpretación completa.
      caseMsP95: caseExtSorted[Math.floor(caseExtSorted.length * 0.95)] ?? null, caseMsMax: caseExtSorted.at(-1) ?? null } : null,
    summary, details };
  if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(out, null, 1));
  const { results: _r, ...brief } = summary as Record<string, unknown>;
  console.log(JSON.stringify(brief, null, 1).slice(0, 6000));
} else {
  console.error("uso: tasks|eval");
  process.exit(2);
}
