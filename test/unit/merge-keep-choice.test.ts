import { describe, expect, it } from "vitest";
import { chooseArtistKeep, type ArtistProfile } from "../../src/merge/artist-merge-run.js";
import { mergeAction } from "../../src/curation/actions/merge.js";
import { applicableActions, declaredActions } from "../../src/curation/actions/registry.js";
import type { ActionFinding } from "../../src/curation/actions/types.js";

function profile(id: number, name: string, counts: Partial<Pick<ArtistProfile, "albums" | "audiovisuals" | "members" | "aliases" | "claims">> = {}): ArtistProfile {
  const fill = <T>(items: T[] | undefined, make: (index: number) => T): T[] =>
    items ?? Array.from({ length: 0 }, make);
  return {
    id, name, artistType: "band", originCity: null, originCountry: null, formedYear: null, disbandedYear: null,
    yearsActive: null, status: null, biography: null, aliases: [], members: [], albums: [], audiovisuals: [], links: [],
    evidence: [], claims: 0, gallery: 0, documents: 0, mediaLinks: 0,
    ...counts,
    ...(counts.albums ? { albums: fill(counts.albums, (index) => ({ title: `Disco ${index}`, year: 2000 + index, type: "studio_album" })) } : {}),
    ...(counts.audiovisuals ? { audiovisuals: fill(counts.audiovisuals, (index) => ({ title: `Video ${index}`, year: 2000, videoId: index })) } : {}),
    ...(counts.members ? { members: fill(counts.members, (index) => ({ name: `Persona ${index}`, role: "Guitarra", from: null, to: null })) } : {}),
    ...(counts.aliases ? { aliases: fill(counts.aliases, (index) => `Alias ${index}`) } : {}),
  };
}

describe("elección de la ficha canónica en la fusión", () => {
  it("conserva Arca (85 discos, 36 audiovisuales) y no Nuuro (6 discos)", () => {
    const nuuro = profile(1250, "Nuuro", { albums: Array.from({ length: 6 }, () => ({ title: "x", year: 2005, type: "studio_album" })), members: Array.from({ length: 1 }, () => ({ name: "Alejandra", role: "Voz", from: null, to: null })), claims: 24 });
    const arca = profile(4235, "Arca", {
      albums: Array.from({ length: 85 }, () => ({ title: "x", year: 2010, type: "studio_album" })),
      audiovisuals: Array.from({ length: 36 }, () => ({ title: "v", year: 2010, videoId: 1 })),
      members: Array.from({ length: 1 }, () => ({ name: "Alejandra", role: "Voz", from: null, to: null })),
      aliases: Array.from({ length: 4 }, () => "alias"), claims: 38,
    });
    expect(chooseArtistKeep(nuuro, arca)).toBe(4235);
    expect(chooseArtistKeep(arca, nuuro)).toBe(4235);
  });

  it("a igualdad de contenido conserva el id menor", () => {
    expect(chooseArtistKeep(profile(20, "B"), profile(10, "A"))).toBe(10);
  });
});

describe("registro de la acción fusionar para el detector de evidencia", () => {
  const finding: ActionFinding = {
    id: 1, detector: "artistas_duplicados_evidencia", signature: "evidencia_determinista", status: "open",
    entity: { kind: "artist", id: 3230, label: "Kámara" },
    field: "name", value: "Kámara", suggestedValue: null,
    related: [{ kind: "artist", id: 8576, label: "La Kámara" }],
    title: "Kámara y La Kámara: misma página de evidencia",
    evidence: { pair: [3230, 8576] },
  };

  it("la ofrece y la pone en nivel 1 cuando hay evidencia determinista", () => {
    expect(declaredActions(finding.detector, finding.signature)).toContain("fusionar");
    expect(applicableActions(finding).map((action) => action.key)).toContain("fusionar");
    expect(mergeAction.appliesTo(finding)).toBe(true);
    // Los hallazgos ya guardados por la etapa 1 no llevaban `evidence.pair`:
    // el par se recupera de la ficha relacionada.
    expect(mergeAction.appliesTo({ ...finding, evidence: {} })).toBe(true);
    expect(mergeAction.levelFor(finding, null)).toBe(1);
  });

  it("baja a nivel 2 cuando la coincidencia es probable", () => {
    const probable = { ...finding, signature: "probable" };
    expect(mergeAction.levelFor(probable, null)).toBe(2);
  });
});
