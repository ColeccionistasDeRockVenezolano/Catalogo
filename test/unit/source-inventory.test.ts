import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { inventoryResearchUrls, inventorySummary, loadSourceInventory, sourceInventorySchema } from "../../src/verification/source-inventory.js";
import { researchVerification, type ResearchState } from "../../src/verification/research.js";
import { DeepSeekGateway, MemoryDeepSeekRunStore, MockDeepSeekTransport } from "../../src/ai/gateway.js";
import type { VerificationSnapshot } from "../../src/verification/types.js";

const snapshot = (name: string, kind: VerificationSnapshot["kind"] = "artist"): VerificationSnapshot => ({
  kind, id: 1, name, identity: [name], units: [], albums: [], catalogAlbums: [], sourceUrls: [],
});
const gateway = () => new DeepSeekGateway({ baseUrl: "https://example.com", models: { fast: "mock", reasoning: "mock", vision: "mock" }, maxTokens: 4096, timeoutMs: 1000 },
  new MockDeepSeekTransport({ findings: [], discoveries: [] }), new MemoryDeepSeekRunStore());

describe("inventario de fuentes para investigación dirigida", () => {
  it("valida el inventario y calcula conteos sin adoptar los números del informe original", () => {
    const inventory = loadSourceInventory();
    expect(inventorySummary(inventory)).toMatchObject({ projects: 34, discoverySources: 2, urls: 53, criticalProjects: 8, pageRead: 42, indexedOnly: 5, fetchFailed: 6, researchEntrypoints: 36 });
    expect(inventory.policy.catalogAutoImport).toBe(false);
    expect(inventory.projects.flatMap(project => project.sources).filter(source => source.sourceType === "artist_bandcamp")
      .every(source => source.authorityStatus === "unverified")).toBe(true);
  });
  it("rechaza inventarios que habilitan páginas no leídas o repiten URL", () => {
    const inventory = loadSourceInventory();
    const first = inventory.projects[0]!.sources[0]!;
    first.verificationStatus = "indexed_only";
    first.accessedAt = null;
    expect(sourceInventorySchema.safeParse(inventory).success).toBe(false);
    first.verificationStatus = "page_read";
    first.accessedAt = first.checkedAt;
    inventory.projects[1]!.sources.push(first);
    expect(sourceInventorySchema.safeParse(inventory).success).toBe(false);
  });
  it("normaliza tildes y aliases explícitos, sin buscar por fragmentos ni proyectos relacionados", () => {
    expect(inventoryResearchUrls(snapshot("  ZAPATO3  "))).toEqual(["https://www.zapato3.com/biografia"]);
    expect(inventoryResearchUrls(snapshot("Simon Diaz", "person"))).toEqual(["https://simondiaz.com/biografia/"]);
    expect(inventoryResearchUrls(snapshot("Zapato"))).toEqual([]);
    const unrelated = snapshot("Un Perfecto Extraño");
    unrelated.identity.push("Zapato 3");
    expect(inventoryResearchUrls(unrelated)).toEqual([]);
    expect(inventoryResearchUrls(snapshot("Zapato 3", "person"))).toEqual([]);
    expect(inventoryResearchUrls(snapshot("Zapato 3", "organization"))).toEqual([]);
  });
  it("excluye países incompatibles, páginas fallidas y directorios generales", () => {
    const foreign = snapshot("Zeta");
    foreign.identityProfile = { names: ["Zeta"], legalNames: [], relatedNames: [], repertoire: [], country: "Reino Unido" };
    expect(inventoryResearchUrls(foreign)).toEqual([]);
    expect(inventoryResearchUrls(snapshot("Yordano"))).toEqual([]);
    expect(inventoryResearchUrls(snapshot("MúsicaVenezuela"))).toEqual([]);
    expect(inventoryResearchUrls(snapshot("Jorge Glem", "person"))).not.toContain("https://www.jorgeglem.com/proyectos/");
  });
  it("selecciona el artista del disco o pista y excluye fichas de otros lanzamientos", () => {
    const album = snapshot("Tiempo al Tiempo", "album");
    album.albums = [{ id: album.id, artist: "C4 Trío", title: album.name, year: 2019 }, { id: 2, artist: "Los Mentas", title: "Otro disco", year: null }];
    expect(inventoryResearchUrls(album)).toEqual(["https://www.c4trio.com/en/discografia/", "https://www.c4trio.com/en/album/tiempo-al-tiempo/"]);
    const track = snapshot("Añoranza", "track");
    track.identityProfile = { names: [track.name], legalNames: [], relatedNames: [], repertoire: [], country: null, artist: "C4 Trío", album: "Tiempo al Tiempo" };
    expect(inventoryResearchUrls(track)).toEqual(inventoryResearchUrls(album));
    expect(inventoryResearchUrls(snapshot("C4 Trío", "album"))).toEqual([]);
  });
  it("adquiere la fuente una sola vez, conserva procedencia y reanuda sin repetir búsquedas", async () => {
    const subject = snapshot("Los Mentas");
    const url = inventoryResearchUrls(subject)[0]!;
    subject.sourceUrls = [url];
    const content = "Los Mentas. Museo de Los Pillos. Producción: Los Mentas. Grabado entre 2020 y 2021.";
    const page = { url, title: subject.name, content, contentHash: createHash("sha256").update(content).digest("hex"), fetchedAt: "2026-10-13T20:00:00Z", capturedAt: "2026-10-13T20:00:00Z", readAt: "2026-10-13T20:01:00Z", acquisitionMethod: "http" as const };
    let downloads = 0, searches = 0, state: ResearchState | undefined;
    const broker = { search: async () => { searches++; return []; }, page: async (requested: string) => { expect(requested).toBe(url); downloads++; return page; } };
    const paused = await researchVerification(subject, broker, gateway(), undefined, {
      control: async () => downloads ? "paused" : "continue", onState: async value => { state = value; },
    });
    expect(paused.research?.stopReason).toBe("paused");
    expect(state?.pages).toEqual([page]);
    const previousSearches = searches;
    const finished = await researchVerification(subject, broker, gateway(), undefined, { resume: state! });
    expect(downloads).toBe(1);
    expect(searches).toBe(previousSearches);
    expect(finished.research?.sources).toEqual([expect.objectContaining({ url, capturedAt: page.capturedAt, contentHash: page.contentHash, status: "completely_read" })]);
    expect(finished.evaluation?.complete).toBe(true);
  });
  it("la reevaluación de evidencia conservada no descarga páginas del inventario", async () => {
    const report = await researchVerification(snapshot("C4 Trío"), {
      search: async () => { throw new Error("No se permite buscar"); },
      page: async () => { throw new Error("No se permite descargar"); },
    }, gateway(), undefined, { preservedOnly: true });
    expect(report.research?.sources).toEqual([]);
  });
});
