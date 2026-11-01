import { describe, expect, it } from "vitest";
import { resolveLandingTheme, withFontFallbacks } from "./theme.js";

describe("tema de la portada", () => {
  it("combina valores del proyecto y traducción sin perder los colores predeterminados", () => {
    const theme = resolveLandingTheme("CRV", JSON.stringify({ heroTitleHtml: "Uno<br>Dos", colors: { red: "#123456" } }), { heroSubPublic: "In English" });
    expect(theme.projectName).toBe("CRV");
    expect(theme.heroTitleHtml).toBe("Uno<br>Dos");
    expect(theme.heroSubPublic).toBe("In English");
    expect(theme.colors.red).toBe("#123456");
    expect(theme.colors.bg).toBe("#0a0a0a");
  });

  it("rechaza fuentes, colores y URL inseguros y sanea el HTML traducido", () => {
    const theme = resolveLandingTheme("CRV", { fontTitle: "x; color:red", googleFontsUrl: "https://evil.example/font", colors: { red: "red" } }, { heroTitleHtml: '<span onclick="evil()">Hola</span><img src=x' });
    expect(theme.fontTitle).toContain("Anton");
    expect(theme.googleFontsUrl).toContain("fonts.googleapis.com");
    expect(theme.colors.red).toBe("#e50914");
    expect(theme.heroTitleHtml).toBe("<span>Hola</span>&lt;img src=x");
    expect(withFontFallbacks("'Anton', sans-serif")).toBe("'Anton', 'Anton Fallback', sans-serif");
  });
});
