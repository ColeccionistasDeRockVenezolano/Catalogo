import { describe, expect, it } from "vitest";
import { load } from "cheerio";
import { pageImageResources } from "../../src/ambiguity/page-images.js";
import { pageExcerpt } from "../../src/verification/excerpt.js";

describe("recursos visuales documentados", () => {
  it("conserva originales y srcset, ordena por resolución y omite iconos", () => {
    const html = load(`<meta property="og:image" content="/cover.jpg"><meta property="og:image:width" content="1400"><meta property="og:image:height" content="1400">
      <img alt="Portada Disco Uno" src="/small.jpg" width="100" height="100" srcset="/small.jpg 100w, /large.jpg 1600w" data-original="/original.jpg">
      <img src="/icons/play.png"><img src="/photo_s150x150_.jpg"><img src="/100x100bb.jpg"><img alt="logo" src="/logo.jpg" width="2000" height="2000"><img src="data:image/png;base64,AAAA"><img src="javascript:alert(1)">`);
    const resources = pageImageResources(html, "https://official.example/disco");
    expect(resources).toContain("https://official.example/large.jpg");
    expect(resources.indexOf("/large.jpg")).toBeLessThan(resources.indexOf("/cover.jpg"));
    expect(resources).toContain("1400 × 1400 px");
    expect(resources).toContain("https://official.example/original.jpg | Dimensiones declaradas: desconocidas");
    expect(resources).not.toContain("/icons/");expect(resources).not.toContain("s150x150");expect(resources).not.toContain("100x100bb");expect(resources).not.toContain("small.jpg");expect(resources).not.toContain("logo.jpg");expect(resources).not.toContain("javascript:");expect(resources).not.toContain("base64");
  });
  it("conserva los recursos visuales en extractos de páginas largas", () => {
    const resources = pageImageResources(load('<img alt="Retrato Banda Prueba" src="/photo.jpg">'), "https://official.example");
    const page = {url:"https://official.example",title:"Banda Prueba",content:`Banda Prueba ${"biografía ".repeat(6000)} ${resources}`,contentHash:"test",fetchedAt:"2026-10-10"};
    expect(pageExcerpt(page, ["Banda Prueba"])).toContain("https://official.example/photo.jpg");
  });
});
