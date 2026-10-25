import { describe, expect, it } from "vitest";
import { buildSimilarityRelations, explainSimilarity, similarityCandidates, type AqusticoIdentity } from "../../src/search/similarity-relations.js";

const sha = "a".repeat(64);
const ids = new Map<number, AqusticoIdentity>([[1, { crvArtistId: 101, identity: "aqustico_cross_proven" }], [2, { crvArtistId: 102, identity: "aqustico_profile_created" }]]);
const captures = [
  { originId: 1, originName: "Uno", path: "similar/1.json", sha256: sha, similar: [{ id: 2, name: "Dos" }, { id: 9, name: "Externo" }, { id: 1, name: "Uno" }] },
  { originId: 2, originName: "Dos", path: "similar/2.json", sha256: sha, similar: [{ id: 1, name: "Uno" }] },
  { originId: 7, originName: "Sin prueba", path: "similar/7.json", sha256: sha, similar: [{ id: 1, name: "Uno" }] },
];

describe("relaciones de parecido R28", () => {
  const { relations, coverage } = buildSimilarityRelations(captures, ids);
  it("solo parte de orígenes con identidad probada y no inventa fichas", () => {
    expect(coverage).toMatchObject({ sourceFiles: 3, sourcePairs: 5, originsWithProvenIdentity: 2, relations: 3, bothResolved: 2, externalTargets: 1, mutual: 2, skippedUnprovenOrigin: 1 });
    const external = relations.find(r => r.to.sourceId === 9)!;
    expect(external.to).toMatchObject({ crvArtistId: null, identity: "external_reference" });
    expect(relations.every(r => r.aspect === "unknown" && r.from.crvArtistId !== null)).toBe(true);
    expect(relations.some(r => r.to.sourceId === r.from.sourceId)).toBe(false);
  });
  it("explica la relación sin atribuirle aspecto", () => {
    const text = explainSimilarity(relations.find(r => r.to.sourceId === 2)!);
    expect(text).toContain("posición 1");
    expect(text).toContain("ambas direcciones");
    expect(text).toContain("no dice en qué se parecen");
  });
  it("«parecido a X» respalda candidatos solo sin aspecto", () => {
    const plain = similarityCandidates(relations, { referenceArtistId: 101, aspect: null });
    expect(plain.status).toBe("supported");
    expect(plain.candidates.map(c => c.artist.sourceId).sort()).toEqual([2, 9]);
    expect(similarityCandidates(relations, { referenceArtistId: 101, aspect: "guitar" })).toMatchObject({ status: "unsupported_aspect", candidates: [] });
    expect(similarityCandidates(relations, { referenceArtistId: 555, aspect: null }).status).toBe("no_relation");
  });
});
