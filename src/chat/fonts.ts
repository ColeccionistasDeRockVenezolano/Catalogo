// CRV · Fuentes del nombre (name fonts).
//
// Dos motores, porque no todos los estilos son lo mismo:
//   unicode → el carácter ES el estilo (Mathematical Alphanumeric Symbols,
//             copto, tai le). Funciona sin cargar fuentes y se copia tal cual.
//   css     → el estilo es tipográfico (versalitas, cursiva, caja, círculo,
//             peso ligero). El texto subyacente sigue siendo legible.
//
// El nombre real nunca se guarda transformado: se transforma al pintar. Así
// una fuente se puede quitar o caducar sin tocar mensajes ni identidad.
export type FontEngine = "unicode" | "css" | "boxes" | "circles";

export interface FontSpec {
  readonly code: string;
  readonly name: string;
  readonly engine: FontEngine;
  readonly map?: Readonly<Record<string, string>>;
  readonly family?: string;
  readonly weight?: number;
  readonly style?: "normal" | "italic";
  readonly variant?: "normal" | "small-caps";
  readonly transform?: "none" | "lower-upper";
  readonly note: string;
}

/** Mapa A-Z/a-z (y dígitos) a partir del inicio de un bloque Unicode. */
function offsetMap(
  upper: number,
  lower: number,
  digits?: number,
  gaps: Record<string, string> = {},
): Record<string, string> {
  const map: Record<string, string> = {};
  for (let index = 0; index < 26; index += 1) {
    map[String.fromCharCode(65 + index)] = String.fromCodePoint(upper + index);
    map[String.fromCharCode(97 + index)] = String.fromCodePoint(lower + index);
  }
  if (digits) {
    for (let index = 0; index < 10; index += 1) {
      map[String(index)] = String.fromCodePoint(digits + index);
    }
  }
  return { ...map, ...gaps };
}

/** Tai Le no tiene mayúsculas: las minúsculas se desplazan para dar contraste. */
function taiLeMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (let index = 0; index < 26; index += 1) {
    map[String.fromCharCode(65 + index)] = String.fromCodePoint(0x1950 + index);
    map[String.fromCharCode(97 + index)] = String.fromCodePoint(0x1950 + ((index + 13) % 26));
  }
  return map;
}

const COPTIC: Record<string, string> = {
  A: "\u2C80", B: "\u2C82", C: "\u2C94", D: "\u2C86", E: "\u2C88", F: "\u03E4",
  G: "\u2C84", H: "\u2C8E", I: "\u2C92", J: "\u03EA", K: "\u2C94", L: "\u2C96",
  M: "\u2C98", N: "\u2C9A", O: "\u2C9E", P: "\u2CA0", Q: "\u03E4", R: "\u2CA2",
  S: "\u2C94", T: "\u2CA6", U: "\u2CA8", V: "\u2C82", W: "\u2CB0", X: "\u2CAC",
  Y: "\u2CA8", Z: "\u2CAE",
};

export const FONT_SPECS: readonly FontSpec[] = [
  {
    code: "lower-upper-light", name: "Lower Upper Light", engine: "css",
    weight: 300, transform: "lower-upper",
    note: "Primera letra en minúscula, el resto en mayúsculas, trazo fino.",
  },
  {
    code: "math-serif-italic", name: "Math Serif Italic v2", engine: "unicode",
    map: offsetMap(0x1D434, 0x1D44E, undefined, { h: "\u210E" }),
    note: "Serif cursiva matemática (𝑏𝑙𝑜𝑞𝑢𝑒 Mathematical Alphanumeric).",
  },
  {
    code: "math-monospace", name: "Math Monospace", engine: "unicode",
    map: offsetMap(0x1D670, 0x1D68A, 0x1D7F6),
    note: "Monoespaciada matemática, estilo terminal.",
  },
  {
    code: "math-script-bold", name: "Math Script (Royal) Bold", engine: "unicode",
    map: offsetMap(0x1D4D0, 0x1D4EA),
    note: "Caligráfica negrita con florituras.",
  },
  {
    code: "lilia", name: "Lilia", engine: "css",
    family: "\"Lilia\", \"Lucida Calligraphy\", \"Segoe Script\", cursive",
    style: "italic", weight: 500,
    note: "Caligrafía fina, con fallback a la cursiva del sistema.",
  },
  {
    code: "math-fraktur-bold", name: "Math Fraktur Bold - Edit", engine: "unicode",
    map: offsetMap(0x1D56C, 0x1D586),
    note: "Gótica alemana, la de los discos de metal.",
  },
  {
    code: "math-double-struck", name: "Math Double-Struck", engine: "unicode",
    map: offsetMap(0x1D538, 0x1D552, 0x1D7D8, {
      C: "\u2102", H: "\u210D", N: "\u2115", P: "\u2119", Q: "\u211A", R: "\u211D", Z: "\u2124",
    }),
    note: "Doble trazo de pizarra: ℕ𝕠𝕞𝕓𝕣𝕖.",
  },
  {
    code: "coptic-standard", name: "Coptic Standard", engine: "unicode",
    map: { ...COPTIC, ...Object.fromEntries(Object.entries(COPTIC).map(([key, value]) => [key.toLowerCase(), value])) },
    note: "Alfabeto copto: formas antiguas que recuerdan al latín.",
  },
  {
    code: "tai-le-curly", name: "Tai Le v2 ft. Canadian Curly", engine: "unicode",
    map: taiLeMap(),
    note: "Tai Le con curvas al estilo de la escritura canadiense.",
  },
  {
    code: "black-panther", name: "Black Panther", engine: "css",
    family: "\"Impact\", \"Haettenschweiler\", \"Arial Black\", sans-serif",
    weight: 900, style: "italic",
    note: "Impact negra inclinada, tipo cartel de concierto.",
  },
  {
    code: "boxed-black", name: "Boxed Black", engine: "boxes",
    note: "Cada letra en su caja negra, como un sello de la sala.",
  },
  {
    code: "cursiva-script", name: "Cursiva Script", engine: "css",
    family: "\"Segoe Script\", \"Brush Script MT\", \"Lucida Handwriting\", cursive",
    style: "italic", weight: 600,
    note: "Manuscrita de rotulador, para firmar el nombre.",
  },
  {
    code: "versalitas", name: "Versalitas (Pequeñas Mayúsculas)", engine: "css",
    variant: "small-caps", weight: 600,
    note: "Todas mayúsculas, las minúsculas a media altura.",
  },
  {
    code: "letras-circulo", name: "Letras en Círculo", engine: "circles",
    note: "Cada letra dentro de un aro, como un botón.",
  },
];

export const FONTS_BY_CODE: ReadonlyMap<string, FontSpec> =
  new Map(FONT_SPECS.map((spec) => [spec.code, spec]));

/** Convierte el nombre al alfabeto de la fuente (motor unicode). */
export function applyUnicodeFont(text: string, code: string): string {
  const spec = FONTS_BY_CODE.get(code);
  if (!spec?.map) return text;
  return [...text].map((char) => spec.map?.[char] ?? char).join("");
}

/** Transformación de caja del texto (motor css con `transform`). */
export function applyTextTransform(text: string, code: string): string {
  const spec = FONTS_BY_CODE.get(code);
  if (spec?.transform !== "lower-upper") return text;
  if (text.length === 0) return text;
  return text.charAt(0).toLowerCase() + text.slice(1).toUpperCase();
}

/** ¿La fuente se pinta letra a letra (cajas o círculos)? */
export function isPerLetterFont(code: string | null | undefined): boolean {
  if (!code) return false;
  const engine = FONTS_BY_CODE.get(code)?.engine;
  return engine === "boxes" || engine === "circles";
}

/** CSS de una fuente (familia, peso, estilo, versalitas). */
export function fontStyleFor(code: string | null | undefined): Record<string, string | number> {
  const spec = code ? FONTS_BY_CODE.get(code) : null;
  if (!spec) return {};
  return {
    ...(spec.family ? { fontFamily: spec.family } : {}),
    ...(spec.weight ? { fontWeight: spec.weight } : {}),
    ...(spec.style ? { fontStyle: spec.style } : {}),
    ...(spec.variant ? { fontVariant: spec.variant === "small-caps" ? "small-caps" : "normal" } : {}),
  };
}
