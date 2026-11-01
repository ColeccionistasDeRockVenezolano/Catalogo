import { describe, expect, it } from "vitest";
import {
  ARTIST_CANDIDATE_MIN_SCORE, scoreArtistPair, type ArtistFacts,
} from "../../src/review/artist-candidates.js";

// Capas 0-2 del detector de artistas: guardas, señales deterministas y
// puntuación explicable. La puntuación se prueba aquí sin base de datos; el
// contrato con PostgreSQL vive en test/contract/artist-candidates.test.ts.

function artist(id: number, name: string, overrides: Partial<ArtistFacts> = {}): ArtistFacts {
  const base: ArtistFacts = {
    id, name, artistType: "band", aliases: [], originCity: null, originCountry: "Venezuela",
    formedYear: null, disbandedYear: null, albumKeys: new Set(), tracklistHashes: new Map(),
    members: [], evidenceUrls: [], officialLinks: [], externalIds: [], pictureUrl: null,
  };
  return { ...base, ...overrides };
}

const PICTURE = "3f6cda9d663034075039e4be52b8a6559cb7799ad865bf397cdd2b0792cd716e";
const RHY = "https://rockhechovenezuela.com/k/kamara-de-la-tortura-la";

/** El caso real 3230/8576: mismo disco, mismos músicos, misma página, misma foto. */
function realPair(): [ArtistFacts, ArtistFacts] {
  const a = artist(3230, "Kámara de Tortura", {
    aliases: ["La Kámara de Tortura", "La Kámara de Torturas", "La Panza de Buda"],
    originCity: "Maracay - Aragua", formedYear: 1978,
    albumKeys: new Set(["vampiro|2003"]),
    tracklistHashes: new Map([["hash-vampiro", "Vampiro (2003)"]]),
    members: [
      { key: "gustavo guerrero", name: "Gustavo Guerrero", role: "Guitarra, voz", instruments: ["guitar", "vocals"] },
      { key: "carlos rojas", name: "Carlos Rojas", role: "Bajo", instruments: ["bass"] },
      { key: "ernesto tito dan", name: 'Ernesto "Tito" Dan', role: "Guitarra", instruments: ["guitar"] },
    ],
    evidenceUrls: [{ url: RHY, artists: 2 }],
    pictureUrl: `/crv/media/curated/${PICTURE}.jpg`,
  });
  const b = artist(8576, "La Kámara De la Tortura", {
    originCity: "Maracay",
    albumKeys: new Set(["vampiro|2003", "otro|2004"]),
    tracklistHashes: new Map([["hash-vampiro", "Vampiro (2003)"]]),
    members: [
      { key: "gustavo guerrero", name: "Gustavo Guerrero", role: "Guitars & Lead Vocals", instruments: ["guitar", "vocals"] },
      { key: "carlos rojas", name: "Carlos Rojas", role: "Bass", instruments: ["bass"] },
      { key: "edgardo mata", name: "Edgardo Mata", role: "Drums", instruments: ["drums"] },
    ],
    evidenceUrls: [{ url: RHY, artists: 2 }],
    pictureUrl: "/crv/media/artist/8576.jpg",
  });
  return [a, b];
}

describe("scoreArtistPair (capas 0-2)", () => {
  it("identifica el par real por página, tracklist, integrantes, foto y fonética", () => {
    const [a, b] = realPair();
    const pictures = new Map([[a.pictureUrl!, PICTURE], [b.pictureUrl!, PICTURE]]);
    const scored = scoreArtistPair(a, b, pictures);
    expect(scored.blocked).toBeNull();
    expect(scored.deterministic).toBe(true);
    expect(scored.score).toBe(1);
    const keys = scored.features.map((feature) => feature.key);
    for (const key of ["shared_evidence_url", "tracklist_equal", "picture_equal", "member_overlap", "album_overlap",
      "name_token_containment", "name_jaro_winkler", "name_phonetic", "same_city"]) {
      expect(keys).toContain(key);
    }
  });

  it("bloquea homónimos de épocas separadas, ciudades distintas y sin ancla documental", () => {
    const a = artist(1, "Témpano", { originCity: "Maracay", formedYear: 1975 });
    const b = artist(2, "El Témpano", { originCity: "Caracas", formedYear: 2005 });
    const scored = scoreArtistPair(a, b);
    expect(scored.blocked).toContain("trayectorias separadas");
    expect(scored.score).toBe(0);
  });

  it("no bloquea una reunión con la misma ciudad aunque pasen 20 años", () => {
    const a = artist(1, "Témpano", { originCity: "Maracay", formedYear: 1978, disbandedYear: 1983 });
    const b = artist(2, "El Témpano", { originCity: "Maracay", formedYear: 2003 });
    expect(scoreArtistPair(a, b).blocked).toBeNull();
  });

  it("una página de directorio compartida por 5 fichas no propone el par por sí sola", () => {
    const url = "https://example.com/directorio";
    const a = artist(1, "Sonora A", { evidenceUrls: [{ url, artists: 5 }] });
    const b = artist(2, "Sonora B", { evidenceUrls: [{ url, artists: 5 }] });
    const scored = scoreArtistPair(a, b);
    expect(scored.deterministic).toBe(false);
    expect(scored.score).toBeLessThan(ARTIST_CANDIDATE_MIN_SCORE);
    expect(scored.features.find((feature) => feature.key === "shared_evidence_url")?.evidence).toContain("directorio");
  });

  it("un alias que ya pertenece a la otra ficha es señal determinista", () => {
    const a = artist(1, "La Kamara", {});
    const b = artist(2, "Kámara de Tortura", { aliases: ["La Kamara"] });
    const scored = scoreArtistPair(a, b);
    expect(scored.features.map((feature) => feature.key)).toContain("alias_claimed");
    expect(scored.deterministic).toBe(true);
  });

  it("la misma foto sola basta para abrir revisión", () => {
    const a = artist(1, "Proyecto A", { pictureUrl: "/crv/media/artist/1.jpg" });
    const b = artist(2, "Proyecto B", { pictureUrl: "/crv/media/curated/x.jpg" });
    const pictures = new Map([[a.pictureUrl!, PICTURE], [b.pictureUrl!, PICTURE]]);
    const scored = scoreArtistPair(a, b, pictures);
    expect(scored.deterministic).toBe(true);
    expect(scored.score).toBeGreaterThanOrEqual(ARTIST_CANDIDATE_MIN_SCORE);
  });

  it("dos identificadores del mismo namespace con valores distintos restan", () => {
    const a = artist(1, "Banda X", { externalIds: ["discogs:111"], originCity: "Caracas", formedYear: 1990 });
    const b = artist(2, "Banda X", { externalIds: ["discogs:222"], originCity: "Caracas", formedYear: 1990 });
    const scored = scoreArtistPair(a, b);
    const clash = scored.features.find((feature) => feature.key === "external_id_clash");
    expect(clash?.value).toBeLessThan(0);
  });

  it("la misma cuenta oficial de streaming es señal determinista", () => {
    const url = "https://open.spotify.com/artist/4uZ9";
    const a = artist(1, "Proyecto A", { officialLinks: [{ url, platform: "spotify", artists: 2 }] });
    const b = artist(2, "Proyecto B", { officialLinks: [{ url, platform: "spotify", artists: 2 }] });
    const scored = scoreArtistPair(a, b);
    expect(scored.deterministic).toBe(true);
    expect(scored.features.find((feature) => feature.key === "shared_official_link")?.value).toBe(0.5);
  });

  it("«Various Artists» nunca se propone", () => {
    const a = artist(257, "Various Artists", {});
    const b = artist(258, "Various Artists ", {});
    expect(scoreArtistPair(a, b).blocked).toContain("Various Artists");
  });

  it("Cámara y Kámara comparten clave fonética aunque no los tokens", () => {
    const a = artist(1, "Cámara de Tortura", {});
    const b = artist(2, "Kámara de Tortura", {});
    const scored = scoreArtistPair(a, b);
    expect(scored.features.map((feature) => feature.key)).toContain("name_phonetic");
  });
});
