import { describe, expect, it } from "vitest";
import type { Canonical } from "../../src/search/query-interpretation/compiler.js";
import { parseStructuredPlan, planMode } from "../../src/search/query-plan/structured.js";
import { decide } from "../../src/search/query-plan/service.js";
import type { GatedResult } from "../../src/search/query-interpretation/gated-service.js";

const base: Canonical = { status: "query_valid", req: [], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 0, alts: [], facets: [] };
const plan = (c: Partial<Canonical>) => parseStructuredPlan({ ...base, ...c });

describe("plan estructurado · validación", () => {
  it("acepta género + década, exclusiones, preferencias y alternativas de género", () => {
    expect(plan({ req: ["genre:ska", "decade:1980s"], exc: ["genre:metal"], pref: ["genre:punk"], any: [["genre:rock", "genre:pop"]] }))
      .toEqual({ plan: { req: ["ska"], exc: ["metal"], pref: ["punk"], any: [["rock", "pop"]], decade: { from: 1980, to: 1989, label: "1980s" } } });
  });
  it("no ejecuta nada que no sea género o década", () => {
    expect(plan({ req: ["emotion:sad"] })).toEqual({ refusal: "unsupported_condition" });
    expect(plan({ req: ["genre:rock", "activity:study"] })).toEqual({ refusal: "unsupported_condition" });
    expect(plan({ req: ["genre:rock"], pref: ["energy:high"] })).toEqual({ refusal: "unsupported_condition" });
    expect(plan({ req: ["genre:rock"], any: [["genre:rock", "emotion:sad"]] })).toEqual({ refusal: "unsupported_condition" });
  });
  it("rechaza lo que no está resuelto del todo", () => {
    expect(plan({ status: "partial", req: ["genre:rock"] })).toEqual({ refusal: "not_query_valid" });
    expect(plan({ req: ["genre:rock"], pending: 1 })).toEqual({ refusal: "pending" });
    expect(plan({ req: ["genre:rock"], ent: [{ role: "target", kind: "artist", literal: "x" }] })).toEqual({ refusal: "entities" });
    expect(plan({ req: ["genre:rock"], ctx: 1 })).toEqual({ refusal: "context" });
    expect(plan({ req: ["genre:rock"], facets: ["x"] })).toEqual({ refusal: "facets" });
    expect(plan({ req: ["genre:rock"], alts: ["x"] })).toEqual({ refusal: "alternatives" });
    expect(plan({})).toEqual({ refusal: "empty" });
  });
  it("décadas: una sola, solo requisito, rango válido", () => {
    expect(plan({ req: ["decade:1980s", "decade:1990s"] })).toEqual({ refusal: "multiple_decades" });
    expect(plan({ req: ["genre:rock"], exc: ["decade:1980s"] })).toEqual({ refusal: "unsupported_condition" });
    expect(plan({ req: ["decade:1985s"] })).toEqual({ refusal: "invalid_decade" });
    expect(plan({ req: ["decade:1890s"] })).toEqual({ refusal: "invalid_decade" });
  });
  it("una etiqueta con inyección no pasa", () => {
    expect(plan({ req: ["genre:rock'; drop table x;--"] })).toEqual({ refusal: "unsupported_condition" });
  });
  it("el modo por defecto es off", () => {
    expect(planMode({})).toBe("off");
    expect(planMode({ CRV_QUERY_PLAN: "on" })).toBe("on");
    expect(planMode({ CRV_QUERY_PLAN: "shadow" })).toBe("shadow");
    expect(planMode({ CRV_QUERY_PLAN: "si" })).toBe("off");
  });
});

describe("plan estructurado · decisión", () => {
  const result = (answered: boolean, c: Partial<Canonical>): GatedResult => ({
    version: "crv-query-gated-1.10.0", outcome: { answered, plan: { ...base, ...c }, reason: answered ? "agreement" : "disagreement" },
    legacy: base, legacyIntention: {} as never, student: base, studentConfidence: 0.9, ms: 1,
  });
  it("sin acuerdo no se sirve el plan", () => {
    expect(decide(result(false, { req: ["genre:rock"] }))).toEqual({ servable: false, reason: "abstain:disagreement" });
    expect(decide(null)).toEqual({ servable: false, reason: "no_interpretation" });
  });
  it("con acuerdo y solo género/década se sirve", () => {
    expect(decide(result(true, { req: ["genre:rock"] })).servable).toBe(true);
    expect(decide(result(true, { req: ["emotion:sad"] }))).toEqual({ servable: false, reason: "refused:unsupported_condition" });
  });
});
