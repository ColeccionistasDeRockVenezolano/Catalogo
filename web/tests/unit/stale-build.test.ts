import { afterEach, expect, it, vi } from "vitest";
import { isChunkLoadError, reloadForNewBuild } from "../../src/lib/staleBuild";

afterEach(() => { vi.unstubAllGlobals(); });

it("Vite delega en el coordinador sin iniciar una segunda recarga", () => {
  const reload = vi.fn();
  const coordinate = vi.fn(() => true);
  vi.stubGlobal("window", { location: { reload }, CRVRequestBuildReload: coordinate });
  expect(reloadForNewBuild()).toBe(true);
  expect(coordinate).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
});

it("respeta el límite del coordinador en lugar de forzar otra recarga", () => {
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload }, CRVRequestBuildReload: () => false });
  expect(reloadForNewBuild()).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

it("conserva la recuperación anterior cuando el HTML no tiene coordinador", () => {
  const reload = vi.fn();
  const values = new Map<string, string>();
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
  expect(reloadForNewBuild()).toBe(true);
  expect(reloadForNewBuild()).toBe(false);
  expect(reload).toHaveBeenCalledOnce();
});

it("reconoce fallos de módulos de Safari, Firefox y Chromium", () => {
  for (const message of ["Importing a module script failed", "error loading dynamically imported module", "Failed to fetch dynamically imported module", "Unable to preload CSS"]) {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  }
  expect(isChunkLoadError(new Error("Error de validación"))).toBe(false);
});
