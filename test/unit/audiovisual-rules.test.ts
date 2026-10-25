import { describe, expect, it } from "vitest";
import { audiovisualAlbumException, audiovisualKind } from "../../src/youtube/audiovisual-rules.js";
import { classifySheetRow } from "../../src/youtube/normalization.js";
import { seedRecords, type SeedRow } from "../../src/youtube/seed-claims.js";
import { planUpload } from "../../src/youtube/channel-watch.js";

describe("audiovisuales separados de la discografía", () => {
  const row: SeedRow = { upload_order: 1, artist_name_raw: "Candy66", album_name_raw: "Sesión", album_year_raw: 2010,
    type_raw: "Live Concert, Documentary", video_id: "sVUKZnbTLsE", row_number: 2, content_kind: "review", normalized_type: null };
  it("no convierte tipos compuestos ni clasificaciones antiguas en discos", () => {
    for (const type of ["Live Concert, Documentary", "Live Concert, Single", "Shorts", "Interview", "Music Video"]) {
      expect(classifySheetRow({ type, artistName: "Banda", albumName: "Obra" }).kind).toBe("media");
      expect(seedRecords([{ ...row, type_raw: type }]).records.some(record => record.entityKind === "album")).toBe(false);
    }
    expect(classifySheetRow({ type: "Live Album", artistName: "Banda", albumName: "Obra" }).kind).toBe("release");
  });
  it("mantiene solo Blues Criollo de Gasolina como excepción musical", () => {
    expect(audiovisualAlbumException("Gasolina", "Blues Criollo")).toBe(true);
    expect(audiovisualAlbumException("Gasolina", "Otro documental")).toBe(false);
    expect(audiovisualAlbumException("Otra banda", "Blues Criollo")).toBe(false);
    const gas = { ...row, artist_name_raw: "Gasolina", album_name_raw: "Blues Criollo", video_id: "bePwD424LvA", type_raw: "Documentary", content_kind: "media" };
    expect(classifySheetRow({ artistName: "Gasolina", albumName: "Blues Criollo", type: "Documentary" })).toMatchObject({ kind: "release", normalizedType: "other" });
    expect(seedRecords([gas]).records.filter(record => record.entityKind === "album")).toHaveLength(1);
  });
  it("reconoce el documental aunque se haya añadido también Full Album al título", () => {
    const title = "Viniloversus - Tiempo Nos Queda (2010) || Full Documentary || Full Album ||";
    expect(audiovisualKind(null, title)).toBe("documentary");
    expect(planUpload({ videoId: "pcS_p4F-cm0", title, durationSeconds: 4000, publicationStatus: "published", tracklist: [] },
      { artistsByKey: new Map(), albumsOf: () => [] }).action).toBe("audiovisual");
  });
  it("requiere evidencia audiovisual y reconoce las sesiones acústicas del canal", () => {
    expect(audiovisualKind(null, "Joudy Ju - Acústico (2013) || Full Unplugged ||")).toBe("live_concert");
    expect(audiovisualKind(null, "Various Artists - Fabricado Acá (2001)")).toBeNull();
    expect(planUpload({ videoId: "untyped0001", title: "Various Artists - Fabricado Acá (2001)", durationSeconds: 4000,
      publicationStatus: "published", tracklist: [] }, { artistsByKey: new Map(), albumsOf: () => [] }).action).toBe("review");
  });
});
