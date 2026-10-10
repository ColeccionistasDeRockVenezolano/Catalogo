import { describe, expect, it } from "vitest";
import { buildContext } from "../../src/curation/analyze.js";
import { impossibleTimeline } from "../../src/curation/detectors/advanced.js";
import {
  eraSplit, lifeIssues, mergeEraConflict, type PersonTimeline, type TimelineEvent,
} from "../../src/curation/person-timeline.js";
import type { CatalogSnapshot } from "../../src/curation/types.js";

let ref = 0;
function event(year: number, artistId: number, creditType = "musician", extra: Partial<TimelineEvent> = {}): TimelineEvent {
  ref += 1;
  return { year, source: "album", refId: ref, creditType, role: creditType, artistId, albumId: artistId * 100 + year, albumType: "studio_album", ...extra };
}
function timeline(events: TimelineEvent[], extra: Partial<PersonTimeline> = {}): PersonTimeline {
  return { personId: 1, birthYear: null, deathYear: null, events, ownArtists: new Set(), ...extra };
}
const none = () => new Set<number>();

describe("trayectoria de una persona (caso Víctor Valerio)", () => {
  it("dos épocas separadas ≥20 años sin vínculo: el ingeniero de 1978 y el bajista de 2010", () => {
    const valerio = timeline([event(1978, 40, "producer"), event(1979, 1890, "mixing"), event(2010, 181, "musician"), event(2010, 181, "member", { source: "member", albumId: null })]);
    const split = eraSplit(valerio, none);
    expect(split).toMatchObject({ gap: 31, before: { from: 1978, to: 1979, families: ["técnico"] }, after: { from: 2010, to: 2010, families: ["intérprete"] } });
  });

  it("no corta si comparten artista (reedición o regreso) o ≥2 colegas", () => {
    expect(eraSplit(timeline([event(1982, 7), event(2013, 7)]), none)).toBeNull();
    const shared = () => new Set([2, 3]);
    expect(eraSplit(timeline([event(1964, 7), event(2007, 8)]), shared)).toBeNull();
    expect(eraSplit(timeline([event(1990, 7), event(2009, 8)]), none)).toBeNull(); // 19 años: carrera larga, no homónimo
  });

  it("compositor, reedición, recopilatorio y Various Artists no fechan a la persona", () => {
    const covered = timeline([
      event(1970, 7), event(2015, 8, "composer"), event(2016, 9, "mastering", { role: "Remastered by" }),
      event(2017, 10, "musician", { albumType: "compilation" }), event(2018, 257),
    ]);
    expect(eraSplit(covered, none)).toBeNull();
  });

  it("créditos antes de nacer, con menos de 12 años y después de morir", () => {
    const kinds = (t: PersonTimeline) => lifeIssues(t).map((issue) => issue.kind);
    expect(kinds(timeline([event(1965, 7), event(1980, 7)], { birthYear: 1972 }))).toEqual(["antes_de_nacer", "menor_de_edad"]);
    expect(kinds(timeline([event(2010, 7, "mixing")], { deathYear: 2006 }))).toEqual(["despues_de_morir"]);
  });

  it("después de morir solo cuentan lo técnico y las membresías: no las voces de archivo, la obra visual ni el compositor", () => {
    const sadel = timeline([
      event(1999, 5), event(2007, 9, "artwork"), event(2015, 9, "composer"), event(2007, 9, "guest"),
      event(1991, 9, "mixing"), event(2001, 5, "producer"),
    ], { deathYear: 1989, ownArtists: new Set([5]) });
    expect(lifeIssues(sadel)).toEqual([]);
    const member = timeline([event(2001, 5, "member", { source: "member", albumId: null })], { deathYear: 1999, ownArtists: new Set([5]) });
    expect(lifeIssues(member).map((issue) => issue.kind)).toEqual(["despues_de_morir"]);
  });

  it("veto de fusión: épocas incompatibles, nacimiento y muerte de la otra ficha", () => {
    const young = timeline([event(2010, 181)]);
    const engineer = timeline([event(1978, 3794, "mixing")]);
    const noLink = { sharedArtists: 0, sharedAlbums: 0, sharedColleagues: 0 };
    expect(mergeEraConflict(young, engineer, noLink)).toMatch(/32 años/u);
    expect(mergeEraConflict(young, engineer, { ...noLink, sharedArtists: 1 })).toBeNull();
    expect(mergeEraConflict(timeline([], { birthYear: 1999 }), engineer, noLink)).toMatch(/nació en 1999; la otra ficha tiene créditos de 1978/u);
    expect(mergeEraConflict(timeline([event(1960, 3)], { deathYear: 2006 }), timeline([event(2010, 4, "mixing")]), { ...noLink, sharedColleagues: 2 }))
      .toMatch(/murió en 2006/u);
    expect(mergeEraConflict(timeline([event(1990, 3)]), timeline([event(2000, 4)]), noLink)).toBeNull();
  });
});

describe("detector trayectoria_imposible", () => {
  it("marca la vida imposible y respeta los discos póstumos del propio proyecto", () => {
    const snapshot: CatalogSnapshot = {
      takenAt: new Date("2026-10-06T12:00:00Z"),
      artists: [
        { id: 1, name: "Caramelos De Cianuro", originCity: null, formedYear: 1991, disbandedYear: null },
        { id: 2, name: "Felipe Pirela", originCity: null, formedYear: null, disbandedYear: null },
        { id: 3, name: "Niuno Niotro", originCity: null, formedYear: null, disbandedYear: null },
      ],
      persons: [
        { id: 10, name: "James Brown", deathYear: 2006 },
        { id: 11, name: "Felipe Pirela", deathYear: 1972 },
        { id: 12, name: "Víctor Valerio", birthYear: 1999 },
      ],
      organizations: [],
      albums: [
        { id: 100, artistId: 1, title: "Caramelos de Cianuro", releaseYear: 2010, albumType: "studio_album" },
        { id: 101, artistId: 2, title: "Éxitos", releaseYear: 1987, albumType: "studio_album" },
        { id: 102, artistId: 3, title: "EP", releaseYear: 1978, albumType: "studio_album" },
      ],
      tracks: [],
      creditRoles: [],
      credits: [
        { id: 1, parentKind: "album", parentId: 100, personId: 10, artistId: null, organizationId: null, creditType: "mixing", role: "Mixed by" },
        { id: 2, parentKind: "album", parentId: 101, personId: 11, artistId: null, organizationId: null, creditType: "musician", role: "Voz" },
        { id: 3, parentKind: "album", parentId: 102, personId: 12, artistId: null, organizationId: null, creditType: "mixing", role: "Recorded & Mixed by" },
      ],
      memberships: [{ id: 1, artistId: 2, personId: 11, role: "Voz", fromYear: 1964, toYear: 1972, isCurrent: false }],
      personArtists: new Map(), personLinks: new Map(), organizationLinks: new Map(), artistLinks: new Map(),
      reviews: [], conflicts: [], handledPairs: new Set(), distinctPairs: new Set(),
    };
    const findings = impossibleTimeline.run(buildContext(snapshot));
    expect(findings.map((finding) => [finding.entity.id, finding.signature])).toEqual([[10, "despues_de_morir"], [12, "antes_de_nacer"]]);
    expect(findings[1]!.title).toBe("«Víctor Valerio» nació en 1999 y tiene créditos de 1978");
  });
});
