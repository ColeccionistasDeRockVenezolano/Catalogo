import { describe, expect, it } from "vitest";
import { bandVariantKey } from "../../src/curation/detectors/duplicates.js";
import { composeNicknameName, displayKey, markPublicAliases } from "../../src/normalization/public-names.js";

const alias = (value: string, aliasType = "name_variant") => ({ alias: value, aliasType });

describe("markPublicAliases (plan del primo, punto 10)", () => {
  it("oculta el alias igual al nombre aunque cambien mayúsculas o tildes", () => {
    const marked = markPublicAliases("DJ Afro", [alias("Dj Afro"), alias("DJ Afro"), alias("Cheo")]);
    expect(marked.map((item) => item.publicHidden)).toEqual([true, true, false]);
  });

  it("oculta los repetidos entre sí y las variantes de fuente", () => {
    const marked = markPublicAliases("José Luis Pardo", [
      alias("Jose Luis Pardo"), alias("J. L. Pardo"), alias("j. l. pardo"), alias("Atkinson - La Banda", "source_variant"),
    ]);
    expect(marked.map((item) => item.publicHidden)).toEqual([true, false, true, true]);
  });

  it("no toca nada más", () => {
    expect(displayKey("  Ñandú   «Rock» ")).toBe('nandu "rock"');
  });
});

describe("composeNicknameName (plan del primo, punto 2)", () => {
  it("respeta la posición que ya trae una fuente", () => {
    expect(composeNicknameName("José Luis Pardo", [alias("Cheo", "nickname"), alias('José Luis "Cheo" Pardo')]))
      .toBe('José Luis "Cheo" Pardo');
    expect(composeNicknameName("Carlos Eduardo Troconis", [alias("Cayayo", "nickname"), alias("Carlos Eduardo “Cayayo” Troconis")]))
      .toBe('Carlos Eduardo "Cayayo" Troconis');
  });

  it("sin posición conocida, el apodo va tras el nombre de pila", () => {
    expect(composeNicknameName("Tirone González", [alias("Canserbero", "nickname")])).toBe('Tirone "Canserbero" González');
    expect(composeNicknameName("Juan Carlos Pérez", [alias("Juanca", "nickname")])).toBe('Juan Carlos "Juanca" Pérez');
    expect(composeNicknameName("Tirone González Orama", [alias("Canserbero", "nickname")])).toBe('Tirone "Canserbero" González Orama');
  });

  it("sin alias de apodo, o si el nombre ya lo lleva, no compone", () => {
    expect(composeNicknameName("José Luis Pardo", [alias('José Luis "Cheo" Pardo')])).toBeNull();
    expect(composeNicknameName("Cayayo Troconis", [alias("Cayayo", "nickname")])).toBeNull();
    expect(composeNicknameName("Cayayo", [alias("Cayayo", "nickname")])).toBeNull();
  });
});

describe("bandVariantKey (plan del primo, punto 1)", () => {
  it("junta un número en cifra y en letra", () => {
    expect(bandVariantKey("1ra Edición")).toBe(bandVariantKey("Primera Edición"));
    expect(bandVariantKey("4to Poder")).toBe(bandVariantKey("Cuarto Poder"));
  });
  it("quita el envoltorio de banda", () => {
    expect(bandVariantKey("La Banda de la Banana Voladora")).toBe(bandVariantKey("La Banana Voladora"));
    expect(bandVariantKey("Atkinson - La Banda")).toBe(bandVariantKey("Atkinson"));
  });
  it("no junta nombres distintos", () => {
    expect(bandVariantKey("Segunda Piel")).not.toBe(bandVariantKey("Piel"));
    expect(bandVariantKey("Los Dementes")).not.toBe(bandVariantKey("Dementes Dos"));
  });
});

describe("markPublicAliases con el nombre compuesto", () => {
  it("oculta el alias que ya sale como título", () => {
    const marked = markPublicAliases("José Luis Pardo", [alias('José Luis "Cheo" Pardo'), alias("Cheo", "nickname")], ['José Luis "Cheo" Pardo']);
    expect(marked.map((item) => item.publicHidden)).toEqual([true, false]);
  });
});
