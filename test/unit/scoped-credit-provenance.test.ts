import { describe, expect, it } from "vitest";
import { scopedCreditsByType, type AlbumCreditRow, type AlbumTrackRow } from "../../src/api/repositories/albums.js";

describe("procedencia de créditos agrupados por pistas", () => {
  it("conserva todos los IDs de crédito para consultar las fuentes de cada pista", () => {
    const credit: AlbumCreditRow = { id: 10, creditType: "musician", role: "Backing vocals", personId: 1, personName: "Músico", personIsDeceased: false, artistId: null, artistName: null, organizationId: null, organizationName: null };
    const track: AlbumTrackRow = { notes: null, id: 1, discNumber: 1, trackNumber: 1, title: "Uno", durationSeconds: null, youtubeStartSeconds: null, hasLyrics: false, credits: [credit] };
    const result = scopedCreditsByType([track, { ...track, id: 2, trackNumber: 2, credits: [{ ...credit, id: 11 }] }], []);
    expect(result["musician"]).toEqual([expect.objectContaining({ creditIds: [10, 11], tracks: [{ discNumber: 1, trackNumber: 1 }, { discNumber: 1, trackNumber: 2 }] })]);
  });
});
