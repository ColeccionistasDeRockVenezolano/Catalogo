import { describe, expect, it } from "vitest";
import { matchesCategorySelection, parseCategorySelection, toggleCategorySelection } from "../../src/shared/category-selection.js";

describe("selección acumulable de categorías", () => {
  it("conserva enlaces simples y combina comas y parámetros repetidos sin duplicar", () => {
    expect(parseCategorySelection(["single"])).toEqual(["single"]);
    expect(parseCategorySelection(["single, remix", "instrumental,remix", " "])).toEqual(["single", "remix", "instrumental"]);
    expect(parseCategorySelection(["single,desconocido", "remix"], ["single", "remix"])).toEqual(["single", "remix"]);
  });
  it("quitar una categoría conserva las demás y su orden", () => {
    expect(toggleCategorySelection(["single", "remix", "instrumental"], "remix")).toEqual(["single", "instrumental"]);
    expect(toggleCategorySelection(["single"], "remix")).toEqual(["single", "remix"]);
    expect(toggleCategorySelection(["single"], "single")).toEqual([]);
  });
  it("exige todas las categorías; una combinación imposible no amplía resultados", () => {
    expect(matchesCategorySelection(["single", "remix", "instrumental"], ["single", "remix"])).toBe(true);
    expect(matchesCategorySelection(["single", "remix"], ["single", "ep"])).toBe(false);
    expect(matchesCategorySelection(["single"], ["remix"])).toBe(false);
    expect(matchesCategorySelection(["single"], [])).toBe(true);
  });
});
