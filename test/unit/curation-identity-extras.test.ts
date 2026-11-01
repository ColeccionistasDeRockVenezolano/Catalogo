import { describe, expect, it } from "vitest";
import { analyzeCatalog } from "../../src/curation/analyze.js";
import { editionConflicts, homonymPersons, repeatedPortraits } from "../../src/curation/detectors/identity-extras.js";
import type { ArtistFacts } from "../../src/review/artist-candidates.js";
import type { CatalogSnapshot, SnapshotAlbum, SnapshotMembership, SnapshotTrack } from "../../src/curation/types.js";

const facts = (id: number, name: string, pictureUrl: string | null = null): ArtistFacts => ({
  id, name, artistType: "band", aliases: [], originCity: null, originCountry: null,
  formedYear: null, disbandedYear: null, albumKeys: new Set(), tracklistHashes: new Map(),
  members: [], evidenceUrls: [], officialLinks: [], externalIds: [], pictureUrl,
});

function snapshot(overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    takenAt: new Date("2026-10-29T00:00:00Z"),
    artists: [{ id: 1, name: "Banda", originCity: null, formedYear: null, disbandedYear: null }],
    persons: [{ id: 10, name: "Gustavo Guerrero" }, { id: 11, name: "Gustavo Guerrero" }, { id: 12, name: "Otra Persona" }],
    organizations: [], albums: [], tracks: [], creditRoles: [], credits: [],
    memberships: [], aliases: [], redirects: [], mediaLinks: [],
    personArtists: new Map(), personLinks: new Map(), organizationLinks: new Map(), artistLinks: new Map(),
    reviews: [], conflicts: [], handledPairs: new Set(), distinctPairs: new Set(), ...overrides,
  };
}

const membership = (id: number, personId: number): SnapshotMembership => ({
  id, artistId: 1, personId, role: "Guitarra", fromYear: 1990, toYear: 1995, isCurrent: false,
});

const album = (id: number, title: string, year: number): SnapshotAlbum => ({ id, artistId: 1, title, releaseYear: year, albumType: "studio_album" });
const track = (id: number, albumId: number, number: number, title: string): SnapshotTrack => ({
  id, albumId, disc: 1, number, title, durationSeconds: 200,
});

describe("detectores de identidad y edición (etapa 5)", () => {
  it("encuentra personas homónimas dentro del mismo artista", () => {
    const snap = snapshot({ memberships: [membership(1, 10), membership(2, 11), membership(3, 12)] });
    const findings = analyzeCatalog(snap, { detectors: [homonymPersons], anomalies: false }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ detector: "personas_homonimas_en_artista", signature: "mismo_nombre", pair: [10, 11] });
  });

  it("encuentra retratos repetidos y descarta marcadores de posición", () => {
    const snap = snapshot({
      artistFacts: [facts(1, "Banda", "/crv/media/curated/aaaa.jpg"), facts(2, "Otra", "/crv/media/curated/aaaa.jpg"), facts(3, "Tercera", "/crv/media/placeholder.png")],
      artists: [
        { id: 1, name: "Banda", originCity: null, formedYear: null, disbandedYear: null },
        { id: 2, name: "Otra", originCity: null, formedYear: null, disbandedYear: null },
        { id: 3, name: "Tercera", originCity: null, formedYear: null, disbandedYear: null },
      ],
    });
    const findings = analyzeCatalog(snap, { detectors: [repeatedPortraits], anomalies: false }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ detector: "retratos_repetidos", pair: [1, 2] });
  });

  it("distingue ediciones con listas distintas y no toca títulos vacíos", () => {
    const snap = snapshot({
      albums: [album(1, "Vampiro", 2003), album(2, "Vampiro", 2003), album(3, "@@@@@", 2003), album(4, "@@@@@", 2003)],
      tracks: [track(1, 1, 1, "Uno"), track(2, 1, 2, "Dos"), track(3, 2, 1, "Uno"), track(4, 2, 2, "Otro")],
    });
    const findings = analyzeCatalog(snap, { detectors: [editionConflicts], anomalies: false }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ detector: "ediciones_en_conflicto", signature: "listas_distintas" });
    expect(findings[0]!.evidence).toMatchObject({ albumIds: [1, 2] });
  });
});
