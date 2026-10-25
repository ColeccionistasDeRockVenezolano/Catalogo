import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { classifyImageUse, fingerprintDistance, groupVariants, inspectImage, principalUse } from "../../src/verification/image-quality.js";

/** Large shapes (stable fingerprint) plus fine lines (real detail). */
function poster(size: number, hue: number): Buffer {
  const lines = Array.from({ length: Math.round(size / 6) }, (_, i) => `<line x1="${i * 6}" y1="0" x2="${i * 6 + 40}" y2="${size}" stroke="#${i % 2 ? "222" : "ddd"}" stroke-width="2"/>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="hsl(${hue},60%,50%)"/>${lines}<circle cx="${size * 0.3}" cy="${size * 0.35}" r="${size * 0.22}" fill="#111"/><rect x="${size * 0.55}" y="${size * 0.5}" width="${size * 0.35}" height="${size * 0.4}" fill="#fafafa"/></svg>`);
}
const render = (svg: Buffer) => sharp(svg).jpeg({ quality: 92 }).toBuffer();

describe("calidad e integridad de imágenes reales", () => {
  it("mide la resolución natural y reconoce una imagen nítida de alta calidad", async () => {
    const result = await inspectImage(await render(poster(1400, 20)));
    expect(result).toMatchObject({ ok: true, format: "jpeg", width: 1400, height: 1400, upscaled: false, quality: "high" });
    expect(result.effectiveWidth).toBeGreaterThan(700);
  });
  it("no presenta como alta calidad una miniatura ampliada ni una foto desenfocada", async () => {
    const thumb = await sharp(await render(poster(240, 20))).resize(1400, 1400).jpeg({ quality: 92 }).toBuffer();
    const enlarged = await inspectImage(thumb);
    expect(enlarged.width).toBe(1400);
    expect(enlarged.upscaled).toBe(true);
    expect(enlarged.quality).toBe("low");
    expect(enlarged.reasons[0]).toMatch(/^Ampliada/u);
    const blurred = await inspectImage(await sharp(await render(poster(1400, 20))).blur(12).jpeg().toBuffer());
    expect(blurred.quality).not.toBe("high");
  });
  it("marca como fallida una descarga vacía, truncada o que no es imagen", async () => {
    const full = await render(poster(800, 20));
    for (const bytes of [Buffer.alloc(0), full.subarray(0, Math.round(full.length / 2)), Buffer.from("<html>403</html>")]) {
      const result = await inspectImage(bytes);
      expect(result.ok).toBe(false);
      expect(result.quality).toBe("failed");
    }
  });
  it("agrupa variantes de la misma imagen y deja la mejor primero", async () => {
    const original = await render(poster(1400, 20));
    const variants = [
      { name: "miniatura", bytes: await sharp(original).resize(300).jpeg({ quality: 70 }).toBuffer() },
      { name: "original", bytes: original },
      { name: "recomprimida", bytes: await sharp(original).resize(900).jpeg({ quality: 55 }).toBuffer() },
      { name: "otra", bytes: await render(poster(1400, 200)).then((b) => sharp(b).flop().toBuffer()) },
      { name: "rota", bytes: Buffer.from("no") },
    ];
    const inspected = await Promise.all(variants.map(async (v) => ({ ...v, inspection: await inspectImage(v.bytes) })));
    expect(fingerprintDistance(inspected[0]!.inspection.fingerprint!, inspected[1]!.inspection.fingerprint!)).toBeLessThanOrEqual(10);
    const groups = groupVariants(inspected).map((g) => g.map((v) => v.name));
    expect(groups).toContainEqual(["original", "recomprimida", "miniatura"]);
    expect(groups).toContainEqual(["otra"]);
    expect(groups).toContainEqual(["rota"]);
  });
});

describe("uso de la imagen según su contexto documentado", () => {
  const cases: Array<[Parameters<typeof classifyImageUse>[0], string]> = [
    [{ url: "https://x.com/a.jpg", context: "Imagen: Portada de En Vivo", target: "album", width: 600, height: 600 }, "cover"],
    [{ url: "https://x.com/a.jpg", context: "Contraportada del LP", target: "album", width: 600, height: 600 }, "back_cover"],
    [{ url: "https://x.com/afiche.jpg", context: "Festival 1994", target: "artist", width: 600, height: 900 }, "poster"],
    [{ url: "https://x.com/b.jpg", context: "La banda en concierto en el Poliedro", target: "artist", width: 1200, height: 800 }, "live"],
    [{ url: "https://x.com/c.jpg", context: "Foto promocional de la banda", target: "artist", width: 1200, height: 800 }, "group"],
    [{ url: "https://x.com/people/d.jpg", context: "", target: "person", width: 500, height: 700 }, "portrait"],
    [{ url: "https://x.com/e.jpg", context: "", target: "album", width: 1000, height: 1000 }, "cover"],
    [{ url: "https://x.com/logo.png", context: "", target: "artist", width: 400, height: 400, decorative: true }, "irrelevant"],
    [{ url: "https://x.com/f.jpg", context: "", target: "artist", width: 1500, height: 300 }, "irrelevant"],
    [{ url: "https://x.com/g.jpg", context: "", target: "artist", width: 800, height: 800 }, "unknown"],
  ];
  it.each(cases)("%# clasifica el uso", (input, use) => expect(classifyImageUse(input).use).toBe(use));
  it("solo una portada encabeza un disco y solo un retrato o foto de grupo una ficha de artista", () => {
    expect(principalUse("album", "cover")).toBe(true);
    expect(principalUse("album", "back_cover")).toBe(false);
    expect(principalUse("artist", "cover")).toBe(false);
    expect(principalUse("artist", "group")).toBe(true);
  });
});
