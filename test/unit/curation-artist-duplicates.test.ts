import { describe, expect, it } from "vitest";
import { analyzeCatalog } from "../../src/curation/analyze.js";
import { evidenceArtistDuplicates } from "../../src/curation/detectors/artist-duplicates.js";
import type { CatalogSnapshot } from "../../src/curation/types.js";
import type { Detector } from "../../src/curation/detectors/shared.js";
import type { ArtistFacts } from "../../src/review/artist-candidates.js";

function artistFacts(id: number, name: string, overrides: Partial<ArtistFacts> = {}): ArtistFacts {
  return {
    id, name, artistType: "band", aliases: [], originCity: null, originCountry: "Venezuela",
    formedYear: null, disbandedYear: null, albumKeys: new Set(), tracklistHashes: new Map(),
    members: [], evidenceUrls: [], officialLinks: [], externalIds: [], pictureUrl: null,
    ...overrides,
  };
}

function snapshotOf(artistFacts: ArtistFacts[], distinctPairs: string[] = []): CatalogSnapshot {
  return {
    takenAt: new Date("2026-10-29T12:00:00Z"),
    artists: artistFacts.map((facts) => ({
      id: facts.id, name: facts.name, originCity: facts.originCity,
      formedYear: facts.formedYear, disbandedYear: facts.disbandedYear,
    })),
    persons: [], organizations: [], albums: [], tracks: [], creditRoles: [],
    personArtists: new Map(), personLinks: new Map(), organizationLinks: new Map(), artistLinks: new Map(),
    reviews: [], conflicts: [], handledPairs: new Set(), distinctPairs: new Set(distinctPairs), artistFacts,
  };
}

const run = (snapshot: CatalogSnapshot) =>
  analyzeCatalog(snapshot, { detectors: [evidenceArtistDuplicates], anomalies: false }).findings;

describe("detector de artistas duplicados por evidencia", () => {
  const kamaraA = artistFacts(3230, "Kámara de Tortura", {
    originCity: "Maracay - Aragua", formedYear: 1978,
    albumKeys: new Set(["vampiro|2003"]), tracklistHashes: new Map([["hash-vampiro", "Vampiro (2003)"]]),
    members: [{ key: "gustavo guerrero", name: "Gustavo Guerrero", role: "Guitarra", instruments: ["guitar"] }],
    evidenceUrls: [{ url: "https://rockhechovenezuela.com/k/kamara-de-la-tortura-la/", artists: 2 }],
  });
  const kamaraB = artistFacts(8576, "La Kámara De la Tortura", {
    originCity: "Maracay",
    albumKeys: new Set(["vampiro|2003"]), tracklistHashes: new Map([["hash-vampiro", "Vampiro (2003)"]]),
    members: [{ key: "gustavo guerrero", name: "Gustavo Guerrero", role: "Guitarra", instruments: ["guitar"] }],
    evidenceUrls: [{ url: "https://rockhechovenezuela.com/k/kamara-de-la-tortura-la/", artists: 2 }],
  });

  it("emite un hallazgo determinista por par con la evidencia", () => {
    const findings = run(snapshotOf([kamaraA, kamaraB]));
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.detector).toBe("artistas_duplicados_evidencia");
    expect(finding.signature).toBe("evidencia_determinista");
    expect(finding.severity).toBe("high");
    expect(finding.pair).toEqual([3230, 8576]);
    expect(finding.entity).toMatchObject({ kind: "artist", id: 3230 });
    expect(finding.related).toEqual([{ kind: "artist", id: 8576, label: "La Kámara De la Tortura" }]);
    const evidence = finding.evidence as { signals: number; features: Array<{ key: string }> };
    expect(evidence.signals).toBeGreaterThanOrEqual(2);
    expect(evidence.features.map((feature) => feature.key)).toContain("shared_evidence_url");
    expect(evidence.features.map((feature) => feature.key)).toContain("tracklist_equal");
    expect(finding.title).toContain("misma página de evidencia");
  });

  it("no propone un par declarado distinto", () => {
    expect(run(snapshotOf([kamaraA, kamaraB], ["artist:3230-8576"]))).toEqual([]);
  });

  it("no repite el mismo nombre canónico: lo cubre el detector de nombres", () => {
    const left = artistFacts(1, "Banda X", { evidenceUrls: [{ url: "https://example.com/x", artists: 2 }] });
    const right = artistFacts(2, "Banda X", { evidenceUrls: [{ url: "https://example.com/x", artists: 2 }] });
    expect(run(snapshotOf([left, right]))).toEqual([]);
  });

  it("no propone coincidencias débiles por debajo del umbral", () => {
    const left = artistFacts(10, "Proyecto Alfa");
    const right = artistFacts(11, "Proyecto Beta");
    expect(run(snapshotOf([left, right]))).toEqual([]);
  });

  it("si otro detector ve el mismo par, gana el hallazgo con evidencia", () => {
    const other: Detector = {
      key: "detector_de_prueba", category: "fichas_repetidas", label: "Prueba", description: "Prueba",
      run: () => [{
        detector: "detector_de_prueba", category: "fichas_repetidas", signature: "prueba", severity: "medium",
        entity: { kind: "artist", id: 3230, label: "Kámara de Tortura" },
        title: "Par de prueba", related: [{ kind: "artist", id: 8576, label: "La Kámara De la Tortura" }],
        pair: [3230, 8576], evidence: {},
      }],
    };
    const findings = analyzeCatalog(snapshotOf([kamaraA, kamaraB]), { detectors: [other, evidenceArtistDuplicates], anomalies: false }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detector).toBe("artistas_duplicados_evidencia");
  });

  it("incluye los pares abiertos de la bandeja histórica", () => {
    const left = artistFacts(20, "Pendiente Uno");
    const right = artistFacts(21, "Pendiente Dos");
    const snap = snapshotOf([left, right]);
    snap.openReviewPairs = [{ reviewId: 77, aId: 20, bId: 21, aName: left.name, bName: right.name, note: null }];
    const findings = run(snap);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ signature: "revision_pendiente", pair: [20, 21], evidence: { reviewId: 77 } });
  });
});
