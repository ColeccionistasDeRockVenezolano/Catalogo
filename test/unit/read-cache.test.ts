import { describe, expect, it } from "vitest";
import { ReadCache } from "../../src/shared/read-cache.js";

describe("ReadCache", () => {
  it("comparte cargas pendientes y cuenta el TTL desde su finalización", async () => {
    let now = 0, calls = 0;
    const cache = new ReadCache<number>(2, () => now);
    let finish!: (value: number) => void;
    const first = cache.get("a", 60, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const second = cache.get("a", 60, async () => 99);
    await Promise.resolve(); now = 1000;
    expect(cache.has("a")).toBe(true);
    expect(calls).toBe(1);
    finish(4); expect(await first).toBe(4); expect(await second).toBe(4);
    now = 1059; expect(cache.has("a")).toBe(true);
    now = 1060; expect(cache.has("a")).toBe(false);
    expect(await cache.get("a", 60, async () => 5)).toBe(5);
  });

  it("no conserva fallos ni repone una carga invalidada mientras estaba pendiente", async () => {
    const cache = new ReadCache<number>();
    await expect(cache.get("a", 60, async () => { throw new Error("temporal"); })).rejects.toThrow("temporal");
    expect(cache.has("a")).toBe(false);
    let finish!: (value: number) => void;
    const pending = cache.get("a", 60, () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve(); cache.clear();
    expect(await cache.get("a", 60, async () => 8)).toBe(8);
    finish(2); await pending;
    expect(await cache.get("a", 60, async () => 9)).toBe(8);
  });

  it("acota el número de entradas", async () => {
    const cache = new ReadCache<number>(2);
    await cache.get("a", 60, async () => 1);
    await cache.get("b", 60, async () => 2);
    await cache.get("c", 60, async () => 3);
    expect(cache.has("a")).toBe(false);
  });
});
