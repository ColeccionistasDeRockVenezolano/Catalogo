import { describe, expect, it } from "vitest";
import { compareWorks, isGenericTitle, singleTitleCheck, voteField, workKey, type CatalogArtist, type SourceProfile } from "../../src/verification/source-profiles.js";

const matched = { status: "matched" as const, score: 0.8, reason: "prueba", signals: [] };
const profile = (source: SourceProfile["source"], releases: Array<Partial<SourceProfile["releases"][number]> & { title: string }>): SourceProfile => ({
  source, externalId: source, name: "Jeremías", url: null, country: null, beginYear: null, tags: [], identity: matched, requests: 0,
  releases: releases.map((release) => ({ externalId: release.title, year: null, type: null, trackCount: null, tracks: [], label: null, coverUrl: null, url: null, ...release })),
});
const catalog: CatalogArtist = {
  id: 1, name: "Jeremías", aliases: [], country: "Venezuela", formedYear: null, memberNames: [],
  albums: [{ id: 10, title: "Un día más en el gran circo", year: 2007, type: "studio_album", trackTitles: [], hasCover: true }],
};

describe("perfiles por fuente", () => {
  it("una obra ignora las marcas de edición", () => {
    expect(workKey("Acuérdate - Single")).toBe(workKey("Acuérdate"));
    expect(workKey("Ese Que Va por Ahí (Bonus Track Version)")).toBe(workKey("Ese que va por ahí"));
  });

  it("las plataformas de un mismo distribuidor votan una sola vez", () => {
    const vote = voteField({ deezer: 2015, itunes: 2015, musicbrainz: 2009, discogs: 2009 }, null,
      { priority: ["musicbrainz", "discogs", "distribuidor", "lastfm"], collapse: (values) => Math.min(...values) });
    expect(vote.value).toBe(2009);
    expect(vote.support).toEqual(["musicbrainz", "discogs"]);
  });

  it("un empate va a revisión aunque una fuente tenga prioridad", () => {
    const vote = voteField({ musicbrainz: "National Own", itunes: "Universal Music Latino" }, null,
      { priority: ["discogs", "musicbrainz", "distribuidor", "lastfm"], collapse: (values) => values[0]! });
    expect(vote.status).toBe("dudoso");
  });

  it("Last.fm se muestra pero no vota", () => {
    const vote = voteField({ lastfm: 1999, musicbrainz: 2007 }, 2007,
      { priority: ["musicbrainz", "discogs", "distribuidor", "lastfm"], collapse: (values) => Math.min(...values) });
    expect(vote.status).toBe("coincide");
    expect(vote.bySource.lastfm).toBe(1999);
  });

  it("un año solo de plataformas no corrige la ficha", () => {
    const [work] = compareWorks(catalog, [profile("itunes", [{ title: "Un Día Más en el Gran Circo", year: 2014 }])]);
    expect(work!.year.status).toBe("dudoso");
  });

  it("propone las pistas solo si dos familias las nombran", () => {
    const tracks = ["Juan de Afuera", "El Seductor"];
    const [work] = compareWorks(catalog, [
      profile("itunes", [{ title: "Un día más en el gran circo", trackCount: 2, tracks }]),
      profile("musicbrainz", [{ title: "Un día más en el gran circo", trackCount: 2, tracks, year: 2007 }]),
    ]);
    expect(work!.tracks.status).toBe("propuesta");
    expect(work!.trackCount.value).toBe(2);
    expect(work!.year.status).toBe("coincide");
  });
});

describe("pistas", () => {
  it("ignora numeración, versiones y año", async () => {
    const { sameTrack } = await import("../../src/verification/source-profiles.js");
    expect(sameTrack("I. El Mar - El Que Tiene No Valora", "El Mar - El Que Tiene No Valora")).toBe(true);
    expect(sameTrack("El Mar - Audiotree Live Version", "El Mar")).toBe(true);
    expect(sameTrack("Nigredo : Lider De Sueños", "Nigredo")).toBe(true);
    expect(sameTrack("IV Perder - 2024", "IV Perder (2024)")).toBe(true);
    expect(sameTrack("The Farmers", "A Farewell to Seasons")).toBe(false);
    expect(sameTrack("Falling Senses", "Failing Senses")).toBe(false);
  });

  it("los títulos genéricos no prueban identidad", () => {
    for (const title of ["Demo", "En Vivo", "Grandes Éxitos de Oro", "Lo Mejor de Témpano", "Vol. 2", "S/T", "Tú", "B-Sides"]) expect(isGenericTitle(title)).toBe(true);
    for (const title of ["Ese que va por ahí", "Selective Memory", "Atabal-Yémal", "En Vivo desde el Teresa Carreño"]) expect(isGenericTitle(title)).toBe(false);
  });

  it("con un solo disco en común el año tiene que acompañar", () => {
    expect(singleTitleCheck("Pesadilla", 1998, 1999).ok).toBe(true);
    expect(singleTitleCheck("Pesadilla", 1998, 1990).ok).toBe(false);
    // Fecha digital posterior: solo pasa con un título inconfundible.
    expect(singleTitleCheck("Pesadilla", 1985, 2015).ok).toBe(false);
    expect(singleTitleCheck("Un día más en el gran circo", 1985, 2015).ok).toBe(true);
    expect(singleTitleCheck("Pesadilla", null, 2015).ok).toBe(false);
  });
});
