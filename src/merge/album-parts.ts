// CRV · Partes de un disco partido en varias fichas (Brian, 2026-10-11).
//
// «Live in Paris - Lado A», «Goma (Disco B)», «La Mejor Salsa. Disco 1»,
// «18 años de Ska dvd», «Diez Años Vol. 3»: el título lleva al final la parte
// del disco. `albumPart` separa la base («Live in Paris») de la parte
// («Lado A»), que es el nombre que la fuente le da a esa lista de pistas y el
// que la página muestra sobre ella (`public.album_discs`, 0063).
//
// Reglas de Brian: lados, CD/disco N, partes y DVD van siempre en una página;
// un «Vol. N» solo si es del mismo año que su pareja (lo decide quien llama) y
// nunca un título que sea solo «Vol. N» o «Artista Vol. N» (LPs aparte); una
// reedición («(CD Reissue)», «(Cassette)», «Deluxe Edition») va en la página
// de la original aunque sea de otro año. Un «(Single)» no es reedición: el
// sencillo es otro disco aunque se llame igual que el álbum.

export type AlbumPartKind = "lado" | "disco" | "parte" | "volumen" | "formato" | "edicion";

export interface AlbumPart {
  /** El título sin la parte: «Live in Paris». */
  base: string;
  /** La parte tal como la escribe la fuente, con mayúscula inicial: «Lado A», «CD 2», «DVD». */
  label: string;
  kind: AlbumPartKind;
  /** Orden dentro de la serie (A=1, B=2, II=2); null en «DVD», «CD Reissue» y demás partes sin número. */
  order: number | null;
}

const ROMAN: Readonly<Record<string, number>> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const WORD_NUMBER: Readonly<Record<string, number>> = { uno: 1, dos: 2, tres: 3, cuatro: 4, one: 1, two: 2, three: 3 };

const KIND: Readonly<Record<string, AlbumPartKind>> = {
  lado: "lado", side: "lado", cara: "lado",
  cd: "disco", disco: "disco", disc: "disco", disk: "disco",
  parte: "parte", part: "parte",
  vol: "volumen", volumen: "volumen", volume: "volumen", volúmen: "volumen",
};

// Separadores antes de la parte: espacio, guion, raya, dos puntos, coma, punto o paréntesis.
const SEPARATOR = String.raw`[\s\-–—:,.]*[(\[]?\s*`;
const MARKER = String.raw`(lado|side|cara|cd|disco|disc|disk|parte|part|vol(?:umen|ume|úmen)?\.?)\s*(\d{1,2}|[ivx]{1,4}|[ab]|uno|dos|tres|cuatro|one|two|three)(?:\s*(?:\/|de|of)\s*\d{1,2})?`;
const NUMBERED = new RegExp(String.raw`^(.*?\S)${SEPARATOR}${MARKER}\s*[)\]]?\s*$`, "iu");
const FORMAT = new RegExp(String.raw`^(.*?\S)${SEPARATOR}(cd\s*\/\s*dvd|dvd\s*\/\s*cd|dvd|cd|lp)\s*[)\]]?\s*$`, "iu");
const EDITION = new RegExp(String.raw`^(.*?\S)${SEPARATOR}((?:(?:cd|lp|vinyl|vinilo)\s+)?(?:reissue|re-?edici[oó]n|remaster(?:ed|izado)?)|cassette|casete|(?:super\s+)?deluxe(?:\s+[\p{L}]+)?\s+edition|edici[oó]n\s+(?:especial|de\s+lujo|aniversario))\s*[)\]]?\s*$`, "iu");
// «Serie de Autores - Vol. I, Manuel Alejandro»: el volumen en medio del título.
const MIDDLE_VOLUME = /^(.*?\S)[\s\-–—:,.]*\b(vol(?:umen|ume)?\.?)\s*(\d{1,2}|[ivx]{1,4})\b([\s\-–—:,.]+)(\S.*)$/iu;

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase("es") + word.slice(1).toLocaleLowerCase("es");
}

function orderOf(token: string): number | null {
  const lower = token.toLocaleLowerCase("es");
  if (/^\d+$/u.test(lower)) return Number(lower);
  if (lower === "a") return 1;
  if (lower === "b") return 2;
  return ROMAN[lower] ?? WORD_NUMBER[lower] ?? null;
}

// «18 años de Ska (2003) dvd»: el año entre paréntesis tampoco es parte del título.
const cleanBase = (value: string): string => value.replace(/[\s\-–—:,.([]+$/u, "").replace(/\s*\((?:19|20)\d{2}\)$/u, "").trim();

// Filtro previo: toda parte lleva una de estas palabras. Los patrones de arriba
// anclan un prefijo perezoso y recorren el título entero; sin esto, el detector
// de discos partidos pasaba por ellos en todos los discos del catálogo.
const MAY_HAVE_PART = /lado|side|cara|cd|dis[ck]|part|vol|dvd|lp|reissue|edici|remaster|casset|casete|deluxe/iu;

/** La parte del disco al final del título, o null si no la lleva. */
export function albumPart(title: string): AlbumPart | null {
  const value = title.trim();
  if (!MAY_HAVE_PART.test(value)) return null;
  const numbered = NUMBERED.exec(value);
  if (numbered) {
    const [, rawBase, rawWord, rawToken] = numbered;
    const wordKey = rawWord!.toLocaleLowerCase("es").replace(/\.$/u, "");
    const kind = KIND[wordKey] ?? "volumen";
    const order = orderOf(rawToken!);
    const base = cleanBase(rawBase!);
    if (!base || order === null) return null;
    // «Vol.»/«Volumen» se escriben como la fuente; las letras y romanos, en mayúscula.
    const word = kind === "disco" && wordKey === "cd" ? "CD" : kind === "volumen" && wordKey === "vol" ? "Vol." : capitalize(rawWord!.replace(/\.$/u, ""));
    const token = /^\d+$/u.test(rawToken!) ? rawToken! : /^[ivxab]+$/iu.test(rawToken!) ? rawToken!.toLocaleUpperCase("es") : rawToken!.toLocaleLowerCase("es");
    return { base, label: `${word} ${token}`, kind, order };
  }
  const edition = EDITION.exec(value);
  if (edition) {
    const base = cleanBase(edition[1]!);
    if (!base) return null;
    const label = edition[2]!.replace(/\s+/gu, " ").split(" ")
      .map((word) => /^(cd|lp)$/iu.test(word) ? word.toLocaleUpperCase("es") : capitalize(word)).join(" ");
    return { base, label, kind: "edicion", order: null };
  }
  const middle = MIDDLE_VOLUME.exec(value);
  if (middle) {
    const [, before, rawWord, rawToken, separator, after] = middle;
    const order = orderOf(rawToken!);
    const pre = cleanBase(before!);
    if (!pre || order === null) return null;
    const joint = separator!.includes(",") ? ", " : /[-–—]/u.test(separator!) ? " - " : " ";
    const word = rawWord!.toLocaleLowerCase("es").replace(/\.$/u, "") === "vol" ? "Vol." : capitalize(rawWord!.replace(/\.$/u, ""));
    const token = /^\d+$/u.test(rawToken!) ? rawToken! : rawToken!.toLocaleUpperCase("es");
    return { base: `${pre}${joint}${after!.trim()}`, label: `${word} ${token}`, kind: "volumen", order };
  }
  const format = FORMAT.exec(value);
  if (format) {
    const base = cleanBase(format[1]!);
    if (!base) return null;
    return { base, label: format[2]!.replace(/\s+/gu, "").toLocaleUpperCase("es"), kind: "formato", order: null };
  }
  return null;
}
