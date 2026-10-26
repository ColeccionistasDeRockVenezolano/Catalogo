import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkGold, goldSchema, labelOptions } from "../../src/search/query-labeling.js";

const root = path.resolve(import.meta.dirname, "../..");
const lexicon = JSON.parse(readFileSync(path.join(root, "docs/unified-search/stage3/query-lexicon.json"), "utf8"));
const options = labelOptions(lexicon);
const datasets = path.join(root, "docs/unified-search/stage3/datasets");

describe("etiquetado humano de consultas reales", () => {
  // La prueba 1.0.0 (query-test-reserved.json) usaba la convención anterior de «válida con pendiente».
  it("acepta las etiquetas de las pruebas reservadas 2.0.0 a 6.0.0 (mismas convenciones)", () => {
    const failures: string[] = [];
    for (const file of readdirSync(datasets).filter(f => /^query-test-reserved-\d+\.json$/u.test(f))) {
      for (const c of JSON.parse(readFileSync(path.join(datasets, file), "utf8")).cases) {
        const problems = checkGold(goldSchema.parse(c.gold), options);
        if (problems.length) failures.push(`${file} ${c.id} «${c.text}»: ${problems.join("; ")}`);
      }
    }
    expect(failures).toEqual([]);
  });
  it("rechaza etiquetas incoherentes", () => {
    const base = goldSchema.parse({ status: "query_valid", req: ["activity:sleep"] });
    expect(checkGold(base, options)).toEqual([]);
    expect(checkGold({ ...base, status: "partial" }, options)).toContain("Una consulta parcial tiene condiciones y algo pendiente");
    expect(checkGold({ ...base, req: ["genre:no-existe"] }, options)[0]).toMatch(/desconocida/u);
    expect(checkGold({ ...base, req: ["similarity:overall"] }, options)).toContain("Un parecido anota la referencia");
    expect(checkGold({ ...base, alts: ["emotion:sad"] }, options)).toContain("Las lecturas posibles solo van en consultas ambiguas");
  });
});
