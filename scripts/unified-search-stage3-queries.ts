/**
 * Etapa 3 · interpretación de consultas.
 *   tasks <dataset.json> <tasks.jsonl>                 preguntas para Laya (una por fragmento)
 *   eval  <dataset.json> <answers.jsonl|rules|legacy> [--thresholds t.json] [--out r.json]
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
  const preds: Canonical[] = [], details: unknown[] = [], compileMs: number[] = [];
  for (const c of dataset.cases) {
    if (arg === "legacy") { preds.push(legacyCanonical(c.text, c.gold)); details.push(null); continue; }
    const t0 = performance.now();
    const seg = segmentQuery(c.text, lexicon, catalog);
    const tasks = buildQuestions(seg, lexicon);
    const answers = arg === "rules" ? rulesAnswers(seg, tasks) : hybrid ? hybridAnswers(seg, tasks, byQ.get(c.id) ?? {}) : byQ.get(c.id) ?? {};
    const missing = tasks.filter(t => !answers[t.key]).map(t => t.key);
    if (missing.length) throw new Error(`Faltan respuestas para ${c.id}: ${missing.join(",")}`);
    const interp = compileInterpretation(seg, answers, lexicon, thresholds);
    compileMs.push(performance.now() - t0);
    preds.push(interp.canonical);
    details.push({ id: c.id, text: c.text, canonical: interp.canonical, trace: interp.trace, intention: interp.intention });
  }
  const real = dataset.cases.every(c => c.allowed);
  const summary = real
    ? { n: dataset.cases.length, noInvention: dataset.cases.filter((c, i) => noInvention(c.allowed!, preds[i]!)).length / dataset.cases.length,
        invented: dataset.cases.flatMap((c, i) => noInvention(c.allowed!, preds[i]!) ? [] : [{ id: c.id, text: c.text, pred: preds[i] }]) }
    : aggregate(dataset.cases, preds);
  const sorted = [...compileMs].sort((a, b) => a - b);
  const out = { dataset: dataset.version, answers: arg, lexicon: lexicon.doc.version, lexiconHash: lexicon.hash, catalogHash: catalog.hash, thresholds,
    compileMsP50: sorted[Math.floor(sorted.length * 0.5)] ?? null, compileMsP95: sorted[Math.floor(sorted.length * 0.95)] ?? null, summary, details };
  if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(out, null, 1));
  const { results: _r, ...brief } = summary as Record<string, unknown>;
  console.log(JSON.stringify(brief, null, 1).slice(0, 6000));
} else {
  console.error("uso: tasks|eval");
  process.exit(2);
}
