// CRV · Filtro de texto del chat: limpieza, malas palabras, apodos reservados
// y enlaces.
//
// Dos niveles: las groserías se ENMASCARAN (el mensaje sale con ✱✱✱) y los
// insultos de odio o discriminación se BLOQUEAN (el mensaje no sale). Lo que
// depende del contexto («mono», «retrasado», frases sin palabra prohibida) no
// está aquí: lo clasifica DeepSeek después del envío (ai-review.ts).
//
// Interjecciones venezolanas de uso diario («coño», «marico», «güevón») NO se
// enmascaran: en una sala de rock venezolano son trato entre panas, y
// taparlas convertiría el filtro en ruido. Sí se tapan los insultos fuertes.
//
// La comparación se hace sobre un «esqueleto»: Unicode compatible (NFKC),
// sin acentos, minúsculas, homoglifos cirílicos/griegos a latín, l33t a
// letras y letras repetidas colapsadas («puuuuta», «p0t4», «рutа» → «puta»).
// La «ñ» se conserva distinta para que «coño» no choque con «cono».

/** Saltos de línea máximos por mensaje (9 líneas). */
export const MAX_LINE_BREAKS = 8;

// Ancho cero, BOM, separadores invisibles, controles bidireccionales (que
// invierten el texto, como U+202E), etiquetas Unicode y relleno Hangul.
// eslint-disable-next-line no-misleading-character-class -- son marcas sueltas a propósito: se borran
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;
// Controles C0/C1 salvo salto de línea y tabulador.
// eslint-disable-next-line no-control-regex -- quitar controles es justo lo que se busca
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
// «Zalgo»: más de dos marcas combinantes seguidas.
const ZALGO = /(\p{M}{2})\p{M}+/gu;

const CONFUSABLES: Record<string, string> = {
  // Cirílico
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p",
  "с": "c", "т": "t", "у": "y", "х": "x", "і": "i", "ї": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ԛ": "q", "ԝ": "w",
  // Griego
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p",
  "τ": "t", "υ": "u", "χ": "x", "ω": "w", "ς": "s", "σ": "o",
  // Latín extendido que no se descompone
  "ł": "l", "ø": "o", "đ": "d", "ħ": "h", "ı": "i", "ß": "ss", "æ": "ae", "œ": "oe",
};

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "€": "e", "¡": "i",
};

/** Quita invisibles, controles y zalgo. No toca el texto visible. */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "").replace(CONTROL, "").replace(ZALGO, "$1");
}

function foldChar(char: string): string {
  const lower = char.toLowerCase();
  if (lower === "ñ") return "ñ";
  const mapped = CONFUSABLES[lower] ?? LEET[lower] ?? lower;
  return mapped.normalize("NFKD").replace(/\p{M}/gu, "");
}

/** Esqueleto de una palabra: solo letras, plegadas y sin repeticiones. */
export function skeleton(word: string): string {
  let out = "";
  for (const char of stripInvisible(word).normalize("NFKC")) {
    const folded = foldChar(char);
    for (const piece of folded) {
      if (!/[a-zñ]/u.test(piece)) continue;
      if (out.endsWith(piece)) continue;
      out += piece;
    }
  }
  return out;
}

// ── Léxico ─────────────────────────────────────────────────────────────────
// Entradas exactas (palabra completa) y raíces (`*` final: cualquier palabra
// que empiece así). Se comparan ya convertidas a esqueleto.

const MASK_WORDS = [
  "puta", "putas", "puto", "putos", "putica", "hijueputa", "hijueputas", "jueputa", "mierda*", "mamaguevo*",
  "mamahuevo*", "mamagueb*", "coñoetumadre", "coñoetumare", "conchetumadre", "conchesumadre", "malparid*",
  "gonorrea", "verga", "vergas", "vergacion", "cabron", "cabrona", "cabrones", "pendej*",
  "culiao", "culiado", "follar", "chingad*", "chingar",
  "fuck*", "motherfuck*", "shit", "shitty", "bullshit", "bitch*", "cunt*", "asshole*", "dickhead*",
];

const BLOCK_WORDS = [
  // Homofobia y transfobia
  "maricon", "maricones", "maricona", "mariconazo", "bollera", "bolleras", "tortillera", "tortilleras",
  "travelo", "travelos", "faggot*", "fag", "fags", "tranny", "trannies", "dyke", "dykes",
  // Racismo y xenofobia (incluida la que sufren los venezolanos)
  "veneco", "venecos", "veneca", "venecas", "sudaca", "sudacas", "negrata", "negratas", "nigger*", "nigga*",
  "chink*", "spic", "spics", "kike", "kikes", "wetback*", "beaner*",
  // Capacitismo
  "mongolic*", "subnormal", "subnormales", "retard", "retards", "retarded",
];

interface Lexicon { exact: Set<string>; stems: string[] }

function buildLexicon(words: string[]): Lexicon {
  const exact = new Set<string>();
  const stems: string[] = [];
  for (const word of words) {
    if (word.endsWith("*")) stems.push(skeleton(word.slice(0, -1)));
    else exact.add(skeleton(word));
  }
  return { exact, stems };
}

const MASK = buildLexicon(MASK_WORDS);
const BLOCK = buildLexicon(BLOCK_WORDS);

function inLexicon(lexicon: Lexicon, word: string): boolean {
  if (word.length < 2) return false;
  return lexicon.exact.has(word) || lexicon.stems.some((stem) => word.startsWith(stem));
}

export type FilterVerdict = "ok" | "mask" | "block";

export interface FilterResult {
  verdict: FilterVerdict;
  /** Texto con las groserías tapadas (igual al original si no hubo nada). */
  text: string;
  /** Esqueletos que dispararon el filtro (para la auditoría, no para mostrar). */
  hits: string[];
}

interface Token { start: number; end: number; raw: string; word: string }

// Una «palabra» incluye los símbolos de l33t y las marcas combinantes.
const WORD_RE = /[\p{L}\p{N}\p{M}@$!|+€¡]+/gu;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    // «¡puta!»: la exclamación pegada es puntuación, no l33t de una «i».
    const core = raw.replace(/^[¡!|+]+/u, "").replace(/[!|+]+$/u, "");
    // Un número puro («2000», «4/4») no es l33t.
    const word = /\p{L}/u.test(core) ? skeleton(core) : "";
    tokens.push({ start, end: start + raw.length, raw, word });
  }
  return tokens;
}

/**
 * Filtra un texto. Además de palabra por palabra, une las letras sueltas
 * seguidas («p u t a», «p.u.t.a») para que separarlas no sirva de evasión.
 */
export function filterText(input: string): FilterResult {
  const text = stripInvisible(input);
  const tokens = tokenize(text);
  const hits: string[] = [];
  const spans: Array<[number, number]> = [];
  let blocked = false;

  const check = (word: string, start: number, end: number): void => {
    if (!word) return;
    if (inLexicon(BLOCK, word)) {
      blocked = true;
      hits.push(word);
    } else if (inLexicon(MASK, word)) {
      hits.push(word);
      spans.push([start, end]);
    }
  };

  for (const token of tokens) check(token.word, token.start, token.end);

  // Letras sueltas consecutivas: «p u t a» → «puta».
  for (let i = 0; i < tokens.length;) {
    let j = i;
    while (j < tokens.length && [...tokens[j]!.raw].length === 1 && /\p{L}|[@$!|+€¡0-9]/u.test(tokens[j]!.raw)) j += 1;
    if (j - i >= 3) {
      const joined = skeleton(tokens.slice(i, j).map((token) => token.raw).join(""));
      check(joined, tokens[i]!.start, tokens[j - 1]!.end);
    }
    i = Math.max(j, i + 1);
  }

  if (blocked) return { verdict: "block", text, hits };
  if (spans.length === 0) return { verdict: "ok", text, hits };
  let masked = "";
  let cursor = 0;
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    if (start < cursor) continue;
    masked += text.slice(cursor, start) + "✱".repeat(Math.min(8, Math.max(3, [...text.slice(start, end)].length)));
    cursor = end;
  }
  masked += text.slice(cursor);
  return { verdict: "mask", text: masked, hits };
}

// ── Mensajes ───────────────────────────────────────────────────────────────

export type BodyProblem = "empty" | "too_many_lines";

/** Limpia el cuerpo: invisibles fuera, CRLF a LF, sin espacios al final, tope de líneas. */
export function sanitizeBody(input: string): { body: string } | { problem: BodyProblem } {
  const body = stripInvisible(input)
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, " ")
    .replace(/[^\S\n]+$/gmu, "")
    // Tres o más saltos seguidos cuentan como un párrafo, no como un muro.
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (!body) return { problem: "empty" };
  const breaks = body.split("\n").length - 1;
  if (breaks > MAX_LINE_BREAKS) return { problem: "too_many_lines" };
  return { body };
}

/** Texto canónico para detectar repeticiones (mismo mensaje con otro disfraz). */
export function repeatKey(body: string): string {
  return body.split(/\s+/u).map(skeleton).filter(Boolean).join(" ");
}

// Esquema, «www.», dominios con TLD frecuentes y «punto com» escrito.
const LINK_RE = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b[\p{L}0-9-]+(?:\.|\(\.\)|\[\.\]|\s(?:punto|dot)\s)(?:com|net|org|ve|io|ly|gg|me|co|xyz|info|tk|ru|app|link|site|online|shop|tv|be|to|cc|biz|club|live|top)\b)/iu;

export function containsLink(body: string): boolean {
  return LINK_RE.test(stripInvisible(body).normalize("NFKC"));
}

// ── Apodos ─────────────────────────────────────────────────────────────────

/**
 * Esqueleto para comparar apodos con los reservados: además, «l» e «i» se
 * confunden a la vista («ADMlN» por «ADMIN»). Solo aquí: en el filtro de
 * palabras plegarlas rompería términos como «culo».
 */
function nameSkeleton(text: string): string {
  return skeleton(text).replace(/l/gu, "i");
}

/** Apodos que nadie puede usar tal cual (esqueleto exacto). */
const RESERVED_EXACT = [
  "admin", "administrador", "administradora", "administracion", "administrator", "moderador", "moderadora",
  "moderacion", "moderator", "mod", "mods", "brian", "briancesin", "crv", "coleccionistas",
  "coleccionistasderock", "coleccionistasderockvenezolano", "rockola", "larockola", "sistema", "system",
  "soporte", "support", "staff", "oficial", "official", "root", "bot", "anuncio", "anuncios",
].map(nameSkeleton);

/** Fragmentos que no pueden aparecer dentro de un apodo («xAdminx», «Mod3rador_CRV»). */
const RESERVED_PARTS = ["admin", "moderador", "moderadora", "moderator", "soporte", "oficial", "official"].map(nameSkeleton);

export type NameProblem = "too_short" | "too_long" | "reserved" | "offensive";

/**
 * Limpia y valida un apodo. NFKC convierte las letras «matemáticas» pegadas
 * (𝔅𝔯𝔦𝔞𝔫) en letras normales: así no se cuela un apodo reservado y las
 * fuentes del nombre siguen siendo algo que se compra en la tienda.
 */
export function sanitizeDisplayName(input: string): { name: string } | { problem: NameProblem } {
  const name = stripInvisible(input).normalize("NFKC").replace(/\s+/gu, " ").trim();
  const length = [...name].length;
  if (length < 2 || !/[\p{L}\p{N}]/u.test(name)) return { problem: "too_short" };
  if (length > 40) return { problem: "too_long" };
  const whole = nameSkeleton(name);
  const words = name.split(/[\s._\-·•|/]+/u).map(nameSkeleton).filter(Boolean);
  if (RESERVED_EXACT.includes(whole) || words.some((word) => word === nameSkeleton("brian") || word === nameSkeleton("admin"))) {
    return { problem: "reserved" };
  }
  if (RESERVED_PARTS.some((part) => whole.includes(part))) return { problem: "reserved" };
  if (filterText(name).verdict !== "ok") return { problem: "offensive" };
  return { name };
}

export const NAME_PROBLEM_MESSAGE: Record<NameProblem, string> = {
  too_short: "El apodo necesita al menos 2 letras o números.",
  too_long: "El apodo admite como máximo 40 caracteres.",
  reserved: "Ese apodo está reservado para el equipo de CRV. Elige otro.",
  offensive: "Ese apodo no está permitido en La Rockola. Elige otro.",
};
