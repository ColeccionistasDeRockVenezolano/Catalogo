import { describe, expect, it } from "vitest";
import {
  ARTIST_MERGE_INSTRUCTIONS, artistMergePolicy, chooseArtistKeep, missingAfterMerge, missingFields, type ArtistMergeVerdict, type ArtistProfile,
} from "../../src/review/artist-merge.js";
import type { ArtistCandidate } from "../../src/review/artist-candidates.js";

function candidate(a: string, b: string, signals = 2): ArtistCandidate {
  return {
    a: { id: 1, name: a }, b: { id: 2, name: b }, score: 1, deterministic: signals > 0, signals,
    priority: 8, features: [{ key: "shared_evidence_url", value: 0.5, evidence: "misma página" }],
  };
}

function verdict(overrides: Partial<ArtistMergeVerdict> = {}): ArtistMergeVerdict {
  return {
    decision: "same_identity", confidence: 0.95,
    evidence: [{ fact_id: "a.discografia", supports: "match" }, { fact_id: "b.integrantes", supports: "match" }],
    reasoning: "mismo disco y mismos músicos",
    data_gaps: ["ficha B sin año de formación"],
    identity_doubts: [],
    ...overrides,
  };
}

describe("política de fusión asistida por IA", () => {
  it("fusiona con misma identidad, confianza alta, dos hechos y señal determinista", () => {
    expect(artistMergePolicy(candidate("Kámara de Tortura", "La Kámara De la Tortura"), verdict()).merge).toBe(true);
  });

  it("un hueco de datos no bloquea; una duda de identidad sí", () => {
    expect(artistMergePolicy(candidate("A", "B"), verdict({ data_gaps: ["sin ciudad en B"] })).merge).toBe(true);
    const doubt = artistMergePolicy(candidate("A", "B"), verdict({ identity_doubts: ["otra ciudad y otra época"] }));
    expect(doubt.merge).toBe(false);
    expect(doubt.reason).toContain("dudó de la identidad");
  });

  it("exige dos hechos citados y confianza 0,85", () => {
    expect(artistMergePolicy(candidate("A", "B"), verdict({ evidence: [{ fact_id: "a.nombre", supports: "match" }] })).merge).toBe(false);
    expect(artistMergePolicy(candidate("A", "B"), verdict({ confidence: 0.84 })).merge).toBe(false);
    expect(artistMergePolicy(candidate("A", "B"), verdict({ confidence: 0.85 })).merge).toBe(true);
  });

  it("un hecho en contra o la falta de señal determinista impiden fusionar", () => {
    expect(artistMergePolicy(candidate("A", "B"), verdict({
      evidence: [{ fact_id: "a.nombre", supports: "match" }, { fact_id: "b.nombre", supports: "match" }, { fact_id: "b.origen", supports: "separate" }],
    })).merge).toBe(false);
    expect(artistMergePolicy(candidate("A", "B", 0), verdict()).merge).toBe(false);
  });

  it("dos nombres desambiguados distintos nunca se fusionan aunque la IA diga que sí", () => {
    const policy = artistMergePolicy(candidate("Nemesis", "Nemesis (Lara)"), verdict());
    expect(policy.merge).toBe(false);
    expect(policy.reason).toContain("desambiguados");
  });
});

describe("instrucciones de la IA del catálogo", () => {
  it("distinguen proyectos distintos de la misma persona y citan los casos CRV", () => {
    const text = ARTIST_MERGE_INSTRUCTIONS;
    expect(text).toContain("PROYECTOS distintos");
    expect(text).toContain("Nuuro");
    expect(text).toContain("Arca");
    expect(text).toContain("Nemesis (Lara)");
  });
});

describe("elección de la ficha que se conserva", () => {
  const profile = (id: number, name: string, counts: { albums?: number; audiovisuals?: number; members?: number }): ArtistProfile => ({
    id, name, artistType: "solo_artist", originCity: null, originCountry: "Venezuela", formedYear: null,
    disbandedYear: null, yearsActive: null, status: null, biography: null, aliases: [], members: Array.from({ length: counts.members ?? 0 }, () => ({ name: "X", role: "Voz", from: null, to: null })),
    albums: Array.from({ length: counts.albums ?? 0 }, (_, index) => ({ title: `Disco ${index}`, year: null, type: "studio_album" })),
    audiovisuals: Array.from({ length: counts.audiovisuals ?? 0 }, (_, index) => ({ title: `Video ${index}`, year: null, videoId: null })),
    links: [], evidence: [], claims: 0, gallery: 0, documents: 0, mediaLinks: 0,
  });

  it("conserva la ficha canónica con 85 discos aunque la otra tenga más integrantes", () => {
    const nuuro = profile(1250, "Nuuro", { albums: 6, members: 1 });
    const arca = profile(4235, "Arca", { albums: 85, audiovisuals: 36 });
    expect(chooseArtistKeep(nuuro, arca)).toBe(4235);
  });

  it("a igualdad de contenido conserva el id menor", () => {
    expect(chooseArtistKeep(profile(10, "A", { albums: 2 }), profile(9, "B", { albums: 2 }))).toBe(9);
  });
});

describe("verificación de pérdida tras la fusión", () => {
  const snapshot = (overrides: Partial<Parameters<typeof missingAfterMerge>[0]> = {}) => ({
    members: new Set<string>(), albums: new Set<string>(), audiovisuals: new Set<string>(),
    aliases: new Set<string>(), claims: 0, gallery: 0, documents: 0, mediaLinks: 0, ...overrides,
  });

  it("detecta integrantes, discos, audiovisuales y alias perdidos", () => {
    const before = snapshot({
      members: new Set(["gustavo guerrero", "carlos rojas"]), albums: new Set(["vampiro|2003"]),
      audiovisuals: new Set(["yt-1"]), aliases: new Set(["la kamara"]),
    });
    const after = snapshot({ members: new Set(["gustavo guerrero"]), albums: new Set(), audiovisuals: new Set(), aliases: new Set() });
    const missing = missingAfterMerge(before, after, "Kámara de Tortura");
    expect(missing.join(" | ")).toContain("integrantes: carlos rojas");
    expect(missing.join(" | ")).toContain("discos: vampiro|2003");
    expect(missing.join(" | ")).toContain("audiovisuales: yt-1");
    expect(missing.join(" | ")).toContain("alias: la kamara");
  });

  it("el nombre de la ficha que queda no cuenta como alias perdido", () => {
    const before = snapshot({ aliases: new Set(["la kamara"]) });
    expect(missingAfterMerge(before, snapshot(), "La Kamara")).toEqual([]);
  });

  it("detecta campos vacíos que el duplicado sí tenía", () => {
    const missing = missingFields({ formed_year: null, biography: "" }, { formed_year: 1978, biography: "historia" }, { formed_year: 1978, biography: "" });
    expect(missing).toEqual(["biography"]);
  });

  it("un año incompatible anotado en notas no cuenta como pérdida", () => {
    const missing = missingFields({ formed_year: null, disbanded_year: 1983 }, { formed_year: 2002 }, {
      formed_year: null, disbanded_year: 1983, notes: "Año de formación en el duplicado: 2002 (no aplicado: incompatible con su disolución)",
    });
    expect(missing).toEqual([]);
  });
});
