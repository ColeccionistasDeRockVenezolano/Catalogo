import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { DeepSeekGateway, FetchDeepSeekTransport, MemoryDeepSeekRunStore, MockDeepSeekTransport } from "../../src/ai/gateway.js";
import { musicalSourceChunks, leanMusicalChunks, officialDocumentLinks, factEvidence, musicalFactReviewReasons, recoverMusicalExtraction,musicalPublicationMatches, type MusicalFact } from "../../src/verification/official-enrichment.js";
import type { WebPage } from "../../src/ambiguity/web-search.js";
const page: WebPage = { url: "https://artist.example/discografia", title: "Banda Venezuela", content: "Fernando fundó Banda Venezuela en 1984.", contentHash: "fixture", fetchedAt: "2026-10-13T20:00:00Z", capturedAt: "2026-10-13T20:00:00Z", acquisitionMethod: "http" };
const fact: MusicalFact = { kind: "founder", subject: "Fernando", value: "1984", project: "Banda Venezuela", releaseTitle: null, trackTitle: null, role: null, dateText: "1984", quote: page.content, uncertainty: null };
describe("enriquecimiento musical documental", () => {
  it("permanece en el perfil de la banda dentro de plataformas compartidas",()=>{
    const profile={...page,url:"https://myspace.com/bandavenezuela",content:"Enlaces de la página:\nAlbum https://myspace.com/bandavenezuela/music/album/disco\nMusic https://myspace.com/discover/songs\nAlbum https://myspace.com/otro/music/album/ajeno"};
    expect(officialDocumentLinks(profile)).toEqual(["https://myspace.com/bandavenezuela/music/album/disco"]);
  });
  it("no atribuye todo el catálogo de un sello a una sola banda",()=>{
    const release={...page,content:"JSON-LD 1 /byArtist/name: Another Band\nSello Records publica bandas de Venezuela. Banda Venezuela aparece en las recomendaciones."};
    expect(musicalPublicationMatches(release,["Banda Venezuela"])).toBe(false);
    expect(musicalPublicationMatches({...release,content:"JSON-LD 1 /byArtist/name: Banda Venezuela & Invitado"},["Banda Venezuela"])).toBe(true);
  });
  it("distingue listas de integrantes de fundadores y proyectos paralelos del proyecto raíz",()=>{
    const roster={...page,content:"Banda Venezuela, formada en 1998. Conformada por Fernando y Luis."};
    expect(musicalFactReviewReasons({...fact,quote:roster.content},roster)).toContain("La cita enumera participantes pero no afirma que sean fundadores.");
    const parallel={...page,content:"Fernando fundó Los Sinvergüenzas en 1984."};
    expect(factEvidence({...fact,quote:parallel.content},parallel)).toBeNull();
    expect(factEvidence({...fact,project:"Los Sinvergüenzas",quote:parallel.content},parallel)).not.toBeNull();
    const copyright={...page,content:"Banda Venezuela © 2026"};
    expect(factEvidence({...fact,kind:"formation",subject:"Banda Venezuela",quote:copyright.content,dateText:"2026"},copyright)).toBeNull();
  });
  it("recorre discos nuevos, biografías y miembros aunque aún no estén en el catálogo", () => {
    const index = { ...page, content: "Enlaces de la página:\nEnlace: Miembros https://artist.example/members\nEnlace: Disco nuevo https://artist.example/album/nuevo?utm_source=a#tracks\nEnlace: Biography https://artist.example/about\nEnlace: Album ajeno https://other.example/album/ajeno\nEnlace: Album tienda https://artist.example/store/album\nEnlace: Song download https://artist.example/track/song?action=download\nRecursos visuales de la página: imagen" };
    expect(officialDocumentLinks(index)).toEqual(["https://artist.example/members", "https://artist.example/album/nuevo", "https://artist.example/about"]);
  });
  it("conserva el final de páginas largas y citas que cruzan fragmentos", () => {
    const source = { ...page, content: "x".repeat(25000) + "Dato histórico al final." };
    const chunks = musicalSourceChunks(source, 10000);
    expect(chunks.at(-1)).toContain("Dato histórico al final.");
    expect(chunks[0]!.slice(-600)).toBe(chunks[1]!.slice(0,600));
  });
  it("en Bandcamp solo lee el texto visible: el JSON-LD se parsea sin IA", () => {
    const album = { ...page, url: "https://banda.bandcamp.com/album/disco", content: "JSON-LD 1 /offers/price: 7\nJSON-LD 1 /track/itemListElement/0/item/name: Tema\nBanda Venezuela was founded in 2003.\n   \n\n\nCredits: Fernando (Guitar)\nEnlaces de la página:\nhttps://banda.bandcamp.com/" };
    expect(leanMusicalChunks(album)).toEqual(["Banda Venezuela was founded in 2003.\n\nCredits: Fernando (Guitar)"]);
    expect(leanMusicalChunks({ ...album, url: "https://banda.example/bio" })).toEqual(musicalSourceChunks({ ...album, url: "https://banda.example/bio" }));
  });
  it("conserva procedencia y deja las citas inventadas o inciertas pendientes", () => {
    expect(factEvidence(fact, page)).toMatchObject({ url: page.url, quote: page.content, contentHash: page.contentHash, capturedAt: page.capturedAt, origin: "page" });
    expect(factEvidence({ ...fact, quote: "Fernando fundó otra banda en 1999." }, page)).toBeNull();
    expect(factEvidence({ ...fact, uncertainty: "Texto ilegible" }, page)).toBeNull();
    expect(factEvidence(fact, { ...page, origin: "search_snippet" })).toBeNull();
  });
  it("recupera categorías descriptivas antiguas conservando valor y cita y rechaza respuestas malformadas", () => {
    const recovered = recoverMusicalExtraction({ facts: [{ ...fact, kind: "band_formation" }, { ...fact, kind: "new_historical_category" }], unreadable: [] });
    expect(recovered.facts[0]).toEqual({ ...fact, kind: "formation" });
    expect(recovered.facts[1]).toEqual({ ...fact, kind: "biographical_event" });
    expect(() => recoverMusicalExtraction({ facts: [{ kind: "band_member" }], unreadable: [] })).toThrow();
  });
});

afterEach(() => { vi.unstubAllGlobals(); });
describe("DeepSeek con imágenes capturadas", () => {
  const config = { baseUrl: "https://mock.invalid", models: { fast: "flash", reasoning: "pro", vision: "flash" }, maxTokens: 200, timeoutMs: 1000 };
  const image = { sourceUrl: "https://artist.example/credits.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
  const request = { taskKind: "vision_analysis" as const, schemaVersion: "vision-qa.v1", input: { source: image.sourceUrl }, instructions: "Leer créditos", responseSchema: z.object({ text: z.string() }), images: [image] };
  it("envía bloques image_url reales al proveedor", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ model: "flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ text: "Créditos" }) } }], usage: { prompt_tokens: 20, completion_tokens: 10 } })));
    vi.stubGlobal("fetch", fetcher);
    const gateway = new DeepSeekGateway({ ...config, apiKey: "fixture-key" }, new FetchDeepSeekTransport(), new MemoryDeepSeekRunStore());
    expect((await gateway.propose(request)).proposal.text).toBe("Créditos");
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { messages: Array<{ content: unknown }> };
    expect(body.messages[1]!.content).toEqual([{ type: "text", text: expect.stringContaining("INPUT JSON") }, { type: "image_url", image_url: { url: image.dataUrl, detail: "original" } }]);
  });
  it("el hash cambia al cambiar los bytes y el registro conserva hashes en lugar de base64", async () => {
    const transport = new MockDeepSeekTransport({ text: "Uno" }, { text: "Dos" });
    const store = new MemoryDeepSeekRunStore();
    const gateway = new DeepSeekGateway(config, transport, store);
    const first = await gateway.propose(request);
    expect((await gateway.propose(request)).cached).toBe(true);
    const second = await gateway.propose({ ...request, images: [{ ...image, dataUrl: "data:image/png;base64,iVBORw0KGgoB" }] });
    expect(first.promptHash).not.toBe(second.promptHash);
    expect(JSON.stringify([...store.runs.values()])).not.toContain(image.dataUrl);
  });
  it("rechaza imágenes remotas y modelos incompatibles antes de hacer red", async () => {
    const transport = new MockDeepSeekTransport();
    const gateway = new DeepSeekGateway(config, transport);
    await expect(gateway.propose({ ...request, images: [{ ...image, dataUrl: "http://127.0.0.1/image.png" }] })).rejects.toThrow(/data URL/);
    await expect(gateway.propose({ ...request, modelClass: "reasoning" })).rejects.toThrow(/no acepta imágenes/);
    await expect(gateway.propose({...request,schemaVersion:"x".repeat(31)})).rejects.toThrow(/schemaVersion/);
    expect(transport.requests).toHaveLength(0);
  });
});
