import { describe, expect, it } from "vitest";
import { personIdentityAssessment } from "../../web/src/lib/personIdentityAssessment.js";
import { compareCatalog } from "../../src/review/person-comparison.js";
import type { PersonFacts } from "../../src/review/person-candidates.js";

const a: PersonFacts = { id: 1, name: "Francisco González", aliases: [], birthDate: null, deathDate: null, bandIds: [], albumIds: [], creditTypes: [] };
const b = { ...a, id: 2 };
describe("puntaje de identidad tras investigar", () => {
  it("el nombre idéntico aporta 20 puntos una sola vez y sin datos biográficos no añade esos puntos", () => {
    const comparison = compareCatalog(a, b);
    expect(personIdentityAssessment(.4, null, null, comparison)).toMatchObject({ score: .2, evidencePoints: 0, recommendation: "investigate" });
    expect(comparison.rows.find((r) => r.key === "life")?.points).toBe(0);
  });
  it("una cita antigua sin evaluación de ambos lados no obtiene un bono fijo", () => {
    expect(personIdentityAssessment(.4, { verdict: "same", evidence: [{ supports: "same" }] })).toMatchObject({ evidencePoints: 0, recommendation: "wait" });
  });
  it("una contradicción citada o una ficha mezclada desaconsejan fusionar", () => {
    expect(personIdentityAssessment(.9, { verdict: "different", evidence: [{ supports: "different" }] })).toMatchObject({ score: 0, recommendation: "do_not_merge" });
    expect(personIdentityAssessment(.9, { verdict: "mixed", evidence: [{ supports: "mixed" }] })).toMatchObject({ score: 0, recommendation: "review_split" });
    expect(personIdentityAssessment(.9, { verdict: "same", evidence: [{ supports: "same" }] }, "fechas de nacimiento distintas")).toMatchObject({ score: 0, recommendation: "wait" });
  });
  it("el solapamiento parcial del catálogo aporta menos que una coincidencia completa", () => {
    const partial = compareCatalog({ ...a, albumIds: [1,2] }, { ...b, albumIds: [1,3] });
    const complete = compareCatalog({ ...a, albumIds: [1,2] }, { ...b, albumIds: [1,2] });
    expect(partial.rows.find((r) => r.key === "albums")?.points).toBe(4);
    expect(complete.rows.find((r) => r.key === "albums")?.points).toBe(8);
  });
});
