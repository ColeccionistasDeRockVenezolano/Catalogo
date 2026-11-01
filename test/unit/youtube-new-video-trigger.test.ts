import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../src/db/client.js", () => ({ getPool: () => ({ query }) }));

const { resetNewVideoTrigger, triggerNewChannelVideos } = await import("../../src/youtube/new-video-trigger.js");

const MINUTE = 60_000;

describe("video nuevo del canal → alta inmediata", () => {
  beforeEach(() => {
    resetNewVideoTrigger();
    query.mockReset();
    query.mockResolvedValue({ rows: [{ video_id: "aaaaaaaaaaa" }] });
  });

  it("lanza solo los videos que el catálogo no tiene", async () => {
    const launcher = vi.fn(async () => undefined);
    const launched = await triggerNewChannelVideos(["aaaaaaaaaaa", "bbbbbbbbbbb"], { enabled: true, launcher, now: 100 * MINUTE });
    expect(launched).toEqual(["bbbbbbbbbbb"]);
    expect(launcher).toHaveBeenCalledWith(["bbbbbbbbbbb"]);
  });

  it("no hace nada apagado ni cuando todo es conocido", async () => {
    const launcher = vi.fn(async () => undefined);
    expect(await triggerNewChannelVideos(["bbbbbbbbbbb"], { enabled: false, launcher, now: 100 * MINUTE })).toEqual([]);
    expect(await triggerNewChannelVideos(["aaaaaaaaaaa"], { enabled: true, launcher, now: 100 * MINUTE })).toEqual([]);
    expect(launcher).not.toHaveBeenCalled();
  });

  it("no relanza el mismo video ni lanza dos veces dentro del intervalo", async () => {
    const launcher = vi.fn(async () => undefined);
    await triggerNewChannelVideos(["bbbbbbbbbbb"], { enabled: true, launcher, now: 100 * MINUTE });
    expect(await triggerNewChannelVideos(["ccccccccccc"], { enabled: true, launcher, now: 105 * MINUTE })).toEqual([]);
    expect(await triggerNewChannelVideos(["bbbbbbbbbbb"], { enabled: true, launcher, now: 120 * MINUTE })).toEqual([]);
    expect(await triggerNewChannelVideos(["bbbbbbbbbbb", "ccccccccccc"], { enabled: true, launcher, now: 140 * MINUTE })).toEqual(["ccccccccccc"]);
    expect(launcher).toHaveBeenCalledTimes(2);
  });

  it("si la unidad está ocupada, el video se reintenta en la siguiente ventana", async () => {
    const launcher = vi.fn().mockRejectedValueOnce(new Error("Unit crv-youtube-nuevo.service already exists.")).mockResolvedValue(undefined);
    expect(await triggerNewChannelVideos(["bbbbbbbbbbb"], { enabled: true, launcher, now: 100 * MINUTE })).toEqual(["bbbbbbbbbbb"]);
    expect(await triggerNewChannelVideos(["bbbbbbbbbbb"], { enabled: true, launcher, now: 111 * MINUTE })).toEqual(["bbbbbbbbbbb"]);
    expect(launcher).toHaveBeenCalledTimes(2);
  });
});
