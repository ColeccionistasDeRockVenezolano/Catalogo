// CRV · Pruebas de los saneadores de identidad (3.10), idiomas (3.11) y tema (3.12).
import { describe, expect, it } from "vitest";
import { sanitizeBranding, sanitizeProjectI18n, sanitizeTheme, sniffImage } from "./identity.js";

describe("sanitizeBranding", () => {
  it("conserva textos conocidos y descarta los demás", () => {
    const clean = sanitizeBranding({ metaTitle: "CRV", metaDescription: "Archivo", inventado: "x" });
    expect(clean["metaTitle"]).toBe("CRV");
    expect(clean["metaDescription"]).toBe("Archivo");
    expect(clean).not.toHaveProperty("inventado");
  });

  it("valida las direcciones y el tipo de tarjeta", () => {
    expect(sanitizeBranding({ siteUrl: "https://ejemplo.com" })["siteUrl"]).toBe("https://ejemplo.com");
    expect(() => sanitizeBranding({ siteUrl: "javascript:alert(1)" })).toThrow(/no es válida/);
    expect(sanitizeBranding({ twitterCard: "player" })).not.toHaveProperty("twitterCard");
    expect(sanitizeBranding({ twitterCard: "summary_large_image" })["twitterCard"]).toBe("summary_large_image");
  });

  it("sanea enlaces sociales y donación", () => {
    const clean = sanitizeBranding({
      socialLinks: [
        { platform: "instagram", label: "IG", url: "https://instagram.com/crv" },
        { platform: "web", url: "javascript:alert(1)" },
        { platform: "email", url: "mailto:hola@crv.dev" },
      ],
      donation: { enabled: true, platform: "paypal", url: "https://paypal.me/crv", label: "Apoya" },
    });
    expect(clean["socialLinks"]).toHaveLength(2);
    expect(clean["donation"]).toMatchObject({ enabled: true, platform: "paypal" });
  });
});

describe("sanitizeTheme", () => {
  it("conserva textos, fuentes y colores conocidos", () => {
    const clean = sanitizeTheme({
      heroTitleHtml: "EDITAR EL<br>ROADMAP", fontTitle: "'Anton', sans-serif",
      colors: { bg: "#0a0a0a", red: "#e50914", inventado: "#fff", blanco: "no-es-color" },
    });
    expect(clean["heroTitleHtml"]).toBe("EDITAR EL<br>ROADMAP");
    expect(clean["fontTitle"]).toBe("'Anton', sans-serif");
    expect(clean["colors"]).toEqual({ bg: "#0a0a0a", red: "#e50914" });
  });

  it("rechaza Google Fonts de otro dominio y URLs sin https", () => {
    expect(sanitizeTheme({ googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter" })["googleFontsUrl"]).toBeDefined();
    expect(sanitizeTheme({ googleFontsUrl: "https://evil.example/fonts.css" })).not.toHaveProperty("googleFontsUrl");
    expect(sanitizeTheme({ mainSiteUrl: "http://ejemplo.com" })).not.toHaveProperty("mainSiteUrl");
  });

  it("sanea el titular y descarta cuerpos que no son objeto", () => {
    expect(sanitizeTheme({ heroTitleHtml: "<span onclick=\"x\">Hola</span>" })["heroTitleHtml"]).toBe("<span>Hola</span>");
    expect(() => sanitizeTheme("[]")).toThrow(/no es un objeto/);
  });
});

describe("sanitizeProjectI18n", () => {
  it("acepta un idioma distinto del español con claves y textos", () => {
    const clean = sanitizeProjectI18n({ en: { heroSubPublic: "Archive", "collab.submitLabel": "Send" }, es: { heroSubPublic: "Archivo" } });
    expect(clean["en"]).toEqual({ heroSubPublic: "Archive", "collab.submitLabel": "Send" });
    expect(clean).not.toHaveProperty("es");
  });

  it("descarta textos vacíos, claves raras y valores no textuales", () => {
    const clean = sanitizeProjectI18n({ en: { heroSubPublic: "", "clave rara": "x", metaDescription: 42 } });
    expect(clean["en"]).toEqual({});
  });

  it("sanea el titular traducido", () => {
    const clean = sanitizeProjectI18n({ en: { heroTitleHtml: "<em>Edit</em><br>The roadmap" } });
    expect(clean["en"]?.["heroTitleHtml"]).toBe("<em>Edit</em><br>The roadmap");
  });
});

describe("sniffImage", () => {
  it("reconoce PNG, JPG y WebP por sus bytes", () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("RIFF0000WEBPVP8 ", "ascii"))).toBe("image/webp");
    expect(sniffImage(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\">", "utf8"))).toBeUndefined();
  });
});
