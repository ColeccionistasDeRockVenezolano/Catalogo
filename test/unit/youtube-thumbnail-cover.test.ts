import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropTemplateCover, labelKey } from "../../src/youtube/thumbnail-cover.js";

/** Ruido determinista: cada píxel cambia mucho respecto a sus vecinos (imagen «nítida»). */
function noise(width: number, height: number, seed = 7): Buffer {
  const out = Buffer.alloc(width * height * 3);
  let state = seed;
  for (let i = 0; i < out.length; i++) { state = (state * 1103515245 + 12345) & 0x7fffffff; out[i] = state >> 23; }
  return out;
}
const raw = (width: number, height: number, data: Buffer) => sharp(data, { raw: { width, height, channels: 3 } });

async function thumbnail(template: boolean): Promise<Buffer> {
  const background = template ? await raw(1280, 720, noise(1280, 720)).blur(12).png().toBuffer() : await raw(1280, 720, noise(1280, 720)).png().toBuffer();
  const cover = await raw(489, 490, noise(489, 490, 3)).png().toBuffer();
  return sharp(background).composite(template ? [{ input: cover, left: 64, top: 71 }] : []).jpeg({ quality: 90 }).toBuffer();
}

describe("portada desde la miniatura del canal", () => {
  it("recorta el recuadro fijo de la plantilla (489×490)", async () => {
    const crop = await cropTemplateCover(await thumbnail(true));
    expect("cover" in crop).toBe(true);
    if ("cover" in crop) expect(await sharp(crop.cover).metadata()).toMatchObject({ width: 489, height: 490 });
  });
  it("no recorta una miniatura a sangre", async () => {
    expect(await cropTemplateCover(await thumbnail(false))).toMatchObject({ reason: expect.stringContaining("a sangre") });
  });
  it("no recorta otra medida que 1280×720", async () => {
    const small = await raw(640, 480, noise(640, 480)).jpeg().toBuffer();
    expect(await cropTemplateCover(small)).toMatchObject({ reason: expect.stringContaining("640×480") });
  });
  it("normaliza el nombre del sello para buscarlo", () => {
    expect(labelKey("SONOGRAFICA")).toBe(labelKey("Sonográfica"));
    expect(labelKey("FNB Grabaciones C.A.")).toBe(labelKey("FNB Grabaciones C.A"));
  });
});
