// CRV · Campo del texto y shaders del nombre.
//
// El navegador compila los shaders; aquí se comprueba lo que se puede sin
// GPU: que cada preset del catálogo tiene fuente, que no usa palabras
// reservadas de GLSL ES 1.0 como nombres y que el campo del texto dice la
// verdad sobre dentro/fuera, arriba/abajo.
import { describe, expect, it } from "vitest";
import { EFFECT_CATALOG, NAME_SHADER_PRESETS } from "../../../src/chat/effects-catalog";
import { NAME_SHADER_KEYS, nameShaderSource, shaderPadding } from "../../src/lib/nameShaders";
import { buildTextField, chamferDistance } from "../../src/lib/textField";

/** Dos «letras»: un bloque arriba (filas 2-4) y otro abajo (filas 8-9). */
function sample(): { coverage: Uint8Array; width: number; height: number } {
  const width = 6;
  const height = 12;
  const coverage = new Uint8Array(width * height);
  for (let y = 2; y <= 4; y += 1) for (let x = 1; x <= 4; x += 1) coverage[y * width + x] = 255;
  for (let y = 8; y <= 9; y += 1) for (let x = 1; x <= 4; x += 1) coverage[y * width + x] = 255;
  return { coverage, width, height };
}

describe("campo del texto", () => {
  it("mide distancias al conjunto marcado", () => {
    const mask = new Uint8Array([0, 0, 1, 0, 0]);
    expect([...chamferDistance(mask, 5, 1)]).toEqual([2, 1, 0, 1, 2]);
  });

  it("la distancia es positiva dentro y negativa fuera", () => {
    const { coverage, width, height } = sample();
    const field = buildTextField(coverage, width, height, 4);
    const g = (x: number, y: number): number => field[(y * width + x) * 4 + 1]!;
    expect(g(2, 3)).toBeGreaterThan(128);
    expect(g(0, 0)).toBeLessThan(128);
    expect(field[(3 * width + 2) * 4]).toBe(255);
  });

  it("dentro: profundidad desde arriba y altura sobre el borde de abajo", () => {
    const { coverage, width, height } = sample();
    const field = buildTextField(coverage, width, height, 4);
    const at = (x: number, y: number): [number, number] => [field[(y * width + x) * 4 + 2]!, field[(y * width + x) * 4 + 3]!];
    const unit = 255 / height;
    expect(at(2, 2)).toEqual([0, Math.round(2 * unit)]);
    expect(at(2, 4)).toEqual([Math.round(2 * unit), 0]);
  });

  it("fuera: las gotas saben cuánto cuelgan y el fuego cuánto sube", () => {
    const { coverage, width, height } = sample();
    const field = buildTextField(coverage, width, height, 4);
    const at = (x: number, y: number): [number, number] => [field[(y * width + x) * 4 + 2]!, field[(y * width + x) * 4 + 3]!];
    const unit = 255 / height;
    // Entre las dos letras: 2 filas bajo la de arriba, 2 sobre la de abajo.
    expect(at(2, 6)).toEqual([Math.round(2 * unit), Math.round(2 * unit)]);
    // Encima de todo: no hay letra arriba; la de abajo está a 2 filas.
    expect(at(2, 0)).toEqual([255, Math.round(2 * unit)]);
    // Debajo de todo: sin letra abajo.
    expect(at(2, 11)[1]).toBe(255);
    // Columna vacía: nada arriba ni abajo.
    expect(at(0, 6)).toEqual([255, 255]);
  });
});

describe("shaders del nombre", () => {
  it("cada preset del catálogo tiene su shader", () => {
    expect([...NAME_SHADER_KEYS].sort()).toEqual([...NAME_SHADER_PRESETS].sort());
    for (const effect of EFFECT_CATALOG) {
      for (const layer of effect.manifest.layers) {
        if (layer.type === "shader") expect(nameShaderSource(layer.preset), `${effect.code}/${layer.preset}`).not.toBeNull();
      }
    }
    expect(nameShaderSource("inventado")).toBeNull();
  });

  it("no usa palabras reservadas de GLSL ES 1.0 como nombres", () => {
    const reserved = ["out", "in", "inout", "input", "output", "filter", "sample", "active", "common", "partition", "half", "fixed", "sizeof", "cast", "namespace", "using", "superp", "union", "enum", "typedef", "template", "this", "packed", "goto", "switch", "default", "inline", "noinline", "volatile", "public", "static", "extern", "external", "interface", "flat", "long", "short", "double", "unsigned"];
    for (const preset of NAME_SHADER_KEYS) {
      const source = nameShaderSource(preset)!;
      expect(source).toContain("vec4 shade(vec2 p)");
      for (const word of reserved) {
        expect(new RegExp(`\\b(float|vec2|vec3|vec4|int)\\s+${word}\\b`, "u").test(source), `${preset}: ${word}`).toBe(false);
      }
    }
  });

  it("el lienzo deja sitio para lo que sale de las letras", () => {
    expect(shaderPadding("blood-flow").bottom).toBeGreaterThan(1);
    expect(shaderPadding("fire-burn").top).toBeGreaterThan(0.8);
    expect(shaderPadding("snow-cap").top).toBeGreaterThan(0.5);
  });
});
