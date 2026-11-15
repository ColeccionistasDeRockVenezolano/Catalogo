import { describe, expect, it } from "vitest";
import { appPath, campaignAttribution } from "../../src/lib/acquisition";

const origin = "https://coleccionistasderockvenezolano.com";
describe("procedencia del catálogo", () => {
  it("envía solo las etiquetas de campaña, nunca utm_term ni la búsqueda", () => {
    const result = campaignAttribution("?q=persona&utm_source=Instagram&utm_medium=social&utm_campaign=lanzamiento&utm_content=historia&utm_term=secreto&ref=bio", "", origin);
    expect(result).toEqual({ ref: "bio", source: "Instagram", medium: "social", campaign: "lanzamiento", content: "historia" });
    expect(JSON.stringify(result)).not.toContain("secreto");
    expect(JSON.stringify(result)).not.toContain("persona");
  });
  it("descarta etiquetas de más de 80 caracteres", () => {
    expect(campaignAttribution(`?utm_source=${"x".repeat(81)}`, "", origin)).toEqual({});
  });
  it("reduce el referente a su origen y omite el propio sitio", () => {
    expect(campaignAttribution("", "https://l.facebook.com/l.php?u=privado", origin)).toEqual({ referrer: "https://l.facebook.com" });
    expect(campaignAttribution("", `${origin}/crv/artistas`, origin)).toEqual({});
    expect(campaignAttribution("", "no es url", origin)).toEqual({});
  });
  it("quita el prefijo de publicación para reconocer las pantallas internas", () => {
    expect(appPath("/crv/curaduria/visitas", "/crv/")).toBe("/curaduria/visitas");
    expect(appPath("/crv/", "/crv/")).toBe("/");
    expect(appPath("/artistas/12", "/")).toBe("/artistas/12");
  });
});
