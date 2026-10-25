import { describe, expect, it } from "vitest";
import { jsonb } from "../../src/db/json.js";

describe("JSON para parámetros jsonb", () => {
  it("repara medio emoji y NUL sin tocar el texto bien formado", () => {
    const cut = "Bandera 🇪🇸".slice(0, -1);
    expect(JSON.parse(jsonb({ quote: cut, nested: ["a\u0000b", "ñandú 🎸"] }))).toEqual({ quote: "Bandera 🇪�", nested: ["ab", "ñandú 🎸"] });
    expect(jsonb({ a: "Desorden Público" })).toBe(JSON.stringify({ a: "Desorden Público" }));
    expect(jsonb(cut)).not.toMatch(/\\ud[89ab]/iu);
  });
});
