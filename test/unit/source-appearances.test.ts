import { describe, expect, it } from "vitest";
import { appearanceTrackTitle, combineAppearanceTitles, matchingAppearanceTracks } from "../../src/discography/source-appearances.js";

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
});
