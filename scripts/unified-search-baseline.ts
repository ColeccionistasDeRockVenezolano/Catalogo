import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { buildApp } from "../src/api/app.js";
import { closeDb } from "../src/db/client.js";
import { OBSERVABILITY_VERSION } from "../src/search/contracts.js";
const app = await buildApp();
const samples: Record<string, Array<{ ms: number; status: number; count: number }>> = {};
const rssBefore = process.memoryUsage().rss;
async function measure(group: string, query: string) {
  const started = performance.now();
  const response = await app.inject({ url: `/search?q=${encodeURIComponent(query)}`, headers: { "user-agent": "crv-stage1-baseline", "x-crv-test": "1" } });
  const body = response.json();
  (samples[group] ??= []).push({ ms: performance.now() - started, status: response.statusCode,
    count: ["artist", "person", "album", "track", "organization"].reduce((n, key) => n + (body[key]?.length ?? 0), 0) });
}
try {
  await measure("first_request", "Desorden");
  const queries = ["Desorden", "Sentimiento Muerto", "José", "triste", "sin gritos para estudiar", "30 Seconds to Mars", "zzzz-no-existe", "a"];
  for (let round = 0; round < 10; round++) for (const query of queries) await measure("sequential_warm", query);
  for (let round = 0; round < 10; round++) await Promise.all(queries.map(query => measure("concurrency_8", query)));
  await measure("natural_query_1000", "sin gritos ".repeat(100).slice(0, 1000));
  const stats = Object.fromEntries(Object.entries(samples).map(([key, rows]) => {
    const sorted = rows.map(r => r.ms).sort((a,b) => a-b);
    const percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    return [key, { n: rows.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), errors: rows.filter(r => r.status >= 400).length,
      empty: rows.filter(r => r.status === 200 && r.count === 0).length }];
  }));
  const report = { version: OBSERVABILITY_VERSION, measuredAt: new Date().toISOString(),
    method: "Fastify inject, current source, live local catalog read-only; no network/render/debounce; excluded from analytics",
    load: "80 sequential warm requests and 80 requests in 10 batches of concurrency 8; cached queries; not a production capacity claim",
    coverage: "legacy matching and emotional lexicon; full semantic interpretation and musical evaluation not activated",
    budgets: { directWarmServerP95Ms: 150, semanticWarmServerP95Ms: 500, semanticMeasured: false },
    memory: { before: rssBefore, after: process.memoryUsage().rss }, stats };
  await writeFile(new URL("../reports/unified-search-stage1/baseline.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await app.close(); await closeDb(); }
