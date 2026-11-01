import { describe, expect, it } from "vitest";
import { sanitizeHeroHtml } from "./config.js";

describe("sanitizeHeroHtml", () => {
  it("conserva etiquetas permitidas consecutivas y de cierre", () => {
    expect(sanitizeHeroHtml("Uno<br>Dos<br>Tres <em>a</em>"))
      .toBe("Uno<br>Dos<br>Tres <em>a</em>");
  });

  it("elimina atributos y etiquetas ajenas y escapa aperturas incompletas", () => {
    expect(sanitizeHeroHtml('<span onclick="evil()">texto</span><img src=x>'))
      .toBe("<span>texto</span>");
    expect(sanitizeHeroHtml("texto <img src=x onerror=evil() "))
      .toBe("texto &lt;img src=x onerror=evil()");
  });
});
