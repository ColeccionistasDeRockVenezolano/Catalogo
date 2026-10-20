// Venciclopedia: el parser de wikitexto es la pieza que puede perder datos en
// silencio (valores dentro de {{csv|…}} y {{fecha|…}}) o inventar artistas
// (categorías `Discos de salsa`). Este test fija las tres decisiones:
//   1. las plantillas anidadas se resuelven, no se borran;
//   2. el artista sale de las categorías, no de la prosa ni del sello;
//   3. la cara B de un LP no es un segundo disco.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VenciclopediaAdapter } from "../../src/adapters/venciclopedia.js";
import { normalizeRecord } from "../../src/normalization/claims.js";
import type { StoredPage } from "../../src/adapters/contracts.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "adapters", "venciclopedia.json");

function records() {
  const body = readFileSync(FIXTURE, "utf8");
  const page: StoredPage = { url: "https://www.venciclopedia.org/api.php?action=query", kind: "json", rawPageId: 1, body };
  return new VenciclopediaAdapter().extractSnapshot(page);
}

function albumFor(identity: string) {
  const album = records().find((record) => record.entityKind === "album" && record.identity === identity);
  if (!album) throw new Error(`falta el álbum ${identity}`);
  const value = (field: string) => album.fields.find((item) => item.field === field)?.value;
  return { album, value };
}

describe("adapter de Venciclopedia", () => {
  it("resuelve las plantillas anidadas en vez de vaciar el campo", () => {
    const { value } = albumFor("Sentimiento Muerto::Infecto de afecto");
    // `{{csv|Sonográfica}}` y `{{fecha|||1991|link=iso}}` llegan envueltos.
    expect(value("release_year")).toBe(1991);
    expect(value("label")).toBe("Sono-Rodven");
    expect(value("catalog_id")).toBe("449");
    expect(value("media_format")).toBe("Vinyl LP");
  });

  it("toma el artista de las categorías y no del sello", () => {
    const identities = records().filter((record) => record.entityKind === "album").map((record) => record.identity);
    expect(identities).toContain("Sentimiento Muerto::Infecto de afecto");
    // «Sono-Rodven» es el sello: si se colara como artista la identidad sería otra.
    expect(identities.some((identity) => identity.startsWith("Sono-Rodven::"))).toBe(false);
    // La página de artista no produce álbumes: produce su ficha de artista.
    expect(records().some((record) => record.entityKind === "artist" && record.identity === "La Misma Gente")).toBe(true);
  });

  it("numera la cara B como pistas del mismo disco", () => {
    const tracks = records().filter((record) => record.entityKind === "track" && record.identity.startsWith("Sentimiento Muerto::Infecto de afecto::"));
    const numbers = tracks.map((track) => track.fields.find((field) => field.field === "track_number")?.value);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const discs = new Set(tracks.map((track) => track.fields.find((field) => field.field === "disc_number")?.value));
    expect([...discs]).toEqual([1]);
  });

  it("convierte la duración a segundos y descarta lo que no es un tiempo", () => {
    const first = records().find((record) => record.identity === "Sentimiento Muerto::Infecto de afecto::1");
    expect(first?.fields.find((field) => field.field === "duration_seconds")?.value).toBe(207);
  });

  it("emite fichas de artista con origen, formación y disolución", () => {
    const artist = records().find((record) => record.entityKind === "artist" && record.identity === "Sentimiento Muerto");
    const value = (field: string) => artist?.fields.find((item) => item.field === field)?.value;
    expect(value("artist_type")).toBe("band");
    expect(value("origin_city")).toBe("Caracas");
    expect(value("formed_year")).toBe(1981);
    expect(value("disbanded_year")).toBe(1993);
  });

  it("produce claims normalizados con evidencia de la URL real", () => {
    const claims = records().flatMap(normalizeRecord);
    expect(claims.length).toBeGreaterThan(20);
    expect(claims.every((claim) => claim.evidence.url.startsWith("https://www.venciclopedia.org/index.php?title="))).toBe(true);
    expect(claims.some((claim) => claim.entityKind === "track" && claim.field === "duration_seconds")).toBe(true);
  });
});
