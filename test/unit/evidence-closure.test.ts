import { expect, it } from "vitest";
import { biographyMembershipContext, cleanBiographyPersonName, closureSchema, evidenceHash, shouldReopenEvidenceCase, sourceReviewFingerprint } from "../../src/review/evidence-closure.js";

const base = {
  reviewId: 1, expectedPayloadHash: "a".repeat(64), sourceFingerprint: "b".repeat(64),
  reason: "La búsqueda documentada conserva la discrepancia sin una fuente que la resuelva.",
  evidence: [{ url: "https://example.org/source", kind: "secondary", quote: "Pedro (guitarra)", consultedAt: "2026-10-29" }],
};
it("no convierte una única búsqueda o una caída de red en un descarte", () => {
  expect(closureSchema.safeParse({ ...base, verdict: "unverifiable", research: [{ query: "Pedro banda", status: 200, receipt: "one.json" }, { query: "Pedro banda primaria", status: 503, receipt: "two.json" }] }).success).toBe(false);
  const parsed = closureSchema.parse({ ...base, verdict: "unverifiable", research: [{ query: "Pedro banda", status: 200, receipt: "one.json" }, { query: "Pedro banda primaria", status: 200, receipt: "two.json" }] });
  expect(parsed.verdict).toBe("unverifiable");
});
it("conserva la diferencia entre invitados, integrantes y etapas históricas", () => {
  const paragraph = "La formación incluye a Víctor y Gerardo, con la participación especial de Manuel Barrios (saxo), Javier Torres (flauta) y Juan Manuel Moreno (batería).";
  expect(biographyMembershipContext("Juan Manuel Moreno", [paragraph])).toBe("guest");
  expect(biographyMembershipContext("Manuel Barrios", [paragraph, "Sus integrantes iniciales son Manuel Barrios (saxo) y José Pérez."])).toBe("member");
  expect(biographyMembershipContext("Javier Torres", ["Javier Torres (flauta) grabó allí."])).toBe("unspecified");
});
it("exige la fila existente y evidencia primaria para una identidad nueva", () => {
  expect(closureSchema.safeParse({ ...base, verdict: "already_resolved" }).success).toBe(false);
  expect(closureSchema.safeParse({ ...base, verdict: "confirmed", identityClaim: true }).success).toBe(false);
});
it("conserva el cierre ante cambios cosméticos y lo reabre al cambiar la evidencia", () => {
  const payload = { url: "https://example.org/band", name: "Pedro" };
  const source = { bio: ["Pedro (guitarra) integra la banda."], bio_roles: { Pedro: ["guitarra"] }, footer: "2026" };
  const initial = sourceReviewFingerprint(payload, source);
  const cosmeticChange = { ...source, footer: "2027" };
  expect(sourceReviewFingerprint(payload, cosmeticChange)).toBe(initial);
  expect(shouldReopenEvidenceCase({ ...payload, rhvClosure: { sourceFingerprint: initial, verdict: "unverifiable" } }, initial)).toBe(false);
  expect(shouldReopenEvidenceCase({ ...payload, rhvClosure: { sourceFingerprint: initial } }, sourceReviewFingerprint(payload, { ...source, bio: ["Pedro fue invitado; Juan es el guitarrista."] }))).toBe(true);
  expect(evidenceHash({ b: 1, a: [2] })).toBe(evidenceHash({ a: [2], b: 1 }));
});
it("no toma una frase introductoria por nombre ni la corrección del extractor por nueva evidencia", () => {
  expect(cleanBiographyPersonName("Sus integrantes iniciales son Viraha Shanti")).toBe("Viraha Shanti");
  expect(cleanBiographyPersonName("Nelson Segovia")).toBe("Nelson Segovia");
  expect(cleanBiographyPersonName("Se incorporan a la banda Gorepriest")).toBe("Gorepriest");
  const source = { bio: ["Sus integrantes son Pedro Pérez (guitarra)."], bio_roles: { "Sus integrantes son Pedro Pérez": ["guitarra"] } };
  expect(sourceReviewFingerprint({ url: "https://example.org", name: "Sus integrantes son Pedro Pérez" }, source))
    .toBe(sourceReviewFingerprint({ url: "https://example.org", name: "Pedro Pérez" }, source));
});
