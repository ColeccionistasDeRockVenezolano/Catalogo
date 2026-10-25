import { describe, expect, it } from "vitest";
import { albumClassificationBadges, albumFilterTypeLabel, albumTypeLabel, foreignCountry, knownFormat, memberRoleLabel, roleTitle } from "../../src/lib/labels";

describe("etiquetas del plan v2 (etapa 1)", () => {
  it("roles con mayúscula inicial, palabras menores en minúscula y siglas intactas", () => {
    expect(roleTitle("voz y guitarra")).toBe("Voz y Guitarra");
    expect(roleTitle("bajo")).toBe("Bajo");
    expect(roleTitle("Keyboards & Backing Vocals")).toBe("Keyboards & Backing Vocals");
    expect(roleTitle("mixed & mastered by")).toBe("Mixed & Mastered");
    expect(roleTitle("DJ y teclados")).toBe("DJ y Teclados");
    expect(memberRoleLabel("member")).toBe("Integrante");
    expect(memberRoleLabel("batería")).toBe("Batería");
  });

  it("Venezuela no se muestra: solo el país que rompe la regla", () => {
    expect(foreignCountry("Venezuela")).toBeNull();
    expect(foreignCountry(" venezuela ")).toBeNull();
    expect(foreignCountry(null)).toBeNull();
    expect(foreignCountry("Suecia")).toBe("Suecia");
  });

  it("«Unknown» no es un formato", () => {
    expect(knownFormat("Unknown")).toBeNull();
    expect(knownFormat("desconocido")).toBeNull();
    expect(knownFormat("CD")).toBe("CD");
  });

  it("Recopilatorio pasa a Compilado", () => {
    expect(albumTypeLabel("compilation")).toBe("Compilado");
  });
});

describe("etapa 2: chips de la discografía y tipos agrupados", () => {
  it("En vivo es una categoría complementaria y los tipos mixtos son visibles", () => {
    expect(albumFilterTypeLabel("live")).toBe("En vivo");
    expect(albumClassificationBadges({ albumType: "live_album", isLive: true })).toEqual([]);
    expect(albumClassificationBadges({ albumType: "single", isLive: true, isBSides: true }))
      .toEqual([{ key: "b_sides", label: "B-Sides" }, { key: "live", label: "En vivo" }]);
    expect(albumClassificationBadges({ albumType: "other", isLive: true, classifications: [{ classification: "EP" }] }))
      .toEqual([{ key: "live", label: "En vivo" }, { key: "ep", label: "EP" }]);
  });
  it("un EP puede ser remix e instrumental y tener edición Deluxe sin perder su tipo", async () => {
    const { discographyChipKeys } = await import("../../src/lib/labels");
    const album = { albumType: "ep", classifications: [{ classification: "Remix" }, { classification: "Instrumental" }], editionTypes: ["deluxe"] };
    expect(albumClassificationBadges(album)).toEqual([
      { key: "remix", label: "Remix" }, { key: "instrumental", label: "Instrumental" }, { key: "deluxe", label: "Deluxe" },
    ]);
    expect(discographyChipKeys(album)).toEqual(["ep", "remix", "instrumental", "deluxe"]);
    expect(albumFilterTypeLabel("acoustic")).toBe("Acústico");
    expect(albumFilterTypeLabel("remastered")).toBe("Remasterizado");
    expect(albumFilterTypeLabel("reissue")).toBe("Reedición");
  });
  it("cada disco cae en su chip; En Vivo y B-Sides aparte", async () => {
    const { discographyChipKeys, artistGroupFilterLabel } = await import("../../src/lib/labels");
    expect(discographyChipKeys({ albumType: "studio_album" })).toEqual(["studio_album"]);
    expect(discographyChipKeys({ albumType: "live_album", isLive: true })).toEqual(["live"]);
    expect(discographyChipKeys({ albumType: "single", isLive: true })).toEqual(["single", "live"]);
    expect(discographyChipKeys({ albumType: "other", isLive: true, classifications: [{ classification: "EP" }] })).toEqual(["live", "ep"]);
    expect(discographyChipKeys({ albumType: "other", isBSides: true })).toEqual(["b_sides"]);
    expect(discographyChipKeys({ albumType: "soundtrack" })).toEqual(["others"]);
    expect(artistGroupFilterLabel("band")).toBe("Bandas");
    expect(artistGroupFilterLabel("solo_artist")).toBe("Solistas");
    expect(artistGroupFilterLabel("duo")).toBe("Dúos");
  });
  it("B-Sides acumula sus tipos y Unplugged participa en Acústico sin inferir directo", async () => {
    const { discographyChipKeys } = await import("../../src/lib/labels");
    expect(discographyChipKeys({ albumType: "single", isBSides: true, classifications: [{ classification: "Remix" }] }))
      .toEqual(["single", "b_sides", "remix"]);
    expect(discographyChipKeys({ albumType: "compilation", isBSides: true })).toEqual(["compilation", "b_sides"]);
    expect(discographyChipKeys({ albumType: "live_album", isBSides: true, isLive: true })).toEqual(["live", "b_sides"]);
    expect(discographyChipKeys({ albumType: "demo", isBSides: true })).toEqual(["demo", "b_sides"]);
    const unplugged = { albumType: "ep", classifications: [{ classification: "Unplugged" }, { classification: "Acústico" }] };
    expect(discographyChipKeys(unplugged)).toEqual(["ep", "acoustic"]);
    expect(albumClassificationBadges(unplugged)).toEqual([{ key: "acoustic", label: "Acústico" }]);
  });
});
