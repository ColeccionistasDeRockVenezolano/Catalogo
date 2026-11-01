import { describe, expect, it } from "vitest";
import { buildDossier, type ArtistProfile } from "../../src/review/artist-merge.js";
import type { LocalEvidence } from "../../src/research/local-evidence.js";

function profile(id: number, name: string): ArtistProfile {
  return {
    id, name, artistType: "band", originCity: null, originCountry: null,
    formedYear: null, disbandedYear: null, yearsActive: null, status: null, biography: null,
    aliases: [], members: [], albums: [], audiovisuals: [], links: [], evidence: [],
    claims: 0, gallery: 0, documents: 0, mediaLinks: 0,
  };
}

describe("dosier con evidencia local", () => {
  it("cita la fuente, el enlace y el fragmento sin volcar el archivo", () => {
    const evidence: LocalEvidence[] = [{
      source: "rhv", title: "Ficha", url: "https://rockhechovenezuela.com/a/yorghaki/",
      artistName: "Yorghaki", capturedAt: null, score: 0.4,
      snippet: "Banda caraqueña de rock alternativo formada en 2004.",
    }];
    const dossier = buildDossier(profile(1, "Yorghaki"), profile(2, "Yorghaki (2)"),
      { score: 1, signals: 1, deterministic: true, features: [] }, [], evidence);
    const fact = dossier.facts.find((item) => item.id === "fuente.1");
    expect(fact?.text).toContain("Fuente local rhv");
    expect(fact?.text).toContain("https://rockhechovenezuela.com/a/yorghaki/");
    expect(fact?.text).toContain("Banda caraqueña");
    expect(dossier.localEvidence).toHaveLength(1);
  });
});
