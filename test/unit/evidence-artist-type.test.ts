import { describe, expect, it } from "vitest";
import { evidenceGaps } from "../../src/curation/ai/evidence.js";
import type { CatalogEvidence, CatalogOperation } from "../../src/curation/ai/types.js";

const evidence = (quote: string): CatalogEvidence => ({ id: "e1", url: "https://fuente.example/x", quote, fetchedAt: "2026-10-10T00:00:00Z", origin: "page", contentHash: "h", label: "fuente" } as CatalogEvidence);
const create = (values: Record<string, string | number>): CatalogOperation => ({
  key: "solo", label: "Crear artista", reason: "r", evidenceIds: ["e1"], enabled: true, op: "create_entity", kind: "artist", values,
} as CatalogOperation);

describe("respaldo documental del tipo de artista", () => {
  const quote = "Jeremías es un cantautor venezolano.";
  it("el tipo de artista no se exige en la cita: sin la palabra «solista» ni el literal solo_artist no bloquea", () => {
    expect(evidenceGaps(create({ name: "Jeremías", artistType: "solo_artist" }), [evidence(quote)])).toEqual([]);
    expect(evidenceGaps(create({ name: "Jeremías", artistType: "band" }), [evidence(quote)])).toEqual([]);
  });
  it("otros campos y el nombre siguen exigiéndose", () => {
    expect(evidenceGaps(create({ name: "Otro Nombre", artistType: "solo_artist" }), [evidence(quote)])).toEqual(["nombre"]);
    expect(evidenceGaps(create({ name: "Jeremías", originCity: "Maracaibo" }), [evidence(quote)])).toEqual(["ciudad de origen «Maracaibo»"]);
    expect(evidenceGaps(create({ name: "Jeremías", formedYear: 1999 }), [evidence(quote)])).toEqual(["año de formación «1999»"]);
  });
});
