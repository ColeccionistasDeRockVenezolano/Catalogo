/**
 * Etapa 4 · pasada en vivo de extremo a extremo (modelos locales + Deezer + plan + ejecución). Solo lee.
 *   CRV_QUERY_GATED=1 live-structured.mts <out.json> <dataset.json>...
 * Mide: cuántas consultas distintas llegan a un plan servible, tiempo total por consulta y comprobación de que cada plan
 * se ejecuta. La corrección de la elegibilidad se mide aparte con evaluate-structured.mts (oráculo).
 * Los conjuntos de desarrollo (entrenamiento y pruebas 1–3) sirven aquí para volumen y latencia, no para exactitud.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getPool } from "../../src/db/client.js";
import { gatedConfig, interpretShared } from "../../src/search/query-interpretation/gated-service.js";
import { decide } from "../../src/search/query-plan/service.js";
import { executeStructured } from "../../src/search/query-plan/structured.js";

const [out, ...datasets] = process.argv.slice(2);
const texts = [...new Set(datasets.flatMap(f => (JSON.parse(readFileSync(f, "utf8")) as { cases: { text: string }[] }).cases.map(c => c.text)))];
const cfg = gatedConfig();
if (!cfg) throw new Error("CRV_QUERY_GATED=1 es obligatorio");
const rows: { text: string; ms: number; answered: boolean; servable: boolean; reason: string; interpretation?: unknown; totals?: unknown; planMs?: number | undefined }[] = [];
const keep = setInterval(() => {}, 1000);
for (const text of texts) {
  const t0 = performance.now();
  const r = await interpretShared(text, cfg);
  const d = decide(r);
  let interpretation: unknown, totals: unknown, planMs: number | undefined;
  if (d.servable) {
    const res = await executeStructured(d.plan, 20);
    if (!("refusal" in res)) { interpretation = res.interpretation; totals = res.totals; planMs = res.ms; }
  }
  rows.push({ text, ms: performance.now() - t0, answered: !!r?.outcome.answered, servable: d.servable, reason: d.servable ? "ok" : d.reason, interpretation, totals, planMs });
}
clearInterval(keep);
const ms = rows.map(r => r.ms).sort((a, b) => a - b);
const reasons: Record<string, number> = {};
for (const r of rows) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
const summary = { queries: rows.length, answered: rows.filter(r => r.answered).length, servable: rows.filter(r => r.servable).length, reasons,
  msP50: ms[Math.floor(ms.length * 0.5)], msP95: ms[Math.floor(ms.length * 0.95)], failures: rows.filter(r => r.reason === "no_interpretation").length };
console.log(JSON.stringify(summary, null, 1));
writeFileSync(out!, JSON.stringify({ summary, rows }, null, 1));
await getPool().end();
