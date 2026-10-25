import { describe, expect, it } from "vitest";
import { buildContext, fingerprintOf, GLOBAL_DETECTORS, LOCAL_DETECTORS } from "../../src/curation/analyze.js";
import { documentedResearch, researchAlbumHash } from "../../src/curation/detectors/documented-research.js";
import cases from "../../src/curation/research/album-tracklists-2026-10-15.json" with { type: "json" };
import { summarizeActions } from "../../src/curation/actions/registry.js";
import { cleanSnapshot } from "../support/curation-snapshot.js";

function snapshotForCase() {
  const snapshot = cleanSnapshot();
  const item = cases.cases.find((row) => row.verdict === "consolidar")!;
  snapshot.artists = [...new Map(item.albums.map((album) => [album.artistId, { id: album.artistId, name: album.artist,
    originCity: null, formedYear: null, disbandedYear: null }])).values()];
  snapshot.albums = item.albums.map((album) => ({ id: album.id, artistId: album.artistId,
    title: album.title, releaseYear: album.year, albumType: album.type }));
  snapshot.tracks = [];
  return { snapshot, item };
}

describe("investigaciones documentadas en Curaduría", () => {
  it("carga solo los 81 pares revisados y no la matriz pendiente", () => {
    expect(cases.cases).toHaveLength(81);
    expect(new Set(cases.cases.map((item) => item.id)).size).toBe(81);
    expect(cases.cases.filter((item) => item.verdict === "consolidar")).toHaveLength(26);
    for (const item of cases.cases) {
      expect(item.sources.length).toBeGreaterThan(0);
      expect(item.sources.every((url) => /^https?:\/\//u.test(url))).toBe(true);
    }
  });

  it("no atribuye evidencia a ids iguales de otro catálogo", () => {
    const { snapshot } = snapshotForCase();
    snapshot.artists[0]!.name = "Otra identidad";
    expect(documentedResearch.run(buildContext(snapshot))).toEqual([]);
    expect(documentedResearch.run(buildContext(cleanSnapshot()))).toEqual([]);
  });

  it("respeta las decisiones de mantener separados y las fichas ya absorbidas", () => {
    const { snapshot, item } = snapshotForCase();
    expect(documentedResearch.run(buildContext(snapshot))).toHaveLength(1);
    snapshot.distinctPairs.add(`album:${item.id}`);
    expect(documentedResearch.run(buildContext(snapshot))).toEqual([]);
    snapshot.distinctPairs.clear();
    snapshot.albums.pop();
    expect(documentedResearch.run(buildContext(snapshot))).toEqual([]);
  });

  it("señala los datos cambiados y nunca ofrece fusiones automáticas", () => {
    const { snapshot, item } = snapshotForCase();
    const [finding] = documentedResearch.run(buildContext(snapshot));
    expect(finding!.evidence["research"]).toMatchObject({
      changedAlbumIds: item.albums.map((album) => album.id),
      suggestedKeep: item.suggestedKeep,
    });
    expect(summarizeActions({ ...finding!, id: 1, status: "open", field: finding!.field ?? null,
      value: finding!.value ?? null, suggestedValue: finding!.suggestedValue ?? null })).toEqual([]);
    const before = fingerprintOf(finding!);
    snapshot.albums[0]!.title += " corregido";
    expect(fingerprintOf(documentedResearch.run(buildContext(snapshot))[0]!)).toBe(before);
  });

  it("la huella detecta duración, título y tipo, sin depender del orden de consulta", () => {
    const { snapshot } = snapshotForCase();
    const album = snapshot.albums[0]!;
    const tracks = [1, 2].map((number) => ({ id: number, albumId: album.id, disc: 1, number, title: `Tema ${number}`, durationSeconds: 180 }));
    const hash = researchAlbumHash(album, tracks);
    expect(researchAlbumHash(album, [...tracks].reverse())).toBe(hash);
    expect(researchAlbumHash(album, [{ ...tracks[0]!, durationSeconds: 181 }, tracks[1]!])).not.toBe(hash);
    expect(researchAlbumHash({ ...album, title: "Otro" }, tracks)).not.toBe(hash);
    expect(researchAlbumHash({ ...album, albumType: "single" }, tracks)).not.toBe(hash);
  });

  it("un análisis dirigido no cierra expedientes que no comparó", () => {
    expect(LOCAL_DETECTORS).not.toContain(documentedResearch);
    expect(GLOBAL_DETECTORS).toContain(documentedResearch);
  });
});
