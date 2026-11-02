import { beforeEach, describe, expect, it } from "vitest";
import { liveRadioSnapshot, resetLiveRadioCacheForTests } from "./radio-card.js";

const URL = "http://127.0.0.1:3020/api/radio/now";
const snapshot = { queueId: "q:1", phase: "music", offsetSeconds: 10, upcoming: [], current: { videoId: "abc", durationSeconds: 200 } };
const answer = (body: unknown, ok = true) => async () => ({ ok, json: async () => body });

describe("tarjeta de radio de la portada", () => {
  beforeEach(() => { resetLiveRadioCacheForTests(); });

  it("sin URL no consulta nada", async () => {
    let calls = 0;
    expect(await liveRadioSnapshot(undefined, async () => { calls += 1; return { ok: true, json: async () => snapshot }; })).toBeNull();
    expect(calls).toBe(0);
  });

  it("devuelve lo que emite Herra", async () => {
    expect(await liveRadioSnapshot(URL, answer(snapshot))).toEqual(snapshot);
  });

  it("recurre al motor propio si Herra falla, responde mal o tarda", async () => {
    expect(await liveRadioSnapshot(URL, answer(snapshot, false))).toBeNull();
    expect(await liveRadioSnapshot(URL, answer({ error: "x" }))).toBeNull();
    expect(await liveRadioSnapshot(URL, async () => { throw new Error("timeout"); })).toBeNull();
  });

  it("guarda la respuesta unos segundos y luego vuelve a preguntar", async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return { ok: true, json: async () => snapshot }; };
    await liveRadioSnapshot(URL, fetcher, 1_000);
    await liveRadioSnapshot(URL, fetcher, 3_000);
    expect(calls).toBe(1);
    await liveRadioSnapshot(URL, fetcher, 5_000);
    expect(calls).toBe(2);
  });
});
