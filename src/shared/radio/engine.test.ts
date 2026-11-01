import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { radioSnapshot, resetRadioEngineForTests, slotSeconds, inspectCatalog, type RadioStation } from "./engine.js";

const stations: RadioStation[] = [];
function fixture(): RadioStation {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crv-radio-"));
  const items = Array.from({ length: 8 }, (_, index) => ({
    videoId: `vid0000000${index + 1}`,
    title: `Tema ${index + 1}`,
    artist: `Artista ${index % 3}`,
    album: `Disco ${index + 1}`,
    year: 2000,
    trackNumber: index + 1,
    startSeconds: 0,
    durationSeconds: 100,
    available: true,
    genres: {
      primaryGenre: { slug: index % 2 === 0 ? "rock" : "pop", name: index % 2 === 0 ? "Rock" : "Pop", family: index % 2 === 0 ? "rock" : "pop" },
      secondaryGenres: [],
      families: [index % 2 === 0 ? "rock" : "pop"],
    },
  }));
  const file = path.join(dir, "catalog.json");
  fs.writeFileSync(file, JSON.stringify({
    version: 3, generatedAt: "2026-01-01T00:00:00Z", availabilityCheckedAt: "2026-01-01T00:00:00Z",
    channelId: "UC0000000000000000000000", items,
  }));
  const station: RadioStation = {
    catalogPath: file,
    epochMs: Date.parse("2026-01-01T00:00:00Z"),
    stationName: "Prueba",
    crossfadeSeconds: 2,
    sweeper: { src: "radio/sweeper-v2.wav", durationSeconds: 10, leadSeconds: 2, overlapSeconds: 2, everyPieces: 3 },
  };
  stations.push(station);
  return station;
}

afterEach(() => {
  resetRadioEngineForTests();
  for (const station of stations.splice(0)) fs.rmSync(path.dirname(station.catalogPath), { recursive: true, force: true });
});

describe("motor de radio", () => {
  it("lee el catálogo y calcula el tramo con cruce", () => {
    const station = fixture();
    expect(inspectCatalog(station)).toMatchObject({ items: 8, genres: 2, error: null });
    const first = radioSnapshot(station, station.epochMs);
    expect(first).not.toBeNull();
    expect(first!.total).toBe(8);
    expect(first!.position).toBe(1);
    expect(first!.phase).toBe("music");
    expect(first!.queueId).toContain(":0:0:music");
    expect(Date.parse(first!.endsAt) - Date.parse(first!.startsAt)).toBe(98_000);
    expect(first!.crossfadeSeconds).toBe(2);
  });

  it("es determinista para el mismo instante", () => {
    const station = fixture();
    const at = station.epochMs + 42_000;
    expect(radioSnapshot(station, at)).toEqual(radioSnapshot(station, at));
  });

  it("entra en la cuña al terminar el tramo que la lleva", () => {
    const station = fixture();
    let snapshot = radioSnapshot(station, station.epochMs)!;
    for (let guard = 0; guard < 8 && !snapshot.sweeperSlot; guard += 1) {
      snapshot = radioSnapshot(station, Date.parse(snapshot.endsAt))!;
    }
    expect(snapshot.sweeperSlot).toBe(true);
    const mediaEndsAt = Date.parse(snapshot.endsAt);
    const ident = radioSnapshot(station, mediaEndsAt)!;
    expect(ident.phase).toBe("sweeper");
    expect(ident.position).toBe(snapshot.position);
    expect(Date.parse(ident.endsAt) - mediaEndsAt).toBe(6_000);
  });

  it("el hueco de la cuña solo se suma a los tramos que la cierran", () => {
    const station = fixture();
    expect(slotSeconds(station, { durationSeconds: 100 }, 0)).toBe(98);
    expect(slotSeconds(station, { durationSeconds: 100 }, 2)).toBe(106);
  });

  it("sin catálogo válido no emite", () => {
    const station = fixture();
    fs.writeFileSync(station.catalogPath, "{}");
    expect(radioSnapshot(station, station.epochMs)).toBeNull();
  });
});
