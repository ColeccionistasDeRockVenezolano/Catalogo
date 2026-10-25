import { describe, expect, it } from "vitest";
import { askQuestion, checkItem, excerpt, firstQuestions, followUpQuestions, isTrusted, pickHits, TRUSTED_DOMAINS, type HumanArtist } from "../../src/verification/human-research.js";

const band: HumanArtist = { name: "Hermes", aliases: [], type: "band", country: "Venezuela", formedYear: null, memberNames: [], albums: [] };

describe("ficha por preguntas simples", () => {
  it("una pregunta por dato, dicha como una persona", () => {
    const questions = firstQuestions(band);
    expect(questions.map((question) => question.field)).toEqual(["identidad", "biografia", "origen", "integrantes", "discografia", "generos", "redes"]);
    expect(questions.find((question) => question.field === "discografia")!.question).toBe("¿Qué discos ha publicado Hermes?");
    expect(firstQuestions({ ...band, type: "solo_artist" }).some((question) => question.field === "integrantes")).toBe(false);
    expect(followUpQuestions(band, ["discografia"])[0]!.query).toContain("discogs");
  });

  it("solo abre fuentes confiables que nombran al artista", () => {
    expect(isTrusted("https://www.discogs.com/artist/1", TRUSTED_DOMAINS)).toBe(true);
    expect(isTrusted("https://es.wikipedia.org/wiki/Hermes", TRUSTED_DOMAINS)).toBe(true);
    expect(isTrusted("https://www.hermes.com/br/pt/", TRUSTED_DOMAINS)).toBe(false);
    const hits = pickHits([
      { url: "https://www.hermes.com/", title: "Hermès oficial", snippet: "bolsos", engine: "x" },
      { url: "https://hermesbanda.bandcamp.com/album/uno", title: "Uno, by Hermes", snippet: "rock de Caracas", engine: "x" },
      { url: "https://www.discogs.com/artist/2-Otra-Banda", title: "Otra Banda", snippet: "", engine: "x" },
    ], ["Hermes"], TRUSTED_DOMAINS);
    expect(hits.map((hit) => hit.url)).toEqual(["https://hermesbanda.bandcamp.com/album/uno"]);
  });

  it("lee alrededor del nombre, como con Ctrl+F", () => {
    const text = `${"relleno ".repeat(500)}La banda Hermes grabó su disco Uno en 1998. ${"relleno ".repeat(500)}`;
    const part = excerpt(text, ["Hermes"], 4500, 100);
    expect(part).toContain("Hermes grabó su disco Uno");
    expect(part.length).toBeLessThan(300);
  });

  it("descarta datos sin cita literal o con el dato fuera de la cita", () => {
    const page = { content: "La banda Hermes grabó su disco «Uno» en 1998 con Pedro Pérez en la batería." };
    expect(checkItem("discografia", { value: "Uno", quote: "grabó su disco «Uno» en 1998" }, page)).toBeNull();
    expect(checkItem("discografia", { value: "Dos", quote: "grabó su disco «Uno» en 1998" }, page)).toBe("el dato no aparece en la cita");
    expect(checkItem("integrantes", { value: "Pedro Pérez", quote: "con Pedro Perez en la bateria y Juan" }, page)).toBe("la cita no está en la página");
    expect(checkItem("redes", { value: "https://instagram.com/hermes", quote: "grabó su disco «Uno» en 1998" }, page)).toBe("la dirección no está en la página");
  });

  it("lee primero nuestras páginas y descarta lo que viene de un homónimo", async () => {
    const pages: Record<string, string> = {
      "https://sincopa.com/hermes.htm": "Hermes y Los Solicitados. Sonográfica Rock 1989 (LP). Vocals: Hermes Fajardo",
      "https://es.wikipedia.org/wiki/Hermes": "Hermes es un dios griego, mensajero de los dioses del Olimpo.",
    };
    const read: string[] = [];
    const gateway = { propose: async () => ({ model: "x", modelClass: "fast", cached: false, promptHash: "h", tokensIn: 10, tokensOut: 5, proposal: {
      sources: [{ source: 1, sameArtist: "si", reason: "mismo disco" }, { source: 2, sameArtist: "no", reason: "el dios" }],
      items: [
        { value: "Hermes y Los Solicitados", detail: "1989", source: 1, quote: "Hermes y Los Solicitados. Sonográfica Rock 1989 (LP)" },
        { value: "Olimpo", detail: null, source: 2, quote: "mensajero de los dioses del Olimpo" },
      ], missing: null } }) } as never;
    const answered = await askQuestion(firstQuestions(band).find((question) => question.field === "discografia")!, band, {}, {
      search: async () => [{ url: "https://es.wikipedia.org/wiki/Hermes", title: "Hermes", snippet: "dios griego", engine: "x" }],
      page: async (url) => { read.push(url); return { url, title: "", content: pages[url]!, contentHash: "h", fetchedAt: "" }; },
      gateway, trusted: TRUSTED_DOMAINS, ownUrls: ["https://sincopa.com/hermes.htm"],
    });
    expect(read).toEqual(["https://sincopa.com/hermes.htm", "https://es.wikipedia.org/wiki/Hermes"]);
    expect(answered.items.map((item) => item.value)).toEqual(["Hermes y Los Solicitados"]);
    expect(answered.rejected).toEqual([{ value: "Olimpo", url: "https://es.wikipedia.org/wiki/Hermes", why: "la página no es de este artista" }]);
  });
});
