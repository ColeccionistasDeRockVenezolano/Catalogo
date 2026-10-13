// Discos partidos en varias fichas (Brian, 2026-10-11): la parte del título,
// el detector `discos_partidos` y los valores por defecto de `juntar_discos`.
import { describe, expect, it } from "vitest";
import { albumPart, firstPartLabel, partAgainst } from "../../src/merge/album-parts.js";
import { analyzeCatalog } from "../../src/curation/analyze.js";
import { juntarDiscosAction } from "../../src/curation/actions/structural.js";
import { cleanSnapshot } from "../support/curation-snapshot.js";
import type { CatalogSnapshot } from "../../src/curation/types.js";

describe("albumPart", () => {
  it("separa la base de la parte, con el nombre que da la fuente", () => {
    expect(albumPart("Live in Paris - Lado A")).toEqual({ base: "Live in Paris", label: "Lado A", kind: "lado", order: 1 });
    expect(albumPart("Se Buscan: Vivos o Inmortales (LADO B)")).toEqual({ base: "Se Buscan: Vivos o Inmortales", label: "Lado B", kind: "lado", order: 2 });
    expect(albumPart("Goma (Disco B)")).toMatchObject({ base: "Goma", label: "Disco B", kind: "disco" });
    expect(albumPart("La Mejor Salsa. Disco 1")).toMatchObject({ base: "La Mejor Salsa", label: "Disco 1" });
    expect(albumPart("40 años, 40 éxitos Vol. 2 Disco 2/2")).toMatchObject({ base: "40 años, 40 éxitos Vol. 2", label: "Disco 2", order: 2 });
    expect(albumPart("Exitos Volumen I")).toMatchObject({ base: "Exitos", label: "Volumen I", kind: "volumen", order: 1 });
    expect(albumPart("Joyas Musicales Vol.2")).toMatchObject({ base: "Joyas Musicales", label: "Vol. 2", order: 2 });
    expect(albumPart("La quema de la bestia, parte II")).toMatchObject({ base: "La quema de la bestia", label: "Parte II", kind: "parte", order: 2 });
    expect(albumPart("18 años de Ska (2003) dvd")).toEqual({ base: "18 años de Ska", label: "DVD", kind: "formato", order: null });
    expect(albumPart("Flor de Fuego (CD/DVD)")).toMatchObject({ base: "Flor de Fuego", label: "CD/DVD" });
    expect(albumPart("Internacional (CD Reissue)")).toEqual({ base: "Internacional", label: "CD Reissue", kind: "edicion", order: null });
    expect(albumPart("Atabal Yémal (Super Deluxe Vinyl Edition)")).toMatchObject({ base: "Atabal Yémal", kind: "edicion" });
    expect(albumPart("Culto Oculto (Cassette)")).toMatchObject({ base: "Culto Oculto", label: "Cassette" });
    expect(albumPart("Serie de Autores - Vol. II, Manuel Alejandro")).toEqual({ base: "Serie de Autores, Manuel Alejandro", label: "Vol. II", kind: "volumen", order: 2 });
    expect(albumPart("Compilado Zuliano Volumen II - Edición de Colección")).toMatchObject({ base: "Compilado Zuliano - Edición de Colección", label: "Volumen II" });
  });

  it("no ve partes donde no las hay ni deja una base vacía", () => {
    expect(albumPart("Vol. 3")).toBeNull();
    expect(albumPart("Side B")).toBeNull();
    expect(albumPart("Parte de mí")).toBeNull();
    expect(albumPart("Vida Loca")).toBeNull();
    expect(albumPart("Payback (Single)")).toBeNull();
  });
});

function withAlbums(albums: Array<{ id: number; title: string; year: number | null; artistId?: number }>): CatalogSnapshot {
  const snapshot = cleanSnapshot();
  for (const album of albums) {
    snapshot.albums.push({ id: album.id, artistId: album.artistId ?? 1, title: album.title, releaseYear: album.year, albumType: "live_album" });
  }
  return snapshot;
}

const split = (snapshot: CatalogSnapshot) => analyzeCatalog(snapshot).findings.filter((finding) => finding.detector === "discos_partidos");

describe("detector discos_partidos", () => {
  it("empareja los lados y los volúmenes del mismo año contra la primera parte", () => {
    const findings = split(withAlbums([
      { id: 9001, title: "Live in Paris - Lado A", year: 2018 },
      { id: 9002, title: "Live in Paris - Lado B", year: 2018 },
      { id: 9003, title: "Diez Años Vol. 1", year: 1994 },
      { id: 9004, title: "Diez Años Vol. 2", year: 1994 },
      { id: 9005, title: "Diez Años Vol. 3", year: 1994 },
      { id: 9006, title: "Internacional (CD Reissue)", year: 1997 },
      { id: 9007, title: "Internacional", year: 1980 },
    ]));
    expect(findings.map((finding) => [finding.pair, finding.signature])).toEqual([
      [[9001, 9002], "partido_lado"],
      [[9003, 9004], "partido_volumen"],
      [[9003, 9005], "partido_volumen"],
      [[9006, 9007], "partido_edicion"],
    ]);
    expect(findings[0]!.evidence).toMatchObject({ base: "Live in Paris", first: 9001, parts: { 9001: "Lado A", 9002: "Lado B" } });
    // La reedición se junta con la original aunque sea de otro año; la original es la primera.
    expect(findings[3]!.evidence).toMatchObject({ first: 9007, parts: { 9006: "CD Reissue", 9007: null } });
  });

  it("deja aparte los volúmenes de otro año o sin año, los «Vol. N» solos y la misma parte repetida", () => {
    const findings = split(withAlbums([
      { id: 9101, title: "Grandes Éxitos Vol. 1", year: 1980 },
      { id: 9102, title: "Grandes Éxitos Vol. 2", year: 1983 },
      { id: 9103, title: "Joyas Vol. 1", year: null },
      { id: 9104, title: "Joyas Vol. 2", year: null },
      { id: 9105, title: "Vol. 3", year: 1975 },
      { id: 9106, title: "Vol. 4", year: 1975 },
      { id: 9107, title: "Goma (Disco A)", year: 2001 },
      { id: 9108, title: "Goma - Disco A", year: 2001 },
    ]));
    expect(findings).toEqual([]);
  });

  it("un par ya declarado distinto no vuelve", () => {
    const snapshot = withAlbums([{ id: 9201, title: "Futuro - Lado A", year: 2013 }, { id: 9202, title: "Futuro - Lado B", year: 2013 }]);
    snapshot.handledPairs.add("album:9201-9202");
    expect(split(snapshot)).toEqual([]);
  });
});

describe("acción juntar_discos", () => {
  it("la ofrece el detector y pide comparar (nivel 2)", () => {
    const finding = { id: 1, detector: "discos_partidos", signature: "partido_lado", entity: { kind: "album", id: 9001, label: "x" }, evidence: { pair: [9001, 9002] } };
    expect(juntarDiscosAction.appliesTo(finding as never)).toBe(true);
    expect(juntarDiscosAction.levelFor(finding as never, null)).toBe(2);
    expect(juntarDiscosAction.appliesTo({ ...finding, detector: "discos_repetidos" } as never)).toBe(false);
  });
});

describe("partAgainst: qué parte es una ficha de la otra (2026-10-13)", () => {
  it("reconoce el material extra que repite el título del otro disco", () => {
    expect(partAgainst("B-Side: Harakiri City", "Harakiri City")).toMatchObject({ label: "B-Sides", order: 2 });
    expect(partAgainst("B-Sides: Miss Mujerzuela", "Miss Mujerzuela")).toMatchObject({ label: "B-Sides", order: 2 });
    expect(partAgainst("Demos: Nuestra", "Nuestra")).toMatchObject({ label: "Demos", order: 2 });
    expect(partAgainst("Hijos De Nadie (Temas Promocionales)", "Hijos De Nadie")).toMatchObject({ label: "Temas Promocionales" });
    expect(partAgainst("Desde Cero: Demos y Rarezas", "Desde Cero")).toMatchObject({ label: "Demos y Rarezas" });
    expect(partAgainst("B-Side: Live - Lado A", "Live - Lado A")).toMatchObject({ label: "B-Sides" });
  });

  it("usa las partes de siempre y no inventa una entre discos sin relación", () => {
    expect(partAgainst("Live in Paris - Lado B", "Live in Paris - Lado A")).toMatchObject({ label: "Lado B", order: 2 });
    expect(partAgainst("Harakiri City", "B-Side: Harakiri City")).toBeNull();
    expect(partAgainst("Black", "Black")).toBeNull();
    expect(partAgainst("Nuestra", "Otra cosa")).toBeNull();
  });

  it("firstPartLabel da el nombre de la primera parte", () => {
    expect(firstPartLabel("Lado B")).toBe("Lado A");
    expect(firstPartLabel("CD 2")).toBe("CD 1");
    expect(firstPartLabel("B-Sides")).toBeNull();
  });
});
