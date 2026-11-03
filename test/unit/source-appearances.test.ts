import { describe, expect, it } from "vitest";
import { appearanceTrackTitle, combineAppearanceTitles, documentedReleaseTracks, matchingAppearanceTracks, sourcePerformerIsArtist } from "../../src/discography/source-appearances.js";

describe("participaciones documentadas sin inventar pistas", () => {
  it("reconoce un prefijo del intérprete exacto y conserva los títulos de otros artistas", () => {
    const rows = [{ id: 1, title: "Kashmir - No Se Decir Adiós" }, { id: 2, title: "Ibiza - No Se Decir Adiós" }];
    expect(matchingAppearanceTracks(rows, "No se decir adiós", ["Kashmir"])).toEqual([rows[0]]);
    expect(appearanceTrackTitle("Kashmir II - No Puede Ser", ["Kashmir"])).toBe("Kashmir II - No Puede Ser");
  });
  it("conserva repeticiones ambiguas para revisión y no hace coincidencias parciales", () => {
    expect(matchingAppearanceTracks([{ title: "Kashmir - No Puede Ser" }, { title: "No puede ser" }], "No puede ser", ["Kashmir"])).toHaveLength(2);
    expect(matchingAppearanceTracks([{ title: "Ya No Puede Ser" }], "No puede ser", ["Kashmir"])).toEqual([]);
  });
  it("combina evidencia parcial con los títulos del catálogo sin duplicarlos", () => {
    expect(combineAppearanceTitles(["Kashmir - No Se Decir Adiós"], ["No se decir adiós", "No puede ser"], ["Kashmir"]))
      .toEqual(["No Se Decir Adiós", "No puede ser"]);
  });
  it("no inventa pistas a partir del título de un sencillo y conserva la lista documentada más completa", () => {
    expect(documentedReleaseTracks([{ tracks: [] }])).toEqual([]);
    expect(documentedReleaseTracks([{ tracks: [{ title: "A / B" }] }, { tracks: [] }])).toEqual([{ title: "A / B" }]);
  });
  it("admite artículo y colaboración explícita sin atribuir menciones de invitados a otra banda", () => {
    expect(sourcePerformerIsArtist("el Grupo Acuario", ["Grupo Acuario"])).toBe(true);
    expect(sourcePerformerIsArtist("Gaélica (con Anaís Vivas)", ["Gaêlica"])).toBe(true);
    expect(sourcePerformerIsArtist("otras bandas con Paul Gillman como invitado", ["Paul Gillman"])).toBe(false);
    expect(sourcePerformerIsArtist("Frank Quintero y Los Balzehaguaos", ["Frank Quintero"])).toBe(false);
  });
});
