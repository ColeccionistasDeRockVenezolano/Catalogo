import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RadioInsertError, cancelRadioInsert, listRadioInserts, queueRadioInsert, radioSnapshot, resetRadioEngineForTests,
  setRadioCheckerForTests, type RadioSnapshot, type RadioStation,
} from "./engine.js";

const dirs: string[] = [];
beforeEach(() => setRadioCheckerForTests(async () => "available"));
afterEach(() => { resetRadioEngineForTests(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function station(withSweeper = false, owner = true): RadioStation {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crv-radio-ins-")); dirs.push(dir);
  const items = Array.from({ length: 10 }, (_, index) => ({
    videoId: `vid000000${String(index).padStart(2, "0")}`, title: `Tema ${index}`, artist: `Artista ${index}`, album: "Disco", year: 2000,
    trackNumber: index + 1, startSeconds: 0, durationSeconds: 100 + index * 10, available: true,
  }));
  const catalogPath = path.join(dir, "catalog.json");
  fs.writeFileSync(catalogPath, JSON.stringify({ version: 3, generatedAt: "2026-01-01T00:00:00Z", availabilityCheckedAt: "2026-01-01T00:00:00Z", channelId: "UC0000000000000000000000", items }));
  return {
    catalogPath, epochMs: Date.parse("2026-01-01T00:00:00Z"), stationName: "Prueba", crossfadeSeconds: 2,
    ...(withSweeper ? { sweeper: { src: "radio/sweeper-v2.wav", durationSeconds: 10, leadSeconds: 2, overlapSeconds: 2, everyPieces: 3 } } : {}),
    ...(owner ? { owner: true, statePath: path.join(dir, "estado.json") } : {}),
  };
}

/** Las piezas que suenan, una por tramo, durante `count` tramos desde `fromMs`. */
function aired(radio: RadioStation, fromMs: number, count: number): Array<{ key: string; queueId: string; startsAt: number; snapshot: RadioSnapshot }> {
  const out: Array<{ key: string; queueId: string; startsAt: number; snapshot: RadioSnapshot }> = [];
  let t = fromMs;
  while (out.length < count) {
    const snapshot = radioSnapshot(radio, t)!;
    if (snapshot.phase === "music" && out.at(-1)?.queueId !== snapshot.queueId) {
      out.push({ key: snapshot.current.videoId, queueId: snapshot.queueId, startsAt: Date.parse(snapshot.startsAt), snapshot });
    }
    t = Date.parse(snapshot.endsAt) + 1;
  }
  return out;
}

describe("piezas puestas a mano", () => {
  for (const withSweeper of [false, true]) {
    it(`suena al acabar el tramo y la emisión sigue donde iba (${withSweeper ? "con" : "sin"} cuña)`, () => {
      const radio = station(withSweeper);
      const now = radio.epochMs + 3 * 3600_000 + 20_000;
      const before = aired(radio, now, 8);
      const target = before[5]!.snapshot.current; // una pieza que vendría más tarde
      const insert = queueRadioInsert(radio, { videoId: target.videoId, startSeconds: 0 }, { nowMs: now, requestedBy: "brian" });

      const snap = radioSnapshot(radio, now)!;
      expect(snap.current.videoId).toBe(before[0]!.key);
      expect(snap.next.videoId).toBe(target.videoId);
      expect(snap.upcoming[0]!.videoId).toBe(target.videoId);

      const after = aired(radio, now, 8);
      expect(after[0]!.key).toBe(before[0]!.key);
      // La puesta entra justo al final del tramo de la que sonaba (cuña incluida).
      expect(after[1]!.queueId).toBe(`ins:${insert.id}:music`);
      expect(after[1]!.startsAt).toBe(Date.parse(insert.startsAt));
      expect(after[1]!.startsAt).toBe(before[1]!.startsAt);
      expect(after[1]!.key).toBe(target.videoId);
      // Y luego exactamente la misma secuencia y los mismos queueId, solo que más tarde.
      expect(after.slice(2).map((entry) => entry.queueId)).toEqual(before.slice(1, 7).map((entry) => entry.queueId));
      const slotMs = Date.parse(insert.endsAt) - Date.parse(insert.startsAt);
      after.slice(2).forEach((entry, index) => expect(entry.startsAt).toBeCloseTo(before[index + 1]!.startsAt + slotMs, 0));
      // Mientras suena, la siguiente es la que tocaba.
      const during = radioSnapshot(radio, Date.parse(insert.startsAt) + 5_000)!;
      expect(during.current.videoId).toBe(target.videoId);
      expect(during.next.videoId).toBe(before[1]!.key);
      expect(during.offsetSeconds).toBe(5);
      expect(listRadioInserts(radio, Date.parse(insert.startsAt) + 5_000)[0]!.status).toBe("playing");
    });
  }

  it("varias puestas van en fila y cancelar una adelanta las de detrás", () => {
    const radio = station(true);
    const now = radio.epochMs + 5 * 3600_000;
    const before = aired(radio, now, 4);
    const a = queueRadioInsert(radio, { videoId: "vid00000003", startSeconds: 0 }, { nowMs: now });
    const b = queueRadioInsert(radio, { videoId: "vid00000007", startSeconds: 0 }, { nowMs: now });
    expect(b.startsAt).toBe(a.endsAt);
    let air = aired(radio, now, 4);
    expect(air.map((entry) => entry.queueId).slice(1, 3)).toEqual([`ins:${a.id}:music`, `ins:${b.id}:music`]);
    expect(air[3]!.queueId).toBe(before[1]!.queueId);

    cancelRadioInsert(radio, a.id, { nowMs: now });
    air = aired(radio, now, 3);
    expect(air[1]!.queueId).toBe(`ins:${b.id}:music`);
    expect(air[1]!.startsAt).toBe(Date.parse(a.startsAt));
    expect(air[2]!.queueId).toBe(before[1]!.queueId);
  });

  it("se conserva tras reiniciar el motor y no deja cortes en la programación", () => {
    const radio = station(true);
    const now = radio.epochMs + 7 * 3600_000;
    const insert = queueRadioInsert(radio, { videoId: "vid00000002", startSeconds: 0 }, { nowMs: now });
    resetRadioEngineForTests();
    setRadioCheckerForTests(async () => "available");
    const during = radioSnapshot(radio, Date.parse(insert.startsAt) + 1000)!;
    expect(during.queueId).toBe(`ins:${insert.id}:music`);
    // Recorrido continuo de un día: cada tramo empieza donde terminó el anterior.
    let t = now; let previousEnd: number | null = null;
    for (let index = 0; index < 400; index += 1) {
      const snapshot = radioSnapshot(radio, t)!;
      const start = Date.parse(snapshot.startsAt);
      if (previousEnd !== null) expect(Math.abs(start - previousEnd)).toBeLessThan(2);
      previousEnd = Date.parse(snapshot.endsAt);
      t = previousEnd + 1;
    }
  });

  it("con el tramo a punto de acabar, espera al siguiente", () => {
    const radio = station(false);
    const first = radioSnapshot(radio, radio.epochMs + 3600_000)!;
    const almost = Date.parse(first.endsAt) - 5_000;
    const near = radioSnapshot(radio, almost)!;
    const avoid = new Set([near.current.videoId, ...near.upcoming.slice(0, 3).map((item) => item.videoId)]);
    const pick = Array.from({ length: 10 }, (_, index) => `vid000000${String(index).padStart(2, "0")}`).find((id) => !avoid.has(id))!;
    const insert = queueRadioInsert(radio, { videoId: pick, startSeconds: 0 }, { nowMs: almost });
    expect(Date.parse(insert.startsAt) - almost).toBeGreaterThanOrEqual(15_000);
    const snap = radioSnapshot(radio, almost)!;
    expect(snap.next.videoId).not.toBe(pick);
    expect(snap.upcoming[1]!.videoId).toBe(pick);
  });

  it("solo el dueño pone piezas y solo del catálogo", () => {
    expect(() => queueRadioInsert(station(false, false), { videoId: "vid00000001", startSeconds: 0 })).toThrow(RadioInsertError);
    expect(() => queueRadioInsert(station(), { videoId: "noexiste000", startSeconds: 0 })).toThrow(/catálogo/u);
  });
});

describe("piezas puestas: repeticiones", () => {
  it("no deja poner la misma pieza pegada a sí misma", () => {
    const radio = station(false);
    const now = radio.epochMs + 2 * 3600_000;
    const snap = radioSnapshot(radio, now)!;
    expect(() => queueRadioInsert(radio, { videoId: snap.current.videoId, startSeconds: 0 }, { nowMs: now })).toThrow(/justo/u);
    expect(() => queueRadioInsert(radio, { videoId: snap.next.videoId, startSeconds: 0 }, { nowMs: now })).toThrow(/justo/u);
  });
});
