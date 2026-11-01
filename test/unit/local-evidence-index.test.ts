import { describe, expect, it } from "vitest";
import { extractRecords, sourceOfPath } from "../../src/research/local-evidence-index.js";

describe("extracción de evidencia local", () => {
  it("lee un registro de Hippito con notas y créditos", () => {
    const line = JSON.stringify({
      artista: "Trino Mora", titulo: "Te Quiero Todavía", url: "https://hippito.example/trino",
      notas: "Grabado en Caracas en 1975.", creditos: ["Trino Mora — voz"], pistas: ["A1. Te quiero"],
    });
    const records = extractRecords(line, "/data/raw/deep-hippito/extract.jsonl", ".jsonl");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: "hippito", artistName: "Trino Mora", url: "https://hippito.example/trino" });
    expect(records[0]!.body).toContain("Grabado en Caracas");
  });

  it("lee una bio de RYM y conserva fuente, título y enlace", () => {
    const json = JSON.stringify({ name: "Yorghaki", bio: "Banda caraqueña de rock.", u: "https://rateyourmusic.com/artist/yorghaki" });
    const records = extractRecords(json, "/data/raw/fuentes-web/rym-bios/bio-yorghaki.json", ".json");
    expect(records[0]).toMatchObject({ source: "rym", artistName: "Yorghaki", url: "https://rateyourmusic.com/artist/yorghaki" });
    expect(records[0]!.artistKey).toBe("yorghaki");
  });

  it("clasifica RHV, RYM e Hippito por la ruta", () => {
    expect(sourceOfPath("/x/rockhecho-2026/dossier.json")).toBe("rhv");
    expect(sourceOfPath("/x/rym-reviews-2026/data.jsonl")).toBe("rym");
    expect(sourceOfPath("/x/deep-hippito-2026/extract.jsonl")).toBe("hippito");
  });

  it("no inventa registros con títulos vacíos o sin cuerpo", () => {
    expect(extractRecords(JSON.stringify({ name: "Solo nombre" }), "/x/a.json", ".json")).toEqual([]);
  });
});
