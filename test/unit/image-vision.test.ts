import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DeepSeekGateway, MemoryDeepSeekRunStore, MockDeepSeekTransport } from "../../src/ai/gateway.js";
import { compareVisibleText, createVisionClassifier, mergeVisualReading, needsVisualReading, printedRelease } from "../../src/verification/image-vision.js";

describe("lectura visual de imágenes candidatas", () => {
  it("decide en código si el texto impreso nombra la ficha", () => {
    expect(compareVisibleText(["LA MISMA GENTE", "Dame un poco más"], ["Dame un poco más", "La Misma Gente"])).toBe("match");
    // Covers break lines and reorder words freely.
    expect(compareVisibleText(["Velasco", "y Cepeda"], ["Velasco y Cepeda"])).toBe("match");
    expect(compareVisibleText(["Velasco y Cepeda", "Esta vez no fallaré"], ["Ese que va por ahí", "Jeremías"])).toBe("mismatch");
    // A partly legible name is not evidence against the record; no text, nothing to compare.
    expect(compareVisibleText(["Gasolina"], ["Gasolina Blues Criollo"])).toBe("none");
    expect(compareVisibleText([], ["Jeremías"])).toBe("none");
    expect(compareVisibleText(["LP", "33"], ["Jeremías"])).toBe("none");
    // A name cut at the edge or misread by one letter is still the record's.
    expect(compareVisibleText(["Sr.", "MALANG"], ["Sr. Malanga"])).toBe("match");
    expect(compareVisibleText(["Natushca", "A TRIBUTE TO"], ["Natusha"])).toBe("match");
    // A credit line names a guest singer, not another record.
    expect(compareVisibleText(["CANTA", "YECI RAMOS"], ["Luisito Quintero"])).toBe("none");
    expect(compareVisibleText(["Canta Yeci Ramos"], ["Luisito Quintero"])).toBe("none");
    // A band whose name starts like a credit is still the band.
    expect(compareVisibleText(["Voz Veis", "GRANDES ÉXITOS"], ["Grandes Exitos", "Voz Veis"])).toBe("match");
    // Lettering may join the words of a name.
    expect(compareVisibleText(["SANLUIS"], ["San Luis", "San Luis"], { target: "album" })).toBe("match");
  });
  it("otro disco del mismo artista delata una portada ajena; en un disco homónimo, otro título impreso deja la identidad sin probar", () => {
    const album = { target: "album" as const, otherTitles: ["Ese que va por ahí", "Un día más en el gran circo"] };
    expect(compareVisibleText(["JEREMIAS", "ese que va por ahí."], ["Jeremías", "Jeremías"], album)).toBe("mismatch");
    expect(compareVisibleText(["Jeremías"], ["Jeremías", "Jeremías"], album)).toBe("match");
    expect(compareVisibleText(["TÚ NO SABES", "JEREMIAS"], ["Jeremías", "Jeremías"], album)).toBe("none");
    // A titled album keeps its proof even if the artist printed another line.
    expect(compareVisibleText(["Jeremías", "Ese que va por ahí", "bonus track"], ["Ese que va por ahí", "Jeremías"], { target: "album", otherTitles: ["Jeremías"] })).toBe("match");
    expect(compareVisibleText(["DEJANDO VOLAR", "EL PENSAMIENTO", "DANIEL GRAU y su orquesta"], ["Dejando Volar El Pensamiento", "Daniel Grau"], { target: "album", otherTitles: ["La Orquesta De Daniel Grau"] })).toBe("match");
    // A track list or a prefix of another title is no other record.
    expect(compareVisibleText(["Bieber", "VICTOR DRIA"], ["Beber", "Víctor Drija"], { target: "album", otherTitles: ["Victorias"] })).not.toBe("mismatch");
    expect(compareVisibleText(["Exitos...y algo mas", "(B) SOLO PIENSO EN TI / ABREME LA PUERTA"], ["Exitos... y Algo Más", "Guillermo Dávila"], { target: "album", otherTitles: ["Solo Exitos"] })).toBe("match");
    // A variant of the same title is not another record.
    expect(compareVisibleText(["Se acabó", "Versión salsa"], ["Se acabó (Versión salsa)", "San Luis"], { target: "album", otherTitles: ["Se acabó"] })).toBe("match");
    // A cover among the artist's photos is found by the release it prints; a self-titled one never decides.
    const releases = [{ id: 1, title: "Jeremías" }, { id: 2, title: "Un día más en el gran circo" }, { id: 3, title: "Tú" }];
    expect(printedRelease(["jeremías", "UN DÍA MÁS EN EL GRAN CIRCO"], releases, "Jeremías")?.id).toBe(2);
    expect(printedRelease(["jeremías"], releases, "Jeremías")).toBeNull();
    // Small lettering may misread the end of a long title; a short shared run is no proof.
    expect(printedRelease(["jeremias", "un dia mas en el great sitio"], releases, "Jeremías")?.id).toBe(2);
    expect(printedRelease(["un dia de sol"], releases, "Jeremías")).toBeNull();
    expect(printedRelease(["TÚ NO SABES", "JEREMIAS"], releases, "Jeremías")).toBeNull();
    // On an artist's image, the cover of one of their releases names them.
    expect(compareVisibleText(["Dando la Cara"], ["Zikoticos Armados"], { target: "artist", otherTitles: ["Dando la Cara", "Demo"] })).toBe("match");
  });
  it("envía una copia reducida sin los nombres esperados y compara la transcripción", async () => {
    const transport = new MockDeepSeekTransport({ use: "cover", visibleText: ["Algo Eléctrico", "Castillo"], reason: "Portada con el título impreso" });
    const gateway = new DeepSeekGateway({ baseUrl: "https://mock.invalid", models: { fast: "mock", reasoning: "mock", vision: "mock-vision" }, maxTokens: 4000, timeoutMs: 1000 }, transport, new MemoryDeepSeekRunStore());
    const bytes = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#a33" } }).jpeg().toBuffer();
    const result = await createVisionClassifier(gateway)({ bytes, sourceUrl: "https://img.example/a.jpg", target: "album", expected: ["Ese que va por ahí", "Jeremías"], context: null });
    expect(result).toMatchObject({ use: "cover", textMatch: "mismatch" });
    const request = transport.requests[0]!;
    expect(request.model).toBe("mock-vision");
    expect(request.user).not.toContain("Jeremías");
    const sent = await sharp(Buffer.from(request.images![0]!.dataUrl.split(",")[1]!, "base64")).metadata();
    expect(Math.max(sent.width!, sent.height!)).toBe(640);
  });
  it("una portada con la lista de temas impresa conserva la lectura con sus primeras líneas", async () => {
    const tracks = Array.from({ length: 20 }, (_, i) => `Tema ${i + 1}`);
    const transport = new MockDeepSeekTransport({ use: "cover", visibleText: ["Guillermo Dávila", "Éxitos y algo más", ...tracks], reason: "Portada con la lista de temas" });
    const gateway = new DeepSeekGateway({ baseUrl: "https://mock.invalid", models: { fast: "mock", reasoning: "mock", vision: "mock-vision" }, maxTokens: 4000, timeoutMs: 1000 }, transport, new MemoryDeepSeekRunStore());
    const bytes = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#c3c" } }).jpeg().toBuffer();
    const result = await createVisionClassifier(gateway)({ bytes, sourceUrl: "https://img.example/b.jpg", target: "album", expected: ["Exitos... y Algo Más", "Guillermo Dávila"], context: null });
    expect(result.visibleText).toHaveLength(12);
    expect(result.textMatch).toBe("match");
  });
  it("el contexto documentado conserva el uso; el texto impreso siempre se compara", () => {
    const seen = (use: "cover" | "portrait" | "live", textMatch: "match" | "mismatch" | "none") => ({ use, visibleText: ["Velasco y Cepeda"], reason: "Lo que se ve", textMatch });
    const documented = mergeVisualReading({ use: "cover", reasons: ["El contexto lo describe como portada"] }, seen("cover", "mismatch"), "album", ["Ese que va por ahí", "Jeremías"]);
    expect(documented.use).toBe("cover");
    expect(documented.reasons.join(" ")).toContain("posible imagen de otra ficha");
    expect(mergeVisualReading({ use: "cover", reasons: ["El contexto lo describe como portada"] }, seen("live", "none"), "album", ["X"]).reasons[1]).toMatch(/^La lectura visual la ve como foto en vivo/u);
    // Without context the reading decides; a cover showing the musician with the record's name is a cover.
    expect(mergeVisualReading({ use: "cover", reasons: ["Imagen cuadrada asociada a un disco"] }, seen("portrait", "match"), "album", ["Velasco y Cepeda"]).use).toBe("cover");
    expect(mergeVisualReading({ use: "unknown", reasons: ["El contexto no indica el uso; requiere inspección"] }, seen("live", "mismatch"), "artist", ["Jeremías"])).toEqual({ use: "live", reasons: ["Lectura visual: Lo que se ve"] });
    expect(needsVisualReading("irrelevant", ["Demasiado pequeña (100×100)"])).toBe(false);
    expect(needsVisualReading("cover", ["El contexto lo describe como portada"])).toBe(true);
  });
});
