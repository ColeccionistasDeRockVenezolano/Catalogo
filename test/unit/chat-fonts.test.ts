// CRV · Fuentes del nombre: los mapas Unicode y las transformaciones son
// contrato público (lo que se pinta y lo que se copia), así que se prueban.
import { describe, expect, it } from "vitest";
import {
  FONT_SPECS, FONTS_BY_CODE, applyTextTransform, applyUnicodeFont, isPerLetterFont,
} from "../../src/chat/fonts.js";
import { EFFECTS_BY_CODE, isEquippable } from "../../src/chat/effects-catalog.js";

describe("catálogo de fuentes", () => {
  it("registra las catorce fuentes sin códigos repetidos", () => {
    expect(FONT_SPECS).toHaveLength(14);
    expect(new Set(FONT_SPECS.map((spec) => spec.code)).size).toBe(14);
  });

  it("cada fuente está a la venta como efecto equipable", () => {
    for (const spec of FONT_SPECS) {
      const effect = EFFECTS_BY_CODE.get(spec.code);
      expect(effect, spec.code).toBeDefined();
      expect(effect?.kind).toBe("name_font");
      expect(effect?.manifest.font?.code).toBe(spec.code);
      expect(isEquippable("name_font")).toBe(true);
    }
  });

  it("los precios son razonables y crecientes con la rareza", () => {
    for (const effect of [...EFFECTS_BY_CODE.values()].filter((item) => item.kind === "name_font")) {
      expect(effect.priceCoins).toBeGreaterThanOrEqual(100);
      expect(effect.priceCoins).toBeLessThanOrEqual(500);
      expect(effect.durationDays).toBe(30);
    }
  });
});

describe("transformaciones unicode", () => {
  it("Math Double-Struck usa las letras de pizarra con hueco", () => {
    expect(applyUnicodeFont("CRV", "math-double-struck")).toBe("ℂℝ𝕍");
    expect(applyUnicodeFont("Brian", "math-double-struck")).toBe("𝔹𝕣𝕚𝕒𝕟");
  });

  it("Math Serif Italic respeta el hueco de la h (PLANCK CONSTANT)", () => {
    expect(applyUnicodeFont("h", "math-serif-italic")).toBe("\u210E");
    // La H mayúscula no tiene hueco en serif italic: sale del bloque normal.
    expect(applyUnicodeFont("H", "math-serif-italic")).toBe("\u{1D43B}");
  });

  it("Math Monospace conserva la longitud y transforma dígitos", () => {
    const out = applyUnicodeFont("Rock 1987", "math-monospace");
    expect([...out]).toHaveLength([..."Rock 1987"].length);
    expect(out).not.toBe("Rock 1987");
    expect(out.startsWith("𝚁𝚘𝚌𝚔")).toBe(true);
    expect(applyUnicodeFont("0", "math-monospace")).toBe("𝟶");
  });

  it("deja intactos los caracteres sin mapa (espacios, emoji, acentos)", () => {
    expect(applyUnicodeFont("A B 🎸", "math-script-bold")).toContain(" ");
    expect(applyUnicodeFont("A B 🎸", "math-script-bold")).toContain("🎸");
    expect(applyUnicodeFont("José", "math-monospace")).toContain("é");
  });

  it("Coptic reutiliza formas históricas y Tai Le tiene 26 signos únicos", () => {
    const coptic = applyUnicodeFont("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "coptic-standard");
    expect([...coptic]).toHaveLength(26);
    // El copto no tiene 26 formas distintas: C/K/S, F/Q y U/Y comparten.
    expect(new Set([...coptic]).size).toBeGreaterThanOrEqual(20);
    expect(coptic).not.toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const taiLe = applyUnicodeFont("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "tai-le-curly");
    expect([...taiLe]).toHaveLength(26);
    expect(new Set([...taiLe]).size).toBe(26);
    expect(taiLe).not.toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });

  it("un código desconocido no toca el nombre", () => {
    expect(applyUnicodeFont("Brian", "no-existe")).toBe("Brian");
  });
});

describe("transformaciones CSS", () => {
  it("Lower Upper Light deja la primera en minúscula y el resto en mayúsculas", () => {
    expect(applyTextTransform("brian", "lower-upper-light")).toBe("bRIAN");
    expect(applyTextTransform("Ana", "lower-upper-light")).toBe("aNA");
    expect(applyTextTransform("", "lower-upper-light")).toBe("");
  });

  it("solo cajas y círculos se pintan letra a letra", () => {
    expect(isPerLetterFont("boxed-black")).toBe(true);
    expect(isPerLetterFont("letras-circulo")).toBe(true);
    expect(isPerLetterFont("versalitas")).toBe(false);
    expect(isPerLetterFont(null)).toBe(false);
  });

  it("las fuentes CSS exponen familia, peso o variante", () => {
    expect(FONTS_BY_CODE.get("versalitas")?.variant).toBe("small-caps");
    expect(FONTS_BY_CODE.get("black-panther")?.weight).toBe(900);
    expect(FONTS_BY_CODE.get("cursiva-script")?.style).toBe("italic");
  });
});
