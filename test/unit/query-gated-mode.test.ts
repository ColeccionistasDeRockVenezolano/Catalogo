import { describe, expect, it } from "vitest";
import { abstain, agreementKey, gate } from "../../src/search/query-interpretation/gated.js";
import type { Canonical } from "../../src/search/query-interpretation/compiler.js";

const plan = (o: Partial<Canonical> = {}): Canonical => ({ status: "query_valid", req: ["genre:punk"], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 0, alts: [], facets: [], ...o });

describe("modo «solo si coinciden»", () => {
  it("responde con el plan del estudiante cuando la 1.8.0 produce el mismo", () => {
    const s = plan({ req: ["genre:punk", "decade:1980s"] });
    const l = plan({ req: ["decade:1980s", "genre:punk"] });
    const r = gate(s, l);
    expect(r).toMatchObject({ answered: true, reason: "agreement" });
    expect(r.plan).toBe(s);
  });

  it("ignora la clase de entidad y las mayúsculas del literal, pero no el papel", () => {
    const ent = (kind: string | null, literal: string, role: "target" | "reference" = "target") => ({ kind, literal, role });
    expect(agreementKey(plan({ ent: [ent("artist", "Zapato 3")] }))).toBe(agreementKey(plan({ ent: [ent(null, " zapato 3 ")] })));
    expect(agreementKey(plan({ ent: [ent("artist", "zapato 3")] }))).not.toBe(agreementKey(plan({ ent: [ent("artist", "zapato 3", "reference")] })));
  });

  it("el pendiente cuenta como «hay o no hay», no su cantidad", () => {
    expect(agreementKey(plan({ pending: 1 }))).toBe(agreementKey(plan({ pending: 3 })));
    expect(agreementKey(plan({ pending: 0 }))).not.toBe(agreementKey(plan({ pending: 1 })));
  });

  it("sin acuerdo no ejecuta nada: unsupported con al menos un pendiente", () => {
    const r = gate(plan({ req: ["genre:punk"] }), plan({ req: ["genre:ska"], pending: 2 }));
    expect(r).toMatchObject({ answered: false, reason: "disagreement" });
    expect(r.plan).toMatchObject({ status: "unsupported", req: [], exc: [], pref: [], any: [], alts: [], ent: [], pending: 2 });
  });

  it("el pendiente de una abstención nunca es cero", () => {
    expect(abstain(plan({ pending: 0 }), plan({ pending: 0 })).pending).toBe(1);
  });

  it("sin la 1.8.0 o sin estudiante se abstiene", () => {
    expect(gate(plan(), null)).toMatchObject({ answered: false, reason: "no_legacy" });
    const r = gate(null, plan());
    expect(r).toMatchObject({ answered: false, reason: "no_student" });
    expect(r.plan.status).toBe("unsupported");
    expect(gate(null, null).plan.pending).toBeGreaterThanOrEqual(1);
  });

  it("los grupos O se comparan sin importar el orden", () => {
    expect(agreementKey(plan({ any: [["genre:ska", "genre:punk"], ["decade:1980s"]] }))).toBe(agreementKey(plan({ any: [["decade:1980s"], ["genre:punk", "genre:ska"]] })));
  });
});

describe("evaluación 1.10.0 y activación", async () => {
  const { readFileSync } = await import("node:fs");
  const { evaluationSchema, normalizeEvaluation, activationRequestSchema } = await import("../../src/search/laya-models.js");
  const raw = JSON.parse(readFileSync("docs/unified-search/stage3/results/query_interpretation--crv-query-student-s5--1.10.0.json", "utf8"));

  it("el archivo inmutable se lee como la evaluación del modo de coincidencia", () => {
    const parsed = evaluationSchema.parse(normalizeEvaluation(raw));
    expect(parsed).toMatchObject({ modelId: "crv-query-gated-1.10.0", passed: true, criteriaVersion: "crv-stage3-criteria-1.10.0" });
    expect(parsed.checks.every(c => c.pass)).toBe(true);
    expect(parsed.card).toMatchObject({ mode: "gatedAgreement", alone: { "completo (estudiante solo)": false } });
    expect(activationRequestSchema.safeParse({ task: "query_interpretation", modelId: parsed.modelId, action: "activate", reason: "prueba" }).success).toBe(true);
  });

  it("el estudiante solo no queda como evaluación activable", () => {
    const alone = { ...raw, modes: { "completo (estudiante solo)": raw.modes["completo (estudiante solo)"] } };
    expect(evaluationSchema.safeParse(normalizeEvaluation(alone)).success).toBe(false);
  });
});
