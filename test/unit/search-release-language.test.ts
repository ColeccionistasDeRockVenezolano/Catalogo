import { expect, it } from "vitest";
import { extractReleaseLanguage } from "../../src/search/rym-release-language.js";
import { hashText } from "../../src/search/review-protocol.js";

const header = '<meta property="og:url" content="https://rateyourmusic.com/release/album/test/release/"><h1 class="album_title">Release<div>By <a class="artist">Artist</a></div></h1>';
const row = (literal: string, label = "Language") => `<tr><th class="info_hdr">${label}</th><td>${literal}</td></tr>`;
const table = (rows: string) => `<table class="album_info">${rows}</table>`;
function extract(body: string) {
  const html = header + body;
  return extractReleaseLanguage({ html, source: "https://rateyourmusic.com/release/album/test/release/", capturedAtOriginal: "2026-10-04 08:55:33",
    expectedHash: hashText(html), object: { kind: "album", id: 1, name: "Release", artist: "Artist", identityEvidence: ["accepted exact URL claim"] } });
}
it("conserva literal bilingüe y alcance de publicación sin atribuir edición o pistas", () => {
  const r = extract(table(row("Spanish, English", "Languages")));
  expect(r.field?.literal).toBe("Spanish, English");
  expect(r.languages).toEqual([{ literal: "Spanish", code: "es" }, { literal: "English", code: "en" }]);
  expect(r.status).toBe("documented"); expect(r.scope).toBe("source_release_metadata");
  expect(r.edition).toBeNull(); expect(r.segment).toBeNull(); expect(r.capturedAt).toBeNull(); expect(r.captureTimeZone).toBeNull();
  expect(r.capturedAtOriginal).toBe("2026-10-04 08:55:33");
});
it("ausencia y vacío permanecen desconocidos aunque reseña y descriptor indiquen un idioma", () => {
  const noise = '<div class="review_body">English' + table(row("English")) + '</div><meta content="Spanish"><div class="release_descriptors">instrumental</div>';
  for (const body of [noise, table(row("")) + noise]) {
    const r = extract(body); expect(r.status).toBe("unknown"); expect(r.languages).toEqual([]);
  }
  expect(extract(noise).field).toBeNull();
});
it.each(["Instrumental", "Unknown", "French", "Spanish / English", "Spanish,", "toString"])("literal no validado %s queda pendiente sin inventar una lengua", literal => {
  const r = extract(table(row(literal))); expect(r.status).toBe("unresolved"); expect(r.field?.literal).toBe(literal);
});
it("rechaza campos duplicados o celdas ambiguas", () => {
  expect(() => extract(table(row("English") + row("Spanish")))).toThrow(/múltiples/);
  expect(() => extract(table('<tr><th class="info_hdr">Language</th><td>Spanish</td><td>English</td></tr>'))).toThrow(/ambigua/);
});
it("requiere huella y vínculo exactos aunque el campo de idioma sea válido", () => {
  const html = header + table(row("Spanish"));
  const input = { html, source: "https://rateyourmusic.com/release/album/test/release/", capturedAtOriginal: "unknown", expectedHash: hashText(html),
    object: { kind: "album" as const, id: 1, name: "Release", artist: "Artist", identityEvidence: ["accepted exact URL claim"] } };
  expect(() => extractReleaseLanguage({ ...input, html: html + "changed" })).toThrow(/cambió/);
  expect(() => extractReleaseLanguage({ ...input, source: "https://rateyourmusic.com/release/album/other/release/" })).toThrow(/Identidad/);
  expect(() => extractReleaseLanguage({ ...input, object: { ...input.object, identityEvidence: [] } })).toThrow(/documental/);
});
