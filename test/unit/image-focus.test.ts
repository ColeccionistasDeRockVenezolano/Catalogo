import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearImageFocusCache, imageFocus, localMediaFile, type ImageFocus } from "../../src/storage/image-focus.js";
import { focusPosition } from "../../web/src/lib/useFaceFocus.js";

const face: ImageFocus = { x: 0.51, y: 0.3, width: 0.27, height: 0.4 };

describe("encuadre de fotos por rostros", () => {
  let root: string;
  beforeEach(async () => {
    clearImageFocusCache();
    root = await mkdtemp(path.join(tmpdir(), "crv-focus-"));
    await writeFile(path.join(root, "a.jpg"), "a");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("resuelve solo rutas locales dentro de los medios", () => {
    expect(localMediaFile("/crv/media/artist/1.jpg", root)).toBe(path.join(root, "artist/1.jpg"));
    expect(localMediaFile("/media/artist/1.jpg?w=320", root)).toBe(path.join(root, "artist/1.jpg"));
    expect(localMediaFile("/crv/media/../secreto.txt", root)).toBeNull();
    expect(localMediaFile("https://example.com/a.jpg", root)).toBeNull();
  });

  it("calcula una vez por versión del archivo", async () => {
    const detect = vi.fn(async (files: string[]) => new Map(files.map(file => [file, face] as const)));
    const url = "/crv/media/a.jpg";
    expect((await imageFocus([url, null, "https://x/y.jpg"], { mediaRoot: root, detect })).get(url)).toEqual(face);
    await imageFocus([url], { mediaRoot: root, detect });
    expect(detect).toHaveBeenCalledTimes(1);
    await utimes(path.join(root, "a.jpg"), new Date(), new Date(Date.now() + 5000));
    await imageFocus([url], { mediaRoot: root, detect });
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("no hace esperar a la portada si el detector tarda o falla", async () => {
    let finish: (value: Map<string, ImageFocus | null>) => void = () => undefined;
    const slow = () => new Promise<Map<string, ImageFocus | null>>((resolve) => { finish = resolve; });
    const url = "/crv/media/a.jpg";
    expect((await imageFocus([url], { mediaRoot: root, detect: slow, waitMs: 10 })).get(url)).toBeNull();
    finish(new Map([[path.join(root, "a.jpg"), face]]));
    expect((await imageFocus([url], { mediaRoot: root, detect: slow, waitMs: 10 })).get(url)).toEqual(face);

    clearImageFocusCache();
    const broken = vi.fn(async () => { throw new Error("sin python"); });
    expect((await imageFocus([url], { mediaRoot: root, detect: broken })).get(url)).toBeNull();
    await imageFocus([url], { mediaRoot: root, detect: broken });
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("lleva el rostro al punto pedido sin dejar bordes vacíos", () => {
    // Foto apaisada de 400×294 en una franja alta de 230×600 (portada en el teléfono).
    const [x, y] = focusPosition({ width: 230, height: 600 }, { width: 400, height: 294 }, face, { x: 0.66, y: 0.3 })
      .split(" ").map(value => Number.parseFloat(value));
    const scale = 600 / 294;
    const left = x! + face.x * 400 * scale;
    const right = x! + (face.x + face.width) * 400 * scale;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(230);
    expect(y).toBe(0);
    // Rostro pequeño cerca del borde (204×180 en 203×583): queda entero aunque el destino lo empuje fuera.
    const small = { x: 0.29, y: 0.1, width: 0.13, height: 0.2 };
    const offset = Number.parseFloat(focusPosition({ width: 203, height: 583 }, { width: 204, height: 180 }, small, { x: 0.95, y: 0.3 }));
    const scaled = 204 * (583 / 180);
    expect(offset + small.x * scaled).toBeGreaterThanOrEqual(0);
    expect(offset + (small.x + small.width) * scaled).toBeCloseTo(203, 0);
    // Un rostro en el borde no arrastra la imagen fuera del recuadro.
    expect(focusPosition({ width: 200, height: 200 }, { width: 400, height: 200 }, { x: 0.95, y: 0.1, width: 0.05, height: 0.2 }, { x: 0.5, y: 0.4 }))
      .toBe("-200px 0px");
  });
});
