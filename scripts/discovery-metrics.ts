import { aggregateMetrics } from "../src/discovery/aggregate.js";
import { trendPrototype } from "../src/discovery/trends.js";
import { closeDb } from "../src/db/client.js";
const mode = process.argv[2];
try {
  if (mode !== "aggregate" && mode !== "prototype") throw new Error("Uso: discovery-metrics.ts aggregate|prototype");
  console.log(JSON.stringify(mode === "aggregate" ? await aggregateMetrics() : await trendPrototype(), null, 2));
} finally { await closeDb(); }
