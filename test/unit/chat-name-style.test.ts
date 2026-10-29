import { describe, expect, it } from "vitest";
import { effectProductSchema } from "../../src/chat/effects-catalog.js";
import { angleVector, DEFAULT_NAME_STYLE, NAME_STYLE_REFERENCES, nameGradientGeometry, nameStyleBounds, nameStyleSchema } from "../../src/chat/name-style.js";

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
  it("las plantillas animan su degradado a lo largo de su propio eje, como en la captura", () => {
    for (const reference of NAME_STYLE_REFERENCES) {
      expect(reference.style.gradient).toBe(true);
      expect(reference.style.gradientAngle).toBe(0);
      expect(["wave", "flow", "sparkle"]).toContain(reference.style.animation);
      expect(nameGradientGeometry(reference.style).period).toBeGreaterThan(1);
    }
  });
  it("el flujo desplaza cada letra lo que avanza sobre el eje del degradado", () => {
    const flow = { ...DEFAULT_NAME_STYLE, animation: "flow" as const, tracking: 0 };
    // Horizontal: una letra entera de desfase; vertical: todas a la vez.
    expect(nameGradientGeometry({ ...flow, gradientAngle: 90 }).letterShift).toBeCloseTo(-100);
    expect(nameGradientGeometry({ ...flow, gradientAngle: 270 }).letterShift).toBeCloseTo(100);
    expect(nameGradientGeometry({ ...flow, gradientAngle: 0 }).letterShift).toBeCloseTo(0);
    expect(nameGradientGeometry({ ...flow, animation: "wave", gradientAngle: 90 }).letterShift).toBe(0);
    // Sin movimiento de color, el periodo cabe en la letra y se ven los tres colores.
    expect(nameGradientGeometry({ ...flow, animation: "none" }).period).toBeCloseTo(1 / 0.85);
    expect(nameGradientGeometry({ ...flow, colorStop: 100 }).center).toBe(85);
  });
  it("conserva solamente las tres referencias solicitadas y valida límites", () => {
    expect(NAME_STYLE_REFERENCES.map((item) => item.code)).toEqual(["loby", "bunnita", "enana"]);
    expect(nameStyleSchema.safeParse({ colors: ["red", "#ffffff", "#000000"] }).success).toBe(false);
    expect(nameStyleSchema.safeParse({ prefix: "x".repeat(13) }).success).toBe(false);
    expect(nameStyleSchema.safeParse({ size: 1000 }).success).toBe(false);
  });
});
