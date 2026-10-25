import { describe, expect, it } from "vitest";
import { isBSidesTitle } from "../../src/normalization/b-sides-title.js";

describe("marcas B-Sides del título", () => {
  it.each(["B-Sides", "B - side y Rarezas", "B- Side", "Tema (B–Sides)", "B‑Side: X", "BSides", "B Side"])("reconoce %s", title => {
    expect(isBSidesTitle(title)).toBe(true);
  });
  it.each(["Lado A Lado B", "Besides", "B-Sideshow", "AB-Sides", "ÁB-Sides", "B-Sidesño"])("no confunde %s", title => {
    expect(isBSidesTitle(title)).toBe(false);
  });
});
