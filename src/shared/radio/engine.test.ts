import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeListenerCountry, radioSnapshot, reportRadioUnavailable, resetRadioEngineForTests, setRadioCheckerForTests, slotSeconds, sweepRadioForTests, inspectCatalog, type RadioStation } from "./engine.js";

const stations: RadioStation[] = [];
type ItemPatch = (index: number) => Record<string, unknown>;
function fixture(patch: ItemPatch = () => ({}), catalog: Record<string, unknown> = {}): RadioStation {
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
    ...patch(index),
  }));
  const file = path.join(dir, "catalog.json");
  fs.writeFileSync(file, JSON.stringify({
    version: 3, generatedAt: "2026-01-01T00:00:00Z", availabilityCheckedAt: "2026-01-01T00:00:00Z",
    channelId: "UC0000000000000000000000", items, ...catalog,
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

  it("cubre un veto por país con un relleno del mismo tramo, sin mover la emisión", () => {
    const station = fixture();
    const scheduled = radioSnapshot(station, station.epochMs)!.current.videoId;
    const vetoed = fixture((index) => (`vid0000000${index + 1}` === scheduled ? { regionRestriction: { blocked: ["US"] } } : {}));
    const general = radioSnapshot(vetoed, vetoed.epochMs)!;
    expect(general.current.videoId).toBe(scheduled);
    const us = radioSnapshot(vetoed, vetoed.epochMs, 0, { country: "us" })!;
    expect(us.current.videoId).not.toBe(scheduled);
    expect(us.current.regionSubstituteFor?.videoId).toBe(scheduled);
    expect(us.current.durationSeconds).toBe(general.current.durationSeconds);
    expect([us.queueId, us.startsAt, us.endsAt]).toEqual([general.queueId, general.startsAt, general.endsAt]);
    // Mismo país, mismo tramo, mismo relleno; otro país sin veto oye lo programado.
    expect(radioSnapshot(vetoed, vetoed.epochMs + 5000, 0, { country: "US" })!.current.videoId).toBe(us.current.videoId);
    expect(radioSnapshot(vetoed, vetoed.epochMs, 0, { country: "CO" })!.current.videoId).toBe(scheduled);
    // Sin país real no hay relleno.
    expect(normalizeListenerCountry("XX")).toBeNull();
    expect(normalizeListenerCountry("T1")).toBeNull();
    expect(radioSnapshot(vetoed, vetoed.epochMs, 0, { country: "XX" })!.current.videoId).toBe(scheduled);
  });

  it("saca para todos lo vetado en el país base y lo informa", () => {
    const station = fixture((index) => (index === 3 ? { regionRestriction: { blocked: ["VE"] } } : index === 4 ? { regionRestriction: { blocked: ["RU"] } } : {}), {
      regionPolicy: { homeRegions: ["VE"], worldwideRegions: 100 },
    });
    expect(inspectCatalog(station)).toMatchObject({
      items: 7, regionExcluded: 1, regionRestricted: 1, regionRestrictedCountries: [{ country: "RU", items: 1 }],
    });
  });

  it("un catálogo nuevo no corta la pieza en curso", () => {
    const station = fixture();
    const at = station.epochMs + 20_000;
    const before = radioSnapshot(station, at)!;
    const raw = JSON.parse(fs.readFileSync(station.catalogPath, "utf8")) as { items: Array<{ videoId: string }> };
    raw.items = raw.items.filter((item) => item.videoId !== before.next.videoId);
    fs.writeFileSync(station.catalogPath, JSON.stringify(raw));
    fs.utimesSync(station.catalogPath, new Date(), new Date(Date.now() + 5000));
    const during = radioSnapshot(station, at + 1000)!;
    expect(during.catalogVersion).toBe(before.catalogVersion);
    expect(during.current.videoId).toBe(before.current.videoId);
    const after = radioSnapshot(station, Date.parse(before.endsAt) + 1000)!;
    expect(after.catalogVersion).not.toBe(before.catalogVersion);
    expect(after.total).toBe(7);
  });

  it("sin ser dueña sigue las exclusiones ajenas, no consulta a nadie ni escribe", async () => {
    const station = fixture();
    const first = radioSnapshot(station, station.epochMs)!;
    const exclusions = `${station.catalogPath}.unavailable.json`;
    setRadioCheckerForTests(async () => "unavailable");
    expect(await reportRadioUnavailable(station, first.current.videoId, station.epochMs)).toMatchObject({ excluded: false });
    expect(fs.existsSync(exclusions)).toBe(false);
    fs.writeFileSync(exclusions, JSON.stringify({ version: 1, videos: { [first.current.videoId]: { since: "2026-01-01T00:00:00Z" } } }));
    fs.utimesSync(exclusions, new Date(), new Date(Date.now() + 5000));
    const next = radioSnapshot(station, station.epochMs)!;
    expect(next.total).toBe(7);
    expect(next.current.videoId).not.toBe(first.current.videoId);
    expect(inspectCatalog(station).excluded).toBe(1);
  });

  it("la dueña verifica los avisos, guarda en su carpeta y no toca la del catálogo", async () => {
    const base = fixture();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crv-radio-state-"));
    const station: RadioStation = { ...base, owner: true, statePath: path.join(stateDir, "catalog.json") };
    const verdicts = new Map<string, "available" | "unavailable" | "unknown">();
    setRadioCheckerForTests(async (videoId) => verdicts.get(videoId) ?? "available");
    const onAir = radioSnapshot(station, station.epochMs)!;
    const videoId = onAir.current.videoId;
    // Lo que no está al aire no se puede denunciar.
    expect(await reportRadioUnavailable(station, "zzzzzzzzzzz", station.epochMs)).toBeNull();
    // Inconcluso: no retira nada.
    verdicts.set(videoId, "unknown");
    expect(await reportRadioUnavailable(station, videoId, station.epochMs)).toMatchObject({ excluded: false });
    expect(radioSnapshot(station, station.epochMs)!.total).toBe(8);
    // Durante el enfriamiento vale el último veredicto: no hay ráfaga a YouTube.
    verdicts.set(videoId, "unavailable");
    expect(await reportRadioUnavailable(station, videoId, station.epochMs + 1000)).toMatchObject({ excluded: false });
    // Confirmado: sale al momento, aunque esté sonando, y solo se escribe en su carpeta.
    setRadioCheckerForTests(async () => "unavailable");
    expect(await reportRadioUnavailable(station, videoId, station.epochMs)).toMatchObject({ excluded: true });
    const saved = JSON.parse(fs.readFileSync(`${station.statePath!}.unavailable.json`, "utf8")) as { videos: Record<string, unknown> };
    expect(Object.keys(saved.videos)).toEqual([videoId]);
    expect(fs.existsSync(`${station.catalogPath}.unavailable.json`)).toBe(false);
    const without = radioSnapshot(station, station.epochMs)!;
    expect(without.total).toBe(7);
    expect(without.current.videoId).not.toBe(videoId);
    // Sobrevive a un reinicio.
    resetRadioEngineForTests();
    setRadioCheckerForTests(async () => "available");
    expect(radioSnapshot(station, station.epochMs)!.total).toBe(7);
    // Vuelve cuando el barrido lo encuentra; la pieza en curso termina antes.
    await sweepRadioForTests(station);
    const during = radioSnapshot(station, station.epochMs)!;
    expect(during.total).toBe(7);
    expect(radioSnapshot(station, Date.parse(during.endsAt) + 1000)!.total).toBe(8);
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("un barrido que tumba media emisión describe a YouTube, no al catálogo", async () => {
    const base = fixture();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crv-radio-state-"));
    const station: RadioStation = { ...base, owner: true, statePath: path.join(stateDir, "catalog.json") };
    setRadioCheckerForTests(async (videoId) => (videoId.endsWith("8") ? "available" : "unavailable"));
    radioSnapshot(station, station.epochMs);
    await sweepRadioForTests(station);
    // Con 8 videos el umbral es 5: 7 caídos no se aplican.
    expect(radioSnapshot(station, station.epochMs)!.total).toBe(8);
    fs.rmSync(stateDir, { recursive: true, force: true });
  });
});
