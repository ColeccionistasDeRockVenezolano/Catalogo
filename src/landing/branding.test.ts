import { describe, expect, it } from "vitest";
import { pageMeta, resolveBranding } from "./branding.js";

describe("identidad de la portada", () => {
  it("aplica traducciones y mantiene la configuración de redes y donaciones", () => {
    const brand = resolveBranding({ metaTitle: "Título", allowIndexing: true, socialLinks: [{ platform: "instagram", label: "Fotos", url: "https://example.com/" }], donation: { enabled: true, url: "https://example.com/donar", label: "Apoyar" } }, { metaTitle: "Title", "social.instagram": "Photos", donationLabel: "Support" });
    expect(brand.metaTitle).toBe("Title");
    expect(brand.socialLinks[0]?.label).toBe("Photos");
    expect(brand.donation.label).toBe("Support");
    expect(pageMeta(brand, { title: "fallback", description: "description" }).noindex).toBe(false);
  });

  it("descarta enlaces con esquemas que ejecutan código", () => {
    const brand = resolveBranding({ siteUrl: "javascript:alert(1)", socialLinks: [{ platform: "link", url: "javascript:alert(1)" }], donation: { enabled: true, url: "javascript:alert(1)" } });
    expect(brand.siteUrl).toBe("");
    expect(brand.socialLinks).toEqual([]);
    expect(brand.donation.url).toBe("");
  });
});
