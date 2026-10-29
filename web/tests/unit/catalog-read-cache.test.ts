import { afterEach, describe, expect, it } from "vitest";
import { cachedCatalogRead, canCacheCatalogRead, clearCatalogReadCache, observeCatalogRevision } from "../../src/lib/catalogReadCache";

afterEach(clearCatalogReadCache);
describe("caché de lecturas del navegador", () => {
  it("reutiliza lecturas al navegar y conserva cada combinación de filtros", async () => {
    let calls = 0;
    const load = async () => ++calls;
    expect(await cachedCatalogRead(new URL("http://local/albums?tipo=ep&tipo=remix"), load)).toBe(1);
    expect(await cachedCatalogRead(new URL("http://local/albums?tipo=ep&tipo=remix"), load)).toBe(1);
    expect(await cachedCatalogRead(new URL("http://local/albums?tipo=ep"), load)).toBe(2);
    clearCatalogReadCache();
    expect(await cachedCatalogRead(new URL("http://local/albums?tipo=ep"), load)).toBe(3);
  });

  it("una cancelación no interrumpe a otro consumidor de la misma carga", async () => {
    const first = new AbortController();
    let finish!: (value: number) => void;
    const url = new URL("http://local/persons/facets");
    const load = (signal: AbortSignal) => new Promise<number>((resolve, reject) => {
      finish = resolve; signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const one = cachedCatalogRead(url, load, first.signal);
    const two = cachedCatalogRead(url, load);
    await Promise.resolve();
    first.abort(); await expect(one).rejects.toBeDefined();
    finish(7); expect(await two).toBe(7);
    expect(await cachedCatalogRead(url, async () => 8)).toBe(7);
  });

  it("cancelar todos los consumidores libera la carga para un reintento", async () => {
    const controller = new AbortController();
    const url = new URL("http://local/catalog/overview");
    const pending = cachedCatalogRead(url, signal => new Promise<number>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }), controller.signal);
    await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(await cachedCatalogRead(url, async () => 9)).toBe(9);
  });

  it("invalida al cambiar la versión y exige fecha para selecciones diarias", async () => {
    observeCatalogRevision("before");
    const url = new URL("http://local/albums/1");
    await cachedCatalogRead(url, async () => 1);
    expect(observeCatalogRevision("after")).toBe(true);
    expect(await cachedCatalogRead(url, async () => 2)).toBe(2);
    expect(canCacheCatalogRead("/home")).toBe(false);
    expect(canCacheCatalogRead("/home", { date: "2026-10-22" })).toBe(true);
    expect(canCacheCatalogRead("/daily-cycle")).toBe(false);
    expect(canCacheCatalogRead("/curation/findings")).toBe(false);
    expect(canCacheCatalogRead("/artists/1", { date: "2026-10-22" })).toBe(false);
    expect(canCacheCatalogRead("/albums/1")).toBe(false);
  });
});
