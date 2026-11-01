import { describe, expect, it } from "vitest";
import { inheritGenres, releaseTypeFrom, type ArtistGenres } from "../../src/youtube/album-completion.js";
import { radioGenresOf } from "../../src/radio/catalog.js";
import { annotateRadioCatalog } from "../../src/radio/genres.js";

const artist = (artistId: number, primary: string, ...secondary: string[]): ArtistGenres => ({
  artistId, name: `A${artistId}`,
  genres: [{ slug: primary, role: "primary", specific: true }, ...secondary.map((slug) => ({ slug, role: "secondary" as const, specific: true }))],
});

describe("tipo del disco del canal", () => {
  it("la hoja manda; con varias clasificaciones toma la única de publicación", () => {
    expect(releaseTypeFrom("Solo Artist, EP", "X - Y [Single] (2009) || Full Album ||")).toEqual({ type: "ep", via: "hoja" });
  });
  it("sin hoja usa la etiqueta del título", () => {
    expect(releaseTypeFrom(null, "1ra Edición - Sonó Así [EP] (2009) || Full Album ||")).toEqual({ type: "ep", via: "título del canal" });
  });
  it("no decide con tipos dudosos o sin etiqueta", () => {
    expect(releaseTypeFrom("EP, Live Album", null)).toBeNull();
    expect(releaseTypeFrom(null, "Banda - Disco (2001) || Full Album ||")).toBeNull();
    expect(releaseTypeFrom("Music Video", null)).toBeNull();
  });
});

describe("géneros heredados (AGENTS.md, 2026-10-31)", () => {
  it("un artista: su principal y sus secundarios", () => {
    expect(inheritGenres([artist(31, "pop-rock", "rock-latino")])).toMatchObject({ primary: "pop-rock", secondary: ["rock-latino"], basis: "artist" });
  });
  it("varios artistas: promedio con el mismo peso por artista", () => {
    const result = inheritGenres([artist(1, "punk-rock", "ska"), artist(2, "ska", "reggae"), artist(3, "punk-rock")]);
    // punk: (2/3 + 0 + 1)/3 = .556 · ska: (1/3 + 2/3)/3 = .333 · reggae: (1/3)/3 = .111
    expect(result).toMatchObject({ primary: "punk-rock", secondary: ["ska"], basis: "artists" });
  });
  it("empate: el que aparece en más artistas", () => {
    const result = inheritGenres([artist(1, "metal", "rock"), artist(2, "rock", "metal"), artist(3, "pop")]);
    expect(result?.primary).toMatch(/^(metal|rock)$/);
    expect(result?.secondary).toContain(result?.primary === "metal" ? "rock" : "metal");
  });
  it("sin géneros en ningún artista no inventa nada", () => {
    expect(inheritGenres([{ artistId: 1, name: "X", genres: [] }])).toBeNull();
  });
});

describe("la radio sabe el tipo y el origen del género", () => {
  it("anota albumType y genreOrigin heredado", () => {
    const genres = radioGenresOf([{ slug: "pop-rock", name: "Pop rock", family: "rock", role: "primary" }], null, "album:artist");
    const { catalog } = annotateRadioCatalog({ items: [{ videoId: "2VR8-YqeCLg", title: "Mirar Bien", albumType: "other" }] },
      new Map([["2VR8-YqeCLg", 2330]]), new Map([[2330, genres]]), "t", new Map([[2330, "ep"]]));
    expect((catalog["items"] as unknown[])[0]).toMatchObject({ albumId: 2330, albumType: "ep", genres: { genreOrigin: "album:artist", genreStatus: "confirmed" } });
  });
  it("sin principal el origen vuelve a ser el álbum", () => {
    expect(radioGenresOf([], "Rock", "album:artists").genreOrigin).toBe("album");
  });
});
