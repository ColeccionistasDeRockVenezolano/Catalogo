import { describe, expect, it } from "vitest";
import { effectProductSchema } from "../../src/chat/effects-catalog.js";
import { angleVector, DEFAULT_NAME_STYLE, NAME_STYLE_FAMILIES, NAME_STYLE_REFERENCES, nameStyleBounds, nameStyleSchema } from "../../src/chat/name-style.js";

describe("estilos editables de nombres", () => {
  const manifest = { version: 1, triggers: ["always"], layers: [], cost: 2, nameStyle: DEFAULT_NAME_STYLE };
  it("admite un estilo de texto sin capas heredadas y conserva todos sus controles", () => {
    const result = effectProductSchema.parse({ kind: "name", manifest });
    expect(result.manifest.nameStyle).toEqual(DEFAULT_NAME_STYLE);
    expect(effectProductSchema.safeParse({ kind: "badge", manifest }).success).toBe(false);
    expect(effectProductSchema.safeParse({ kind: "name_font", manifest }).success).toBe(false);
  });
  it("conserva las diez familias de NickLab al validar y publicar", () => {
    expect(Object.keys(NAME_STYLE_FAMILIES)).toHaveLength(10);
    expect(DEFAULT_NAME_STYLE.gradientAngle).toBe(0);
    for (const family of Object.keys(NAME_STYLE_FAMILIES)) {
      const result = effectProductSchema.parse({ kind: "name", manifest: { ...manifest, nameStyle: { ...DEFAULT_NAME_STYLE, family } } });
      expect(result.manifest.nameStyle).toMatchObject({ family });
    }
  });
  it("reserva la huella rotada y espacio para sombras y movimiento", () => {
    const plain = { ...DEFAULT_NAME_STYLE, shadow: false, outlineWidth: 0, amplitude: 0 };
    expect(nameStyleBounds(100, 20, { ...plain, rotation: 90 })).toEqual({ width: 25, height: 104 });
    const diagonal = nameStyleBounds(100, 20, { ...plain, rotation: 45 });
    expect(diagonal.width).toBeGreaterThanOrEqual(89);
    expect(diagonal.height).toBeGreaterThanOrEqual(89);
    expect(nameStyleBounds(100, 20, DEFAULT_NAME_STYLE).height).toBeGreaterThan(nameStyleBounds(100, 20, plain).height);
  });
  it("conserva el humo editable sin agrandar los márgenes del nombre", () => {
    const ghost = NAME_STYLE_REFERENCES.find((item) => item.code === "ghost")!;
    const result = effectProductSchema.parse({ kind: "name", manifest: { ...manifest, nameStyle: ghost.style } });
    expect(result.manifest.nameStyle).toMatchObject({ animation: "smoke", smokeColor: "#9aa0aa", smokeCount: 7, smokeSize: 17, smokeSizeStep: 9, smokeBlur: 5, duration: 4, stagger: -0.6, smokeBottom: -77, smokeBlend: "screen" });
    const edited = nameStyleSchema.parse({ ...ghost.style, smokeColor: "#aabbcc", smokeCount: 12, smokeRise: 70 });
    expect(effectProductSchema.parse({ kind: "name", manifest: { ...manifest, nameStyle: edited } }).manifest.nameStyle).toEqual(edited);
    const bounds = nameStyleBounds(100, 26, edited);
    const plain = nameStyleBounds(100, 26, { ...edited, animation: "none" });
    expect(bounds).toEqual(plain);
    for (const rotation of [0, 45, 90, 270]) {
      const extreme = { ...edited, rotation, smokeCount: 20, smokeSize: 60, smokeSizeStep: 16, smokeBlur: 12, smokeRise: 100, smokeBottom: -100 };
      expect(nameStyleBounds(100, 26, extreme)).toEqual(nameStyleBounds(100, 26, { ...extreme, animation: "none" }));
    }
    for (const invalid of [{ smokeCount: 0 }, { smokeCount: 21 }, { smokeBlur: -1 }, { smokeOpacity: 2 }, { smokeRise: 101 }, { smokeBlend: "invalid" }]) {
      expect(nameStyleSchema.safeParse({ ...ghost.style, ...invalid }).success).toBe(false);
    }
  });
  it("orienta los vectores en los cuatro cuadrantes y permite el círculo completo", () => {
    expect(angleVector(90, 8).x).toBeCloseTo(8);
    expect(angleVector(180, 8).y).toBeCloseTo(8);
    expect(angleVector(270, 8).x).toBeCloseTo(-8);
    expect(angleVector(360, 8).y).toBeCloseTo(-8);
    for (const rotation of [0, 37, 90, 180, 271, 360]) expect(nameStyleSchema.safeParse({ rotation }).success).toBe(true);
    for (const value of [-1, 361, Infinity, NaN]) expect(nameStyleSchema.safeParse({ motionAngle: value }).success).toBe(false);
  });
  it("conserva las referencias solicitadas y valida límites", () => {
    expect(NAME_STYLE_REFERENCES.map((item) => item.code)).toEqual(["loby", "bunnita", "enana", "ghost"]);
    expect(nameStyleSchema.safeParse({ colors: ["red", "#ffffff", "#000000"] }).success).toBe(false);
    expect(nameStyleSchema.safeParse({ prefix: "x".repeat(13) }).success).toBe(false);
    expect(nameStyleSchema.safeParse({ size: 1000 }).success).toBe(false);
  });
});
