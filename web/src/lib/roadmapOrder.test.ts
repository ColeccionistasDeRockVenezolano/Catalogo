import { describe, expect, it } from "vitest";
import {
  clampPosition, dropPosition, keyboardStep, neighbourIndex, positionOf, previewOrder,
} from "./roadmapOrder";

const A = { id: "a" };
const B = { id: "b" };
const C = { id: "c" };
const D = { id: "d" };

describe("orden del roadmap de administración", () => {
  it("traduce la fila bajo el puntero a la posición que espera la API", () => {
    // Sobre la mitad superior de la primera fila, antes de ella.
    expect(dropPosition(0, false)).toBe(1);
    // Sobre la mitad inferior de la primera fila, después de ella.
    expect(dropPosition(0, true)).toBe(2);
    // Al final de una lista de tres filas.
    expect(dropPosition(2, true)).toBe(4);
  });

  it("acota posiciones al rango real de la lista", () => {
    expect(clampPosition(0, 3)).toBe(1);
    expect(clampPosition(9, 3)).toBe(4);
    expect(clampPosition(2.6, 3)).toBe(3);
    expect(clampPosition(1, 0)).toBe(1);
  });

  it("mueve una actividad dentro de su etapa al índice final correcto", () => {
    // Mover A después de C: el destino se cuenta sin A → [B, C, D] + A en 3.
    expect(previewOrder([A, B, C, D], A, 3).map((item) => item.id)).toEqual(["b", "c", "a", "d"]);
    // Mover D al principio.
    expect(previewOrder([A, B, C, D], D, 1).map((item) => item.id)).toEqual(["d", "a", "b", "c"]);
    // Mover B al final.
    expect(previewOrder([A, B, C, D], B, 4).map((item) => item.id)).toEqual(["a", "c", "d", "b"]);
  });

  it("inserta una actividad llegada de otra etapa sin perder ninguna", () => {
    const moved = { id: "x" };
    expect(previewOrder([A, B], moved, 2).map((item) => item.id)).toEqual(["a", "x", "b"]);
    expect(previewOrder([A, B], moved, 3).map((item) => item.id)).toEqual(["a", "b", "x"]);
  });

  it("calcula la posición de un elemento y la deja en 0 si no está", () => {
    expect(positionOf([A, B, C], B)).toBe(2);
    expect(positionOf([A, B, C], D)).toBe(0);
  });

  it("sube y baja con las flechas y avisa al llegar al borde", () => {
    expect(keyboardStep("up", 3, 4)).toBe(2);
    expect(keyboardStep("down", 2, 4)).toBe(3);
    expect(keyboardStep("up", 1, 4)).toBeNull();
    expect(keyboardStep("down", 4, 4)).toBeNull();
    expect(keyboardStep("down", 1, 0)).toBeNull();
  });

  it("no se sale de la lista de etapas", () => {
    expect(neighbourIndex(0, 5, -1)).toBeNull();
    expect(neighbourIndex(4, 5, 1)).toBeNull();
    expect(neighbourIndex(2, 5, -1)).toBe(1);
    expect(neighbourIndex(2, 5, 1)).toBe(3);
  });
});
