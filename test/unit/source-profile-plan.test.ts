import { describe, expect, it } from "vitest";
import { narrowPlanningInventory, profileDraft, profileIsReliable } from "../../src/verification/source-profile-plan.js";
import type { SourceProfileRun } from "../../src/verification/source-profile-run.js";
import { compareArtist, compareWorks, type CatalogArtist, type SourceProfile } from "../../src/verification/source-profiles.js";

const matched = { status: "matched" as const, score: 0.8, reason: "prueba", signals: [] };
const tracks = ["Uno", "Dos más largos", "Tres de prueba"];
const profile = (source: SourceProfile["source"], year: number): SourceProfile => ({
  source, externalId: source, name: "Jeremías", url: null, country: null, beginYear: null, tags: [], identity: matched, requests: 0,
  releases: [
    { externalId: `${source}-1`, title: "Un día más en el gran circo", year, type: null, trackCount: 3, tracks, label: null, coverUrl: null, url: `https://${source}.example/1` },
    { externalId: `${source}-2`, title: "Acuérdate", year: 2018, type: null, trackCount: 1, tracks: [], label: null, coverUrl: null, url: `https://${source}.example/2` },
  ],
});
const artist: CatalogArtist = {
  id: 1, name: "Jeremías", aliases: [], country: "Venezuela", formedYear: null, memberNames: [],
  albums: [{ id: 10, title: "Un día más en el gran circo", year: 2008, type: "studio_album", trackTitles: [], hasCover: true }],
};
const run = (profiles: SourceProfile[]): SourceProfileRun => ({
  artist, attempts: {}, knownIds: {}, profiles, works: compareWorks(artist, profiles), artistFields: compareArtist(artist, profiles), requests: { deezer: 0, itunes: 0, musicbrainz: 0, discogs: 0, lastfm: 0 },
});

describe("perfiles en la petición general", () => {
  it("solo se usan con dos familias de origen confirmadas", () => {
    expect(profileIsReliable(run([profile("deezer", 2007), profile("itunes", 2007)]))).toBe(false);
    expect(profileIsReliable(run([profile("deezer", 2007), profile("musicbrainz", 2007)]))).toBe(true);
  });

  it("propone año y pistas con su cita, y deja los discos nuevos pendientes", () => {
    const { draft, evidence } = profileDraft(run([profile("deezer", 2007), profile("musicbrainz", 2007), profile("discogs", 2007)]));
    const year = draft.operations.find((op) => op.op === "replace_fields");
    expect(year).toMatchObject({ target: { kind: "album", id: 10 }, values: { releaseYear: 2007 } });
    expect(year!.evidenceIds.length).toBeGreaterThan(0);
    expect(draft.operations.filter((op) => op.op === "create_entity").map((op) => op.op === "create_entity" && op.values["title"])).toEqual(tracks);
    expect(draft.unresolved.some((item) => item.includes("«Acuérdate»"))).toBe(true);
    for (const op of draft.operations) for (const ref of op.evidenceIds) expect(evidence.some((item) => item.id === ref)).toBe(true);
  });

  it("quita del planificador los hallazgos de discografía y sus citas, no los demás", () => {
    const evidence = [1, 2, 3].map((n) => ({ id: `E${n}`, url: `https://x/${n}`, quote: `q${n}`, fetchedAt: "", origin: "page", contentHash: "", label: "" }));
    const context = { report: { pending: [
      { key: "tracks.1", area: "tracks", evidenceIds: ["E1", "E2"] },
      { key: "bio", area: "biography", evidenceIds: ["E2", "E3"] },
    ] } };
    const narrowed = narrowPlanningInventory(context, evidence);
    expect(narrowed.removedFindings).toEqual(["tracks.1"]);
    expect(narrowed.evidence.map((item) => item.id)).toEqual(["E2", "E3"]);
    // Un pedido dirigido a un hallazgo concreto no se recorta.
    expect(narrowPlanningInventory({ report: { ...context.report, selectedKey: "tracks.1" } }, evidence).removedFindings).toEqual([]);
  });
});
