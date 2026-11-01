// CRV · Evaluación del clasificador de duplicados contra el conjunto dorado.
//
// Uso:
//   tsx scripts/eval-duplicates.ts            # valida el corpus, sin gastar IA
//   tsx scripts/eval-duplicates.ts --live     # clasifica los pares vivos
//   tsx scripts/eval-duplicates.ts --live --limit=10
//
// Los pares `same_identity` son históricos: una de las dos fichas ya fue
// absorbida, así que solo se evalúan en vivo los pares cuyos dos artistas
// siguen existiendo (related/distinct y los que sigan abiertos).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDeepSeekGateway } from "../src/ai/gateway.js";
import { getPool } from "../src/db/client.js";
import { loadArtistFacts, scoreArtistPair, type ArtistCandidate, type ArtistFeature } from "../src/review/artist-candidates.js";
import { artistMergePolicy, buildDossier, classifyArtistPair, loadArtistProfiles } from "../src/review/artist-merge.js";

interface GoldenPair {
  a_id: number; a_name: string; b_id: number; b_name: string;
  expected: "same_identity" | "related" | "distinct" | "needs_human"; why: string;
}

const live = process.argv.includes("--live");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

const corpus = JSON.parse(readFileSync(resolve("test/fixtures/duplicates/golden-pairs.json"), "utf8")) as {
  version: number; pairs: GoldenPair[];
};
const pairs = corpus.pairs.slice(0, limit && Number.isFinite(limit) ? limit : undefined);
const facts = await loadArtistFacts(getPool());
const byId = new Map(facts.map((item) => [item.id, item]));

const missing = pairs.filter((pair) => !byId.has(pair.a_id) || !byId.has(pair.b_id));
const evaluable = pairs.filter((pair) => byId.has(pair.a_id) && byId.has(pair.b_id));
console.error(`corpus=${pairs.length} evaluables=${evaluable.length} históricos=${missing.length} live=${live}`);

if (!live) {
  console.log(JSON.stringify({
    corpus: pairs.length, evaluable: evaluable.length, historical: missing.length,
    byExpected: pairs.reduce<Record<string, number>>((acc, pair) => ({ ...acc, [pair.expected]: (acc[pair.expected] ?? 0) + 1 }), {}),
  }, null, 2));
  process.exit(0);
}

const gateway = createDeepSeekGateway();
const results: Array<{
  pair: string; expected: string; decision: string; confidence: number;
  merge: boolean; expectedMerge: boolean; evidence: number; model: string;
}> = [];

for (const pair of evaluable) {
  const left = byId.get(pair.a_id)!;
  const right = byId.get(pair.b_id)!;
  const scored = scoreArtistPair(left, right);
  const features: ArtistFeature[] = scored.features;
  const candidate: ArtistCandidate = {
    a: { id: left.id, name: left.name }, b: { id: right.id, name: right.name },
    score: scored.score, deterministic: scored.deterministic,
    signals: features.filter((feature) => feature.value > 0).length,
    features, priority: scored.deterministic ? 8 : 6,
  };
  const profiles = await loadArtistProfiles(getPool(), [left.id, right.id]);
  const a = profiles.get(left.id);
  const b = profiles.get(right.id);
  if (!a || !b) continue;
  const { verdict, model } = await classifyArtistPair(gateway, candidate, buildDossier(a, b, candidate));
  const policy = artistMergePolicy(candidate, verdict);
  results.push({
    pair: `${left.id}/${right.id}`, expected: pair.expected, decision: verdict.decision,
    confidence: verdict.confidence, merge: policy.merge,
    expectedMerge: pair.expected === "same_identity", evidence: verdict.evidence.length, model,
  });
}

const evaluated = results.length;
const tp = results.filter((row) => row.expectedMerge && row.merge).length;
const fn = results.filter((row) => row.expectedMerge && !row.merge).length;
const fp = results.filter((row) => !row.expectedMerge && row.merge).length;
const tn = results.filter((row) => !row.expectedMerge && !row.merge).length;
const precision = tp + fp ? tp / (tp + fp) : 1;
const recall = tp + fn ? tp / (tp + fn) : 1;
const byDecision = results.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.decision]: (acc[row.decision] ?? 0) + 1 }), {});

console.log(JSON.stringify({
  evaluated, skipped: pairs.length - evaluated,
  precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)),
  confusion: { tp, fp, fn, tn }, byDecision,
  results,
}, null, 2));
