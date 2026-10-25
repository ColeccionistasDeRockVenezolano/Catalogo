// Regla «en vivo» del título (plan v2 del primo, etapa 2, punto 5) y su uso en
// la normalización común de la ingesta.
import { describe, expect, it } from "vitest";
import { liveTitleVerdict, isLiveTitle } from "../../src/normalization/live-title.js";
import { normalizeRecord, withLiveAlbumType } from "../../src/normalization/claims.js";
import type { RawRecord } from "../../src/adapters/contracts.js";

describe("liveTitleVerdict", () => {
  it("reconoce las marcas de un directo", () => {
    for (const title of [
      "En Vivo En El Teresa Carreño", "Cementerio Del Este (En Vivo)", "Deja (En directo)", "Live at Coachella 2025 Weekend 1",
      "Live From La Sabana", "Bonita Coincidencia (LIVE FROM LA SELVA)", "Dime Quién (Live)", "Amaranto (Live Version)",
      "Unplugged at LeTop, Valencia, Venezuela Julio 2008", "En Concierto", "El Rugido del Puma: El Concierto",
      "Desorden en Petare (Concierto en la Platabanda)", "Sigmatus 1GEC LIVE@LeKlub with Hypercore 25/10/2024", "Live",
    ]) expect(isLiveTitle(title), title).toBe(true);
  });

  it("no confunde canciones, obras ni nombres de banda", () => {
    expect(isLiveTitle("Vivo")).toBe(false);
    expect(isLiveTitle("Sigo Vivo")).toBe(false);
    expect(isLiveTitle("Concierto De Aranjuez")).toBe(false);
    expect(isLiveTitle("Concierto en la Llanura, Vol. 3")).toBe(false);
    expect(isLiveTitle("Concierto Para Guitarra y Orquesta")).toBe(false);
    expect(isLiveTitle("Ni En Concierto Ni En Estudio...")).toBe(false);
    expect(isLiveTitle("Delirium Live", "Delirium Live")).toBe(false);
    expect(isLiveTitle("Liverpool")).toBe(false);
  });

  it("deja como duda lo que no se atreve a decidir", () => {
    expect(liveTitleVerdict("Concierto De Aranjuez").doubt).toBe(true);
    expect(liveTitleVerdict("Spontaneous Live Series 007").doubt).toBe(true);
    expect(liveTitleVerdict("Retrovisor Acústico").doubt).toBe(true);
    expect(liveTitleVerdict("Maquétas / En Vivo")).toMatchObject({ live: false, doubt: true });
    expect(liveTitleVerdict("Ep / En vivo en El Valle")).toMatchObject({ live: false, doubt: true });
  });
});

describe("regla «en vivo» en la ingesta", () => {
  const where = { url: "https://example.com/disco", selector: "h1", position: 0 };
  const album = (fields: RawRecord["fields"], extractor = "rockzuela"): RawRecord =>
    ({ entityKind: "album", identity: "Banda::Disco", extractor, extractorVersion: "1", fields });

  it("deriva album_type = live_album cuando la fuente no da tipo", () => {
    const claims = normalizeRecord(album([
      { field: "title", value: "En Vivo En Moscú", evidence: where },
      { field: "artist_name", value: "Contra Marcha", evidence: where },
    ]));
    const type = claims.find((claim) => claim.field === "album_type");
    expect(type?.normalizedValue).toBe("live_album");
    expect(type?.evidence.url).toBe(where.url);
    expect(type?.evidence.excerpt).toContain("en vivo");
  });

  it("si la fuente da tipo, o es la hoja, no se deriva nada", () => {
    const typed = album([
      { field: "title", value: "Salserin (En Vivo)", evidence: where },
      { field: "album_type", value: "ep", evidence: where },
    ]);
    expect(withLiveAlbumType(typed)).toBe(typed);
    const sheet = album([{ field: "title", value: "Algo (En Vivo)", evidence: where }], "yt-master-seed");
    expect(withLiveAlbumType(sheet)).toBe(sheet);
    const studio = album([{ field: "title", value: "Vivo", evidence: where }]);
    expect(withLiveAlbumType(studio)).toBe(studio);
  });
});
