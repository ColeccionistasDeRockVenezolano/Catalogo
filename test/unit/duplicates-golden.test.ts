import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface GoldenPair {
  a_id: number; a_name: string; b_id: number; b_name: string;
  expected: "same_identity" | "related" | "distinct" | "needs_human"; why: string;
}

const golden = JSON.parse(readFileSync(resolve("test/fixtures/duplicates/golden-pairs.json"), "utf8")) as {
  version: number; pairs: GoldenPair[];
};
const LABELS = new Set(["same_identity", "related", "distinct", "needs_human"]);

// Conjunto dorado del 2026-10-29: fusiones y descartes revisados. Es la base
// para medir precisión/recall del veredicto antes de promover la fusión
// automática (etapa 6). Los pares de `same_identity` son históricos: una ficha
// ya fue absorbida, así que la evaluación en vivo solo puede correr los pares
// cuyos dos artistas siguen existiendo.
describe("conjunto dorado de duplicados", () => {
  it("tiene al menos 30 pares con etiquetas válidas y sin repetidos", () => {
    expect(golden.version).toBe(1);
    expect(golden.pairs.length).toBeGreaterThanOrEqual(30);
    const seen = new Set<string>();
    for (const pair of golden.pairs) {
      expect(Number.isInteger(pair.a_id) && pair.a_id > 0).toBe(true);
      expect(Number.isInteger(pair.b_id) && pair.b_id > 0).toBe(true);
      expect(pair.a_id).not.toBe(pair.b_id);
      expect(pair.a_name.trim().length).toBeGreaterThan(1);
      expect(pair.b_name.trim().length).toBeGreaterThan(1);
      expect(LABELS.has(pair.expected)).toBe(true);
      expect(pair.why.trim().length).toBeGreaterThan(8);
      const key = `${Math.min(pair.a_id, pair.b_id)}:${Math.max(pair.a_id, pair.b_id)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("cubre fusiones y no fusiones, con los casos CRV ya decididos", () => {
    const counts = golden.pairs.reduce<Record<string, number>>((acc, pair) => {
      acc[pair.expected] = (acc[pair.expected] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts["same_identity"] ?? 0).toBeGreaterThanOrEqual(20);
    expect((counts["related"] ?? 0) + (counts["distinct"] ?? 0)).toBeGreaterThanOrEqual(8);
    expect(golden.pairs).toContainEqual(expect.objectContaining({ a_id: 3230, b_id: 8576, expected: "same_identity" }));
    expect(golden.pairs).toContainEqual(expect.objectContaining({ a_id: 1250, b_id: 4235, expected: "related" }));
  });
});
