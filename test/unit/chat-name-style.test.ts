import { describe, expect, it } from "vitest";
import { effectProductSchema } from "../../src/chat/effects-catalog.js";
import { angleVector, DEFAULT_NAME_STYLE, NAME_STYLE_REFERENCES, nameStyleBounds, nameStyleSchema } from "../../src/chat/name-style.js";

describe("estilos editables de nombres", () => {
  const manifest = { version: 1, triggers: ["always"], layers: [], cost: 2, nameStyle: DEFAULT_NAME_STYLE };
  it("admite un estilo de texto sin capas heredadas y conserva todos sus controles", () => {
    const result = effectProductSchema.parse({ kind: "name", manifest });
    expect(result.manifest.nameStyle).toEqual(DEFAULT_NAME_STYLE);
    expect(effectProductSchema.safeParse({ kind: "badge", manifest }).success).toBe(false);
    expect(effectProductSchema.safeParse({ kind: "name_font", manifest }).success).toBe(false);
  });
  it("reserva la huella rotada y espacio para sombras y movimiento", () => {
    const plain = { ...DEFAULT_NAME_STYLE, shadow: false, outlineWidth: 0, amplitude: 0 };
    expect(nameStyleBounds(100, 20, { ...plain, rotation: 90 })).toEqual({ width: 25, height: 104 });
    const diagonal = nameStyleBounds(100, 20, { ...plain, rotation: 45 });
    expect(diagonal.width).toBeGreaterThanOrEqual(89);
    expect(diagonal.height).toBeGreaterThanOrEqual(89);
    expect(nameStyleBounds(100, 20, DEFAULT_NAME_STYLE).height).toBeGreaterThan(nameStyleBounds(100, 20, plain).height);
  });
  it("orienta los vectores en los cuatro cuadrantes y permite el círculo completo", () => {
    expect(angleVector(90, 8).x).toBeCloseTo(8);
    expect(angleVector(180, 8).y).toBeCloseTo(8);
    expect(angleVector(270, 8).x).toBeCloseTo(-8);
    expect(angleVector(360, 8).y).toBeCloseTo(-8);
    for (const rotation of [0, 37, 90, 180, 271, 360]) expect(nameStyleSchema.safeParse({ rotation }).success).toBe(true);
    for (const value of [-1, 361, Infinity, NaN]) expect(nameStyleSchema.safeParse({ motionAngle: value }).success).toBe(false);
  });
  it("conserva solamente las tres referencias solicitadas y valida límites", () => {
    expect(NAME_STYLE_REFERENCES.map((item) => item.code)).toEqual(["loby", "bunnita", "enana"]);
    expect(nameStyleSchema.safeParse({ colors: ["red", "#ffffff", "#000000"] }).success).toBe(false);
    expect(nameStyleSchema.safeParse({ prefix: "x".repeat(13) }).success).toBe(false);
    expect(nameStyleSchema.safeParse({ size: 1000 }).success).toBe(false);
  });
});
