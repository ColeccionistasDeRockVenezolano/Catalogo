/**
 * «¿Quisiste decir…?»: sugerencia aparte, nunca mezclada con los resultados, que solo se calcula cuando la búsqueda
 * principal no encuentra nada. Compara la consulta normalizada (sin tildes ni mayúsculas) con los nombres y alias
 * del índice en memoria usando distancia de edición acotada (Damerau–Levenshtein restringida): una letra de más,
 * de menos, distinta o intercambiada. No corrige sinónimos, apodos ni abreviaturas (eso son alias a mano).
 *
 * Parte pura: no toca la base. El índice se inyecta (ver did-you-mean-service.ts).
 */
export const DID_YOU_MEAN_VERSION = "crv-did-you-mean-0.2.0";
/** Por debajo de este largo normalizado nunca se sugiere: con 4 letras casi todo está a una edición de algo. */
export const MIN_LENGTH = 5;
export const MAX_SUGGESTIONS = 3;

export const didYouMeanEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env["CRV_DID_YOU_MEAN"] === "on";

const STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "un", "una", "the", "of", "and", "a", "en"]);

/** Quita artículos y conectores («caramelos de cianuro» → «caramelos cianuro»); si no queda nada, devuelve la clave tal cual. */
export function stripStopwords(key: string): string {
  const kept = key.split(" ").filter(token => token && !STOPWORDS.has(token));
  return kept.length ? kept.join(" ") : key;
}

/** Ediciones toleradas según el largo: 5–8 letras, 1; 9–13, 2; 14 o más, 3. Menos de 5: ninguna (no se sugiere). */
export function allowedDistance(length: number): number {
  return length < MIN_LENGTH ? -1 : length <= 8 ? 1 : length <= 13 ? 2 : 3;
}

/** Largo máximo comparable. Claves o consultas más largas no se comparan (nombres de ese tamaño no son erratas de teclado). */
export const MAX_COMPARABLE_LENGTH = 120;
const row0 = new Int32Array(MAX_COMPARABLE_LENGTH + 2), row1 = new Int32Array(MAX_COMPARABLE_LENGTH + 2), row2 = new Int32Array(MAX_COMPARABLE_LENGTH + 2);

/**
 * Distancia de edición con transposición de letras contiguas (OSA), acotada: devuelve `max + 1` en cuanto es seguro
 * que la distancia supera `max` (la fila mínima ya lo excede), sin terminar la tabla. Reutiliza tres filas globales
 * (no asigna memoria por llamada): es síncrona y no reentrante, y ambas cadenas deben caber en MAX_COMPARABLE_LENGTH.
 */
export function osaDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max || la > MAX_COMPARABLE_LENGTH || lb > MAX_COMPARABLE_LENGTH) return max + 1;
  let previous2 = row0, previous = row1, current = row2;
  for (let j = 0; j <= lb; j++) { previous[j] = j; previous2[j] = 0; }
  for (let i = 1; i <= la; i++) {
    current[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let value = previous[j]! + 1;
      const insert = current[j - 1]! + 1; if (insert < value) value = insert;
      const substitute = previous[j - 1]! + cost; if (substitute < value) value = substitute;
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        const swap = previous2[j - 2]! + 1; if (swap < value) value = swap;
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    const free = previous2; previous2 = previous; previous = current; current = free;
  }
  return previous[lb]!;
}

/**
 * Firma de letras: cuántas veces aparece cada carácter (agrupados en 32 casillas por `código & 31`). Una edición cambia la
 * firma en a lo sumo 2 (sustituir) o 1 (insertar, borrar) y el intercambio de dos letras en 0; agrupar casillas solo puede
 * reducir la diferencia. Por tanto, dos cadenas a distancia ≤ k tienen diferencia de firmas ≤ 2k: filtro exacto, sin falsos negativos.
 */
export const SIGNATURE_SIZE = 32;
function signatureOf(text: string, into: Uint8Array, offset: number): void {
  for (let i = 0; i < text.length; i++) { const slot = offset + (text.charCodeAt(i) & 31); if (into[slot]! < 255) into[slot]!++; }
}
function signatureGap(needle: Uint8Array, sig: Uint8Array, offset: number, bound: number): number {
  let sum = 0;
  for (let i = 0; i < SIGNATURE_SIZE; i++) {
    const d = needle[i]! - sig[offset + i]!;
    sum += d < 0 ? -d : d;
    if (sum > bound) return sum;
  }
  return sum;
}

/** Ediciones toleradas dentro de una palabra: ninguna en las de 1–2 letras, una hasta 6, dos desde 7. */
export function tokenAllowance(length: number): number { return length < 3 ? 0 : length <= 6 ? 1 : 2; }

/**
 * Una errata no es una frase distinta. Con la distancia total ya dentro del límite, además se exige que:
 * (1) con el mismo número de palabras, cada palabra distinta cambie poco (no «zoo» → «amor», ni «60» → «ti»);
 * (2) con distinto número de palabras, solo difiera en espacios (comparando sin espacios, a lo sumo una edición);
 * (3) una cadena no sea la otra con 2 o más letras añadidas al final o al principio («venezueladw» no es «venezuela»).
 */
export function plausibleShape(needle: string, key: string): boolean {
  const shorter = needle.length <= key.length ? needle : key, longer = shorter === needle ? key : needle;
  if (longer.length - shorter.length >= 2 && (longer.startsWith(shorter) || longer.endsWith(shorter))) return false;
  const a = needle.split(" "), b = key.split(" ");
  if (a.length !== b.length) return osaDistance(needle.replace(/ /g, ""), key.replace(/ /g, ""), 1) <= 1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const limit = tokenAllowance(Math.max(a[i]!.length, b[i]!.length));
    if (osaDistance(a[i]!, b[i]!, limit) > limit) return false;
  }
  return true;
}

export type FuzzyKind = "artist" | "album" | "organization" | "person" | "track";
/** Desempate entre tipos a igual distancia: lo más específico para quien busca un nombre primero. */
const KIND_ORDER: Readonly<Record<FuzzyKind, number>> = { artist: 0, album: 1, organization: 2, person: 3, track: 4 };

export interface FuzzyEntry { id: number; name: string; keys: string[]; weight: number }
export interface FuzzyIndex {
  kind: FuzzyKind;
  entries: readonly FuzzyEntry[];
  /** Claves comparables (ya normalizadas), planas, y la entrada a la que pertenece cada una. */
  keys: string[];
  stripped: string[];
  owner: Int32Array;
  /** Firmas de letras (SIGNATURE_SIZE por clave) de `keys` y de `stripped`; el filtro previo a la distancia. */
  keySig: Uint8Array;
  strippedSig: Uint8Array;
  /** 1 si la clave es el nombre propio de la entrada (y no un alias): a igual distancia, el nombre propio va antes. */
  primary: Uint8Array;
}
export interface Suggestion { kind: FuzzyKind; id: number; name: string; distance: number; viaAlias?: boolean }

/**
 * Qué claves de una entrada cuentan. En los discos el índice añade tras el título la clave del artista y «título artista»
 * (para que «desorden publico» encuentre sus discos): aquí no, o un artista mal escrito sugeriría sus discos en lugar de a él.
 */
export function comparableKeys(kind: FuzzyKind, keys: readonly string[]): string[] {
  return kind === "album" ? [...keys.slice(0, 1), ...keys.slice(3)] : [...keys];
}

export function buildFuzzyIndex(kind: FuzzyKind, entries: readonly FuzzyEntry[]): FuzzyIndex {
  const keys: string[] = [], stripped: string[] = [], owner: number[] = [], primary: number[] = [];
  entries.forEach((entry, index) => {
    const comparable = comparableKeys(kind, entry.keys);
    for (const key of new Set(comparable)) {
      if (key.length < MIN_LENGTH - 2 || key.length > MAX_COMPARABLE_LENGTH) continue; // muy corta o demasiado larga para ser una errata
      keys.push(key); stripped.push(stripStopwords(key)); owner.push(index); primary.push(key === comparable[0] ? 1 : 0);
    }
  });
  const keySig = new Uint8Array(keys.length * SIGNATURE_SIZE), strippedSig = new Uint8Array(keys.length * SIGNATURE_SIZE);
  keys.forEach((key, i) => {
    signatureOf(key, keySig, i * SIGNATURE_SIZE);
    if (stripped[i] === key) strippedSig.set(keySig.subarray(i * SIGNATURE_SIZE, (i + 1) * SIGNATURE_SIZE), i * SIGNATURE_SIZE);
    else signatureOf(stripped[i]!, strippedSig, i * SIGNATURE_SIZE);
  });
  return { kind, entries, keys, stripped, owner: Int32Array.from(owner), keySig, strippedSig, primary: Uint8Array.from(primary) };
}

/**
 * Las mejores coincidencias aproximadas de `needle` (clave normalizada) en los índices dados: menor distancia, luego tipo,
 * luego peso (relevancia en el catálogo). Sin duplicar entidades ni nombres. Vacío si la consulta es demasiado corta.
 */
export function suggest(needle: string, indexes: readonly FuzzyIndex[], limit = MAX_SUGGESTIONS): Suggestion[] {
  const rawMax = allowedDistance(needle.length);
  if (rawMax < 0 || needle.length > MAX_COMPARABLE_LENGTH) return [];
  const strippedNeedle = stripStopwords(needle);
  const strippedMax = allowedDistance(strippedNeedle.length);
  const needleSig = new Uint8Array(SIGNATURE_SIZE), strippedNeedleSig = new Uint8Array(SIGNATURE_SIZE);
  signatureOf(needle, needleSig, 0); signatureOf(strippedNeedle, strippedNeedleSig, 0);
  const found = new Map<string, Suggestion & { weight: number }>();
  for (const index of indexes) {
    const { keys, stripped, owner, entries, keySig, strippedSig, primary } = index;
    const best = new Map<number, { distance: number; primary: boolean }>();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      let distance = Number.POSITIVE_INFINITY;
      if (Math.abs(key.length - needle.length) <= rawMax && signatureGap(needleSig, keySig, i * SIGNATURE_SIZE, 2 * rawMax) <= 2 * rawMax) {
        const value = osaDistance(needle, key, rawMax);
        if (value <= rawMax && plausibleShape(needle, key)) distance = value;
      }
      // Con artículos/«de» fuera: «caramelos cianuro» encuentra «Caramelos de Cianuro». Solo si ambos lados conservan un largo útil.
      const other = stripped[i]!;
      if (strippedMax >= 0 && (other !== key || strippedNeedle !== needle) && allowedDistance(other.length) >= 0
        && Math.abs(other.length - strippedNeedle.length) <= strippedMax
        && signatureGap(strippedNeedleSig, strippedSig, i * SIGNATURE_SIZE, 2 * strippedMax) <= 2 * strippedMax) {
        const value = osaDistance(strippedNeedle, other, strippedMax);
        if (value <= strippedMax && value < distance && plausibleShape(strippedNeedle, other)) distance = value;
      }
      if (distance !== Number.POSITIVE_INFINITY) {
        const entry = owner[i]!, known = best.get(entry);
        if (!known || distance < known.distance || (distance === known.distance && primary[i] === 1 && !known.primary)) best.set(entry, { distance, primary: primary[i] === 1 });
      }
    }
    for (const [entryIndex, match] of best) {
      const entry = entries[entryIndex]!;
      const identity = `${index.kind}:${entry.id}`;
      if (!found.has(identity)) found.set(identity, { kind: index.kind, id: entry.id, name: entry.name, distance: match.distance, weight: entry.weight, viaAlias: !match.primary });
    }
  }
  const ranked = [...found.values()].sort((a, b) =>
    a.distance - b.distance || Number(a.viaAlias) - Number(b.viaAlias) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.weight - a.weight || a.name.localeCompare(b.name, "es"));
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const item of ranked) {
    const label = item.name.normalize("NFD").replace(/\p{M}+/gu, "").trim().toLocaleLowerCase("es");
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ kind: item.kind, id: item.id, name: item.name, distance: item.distance, ...(item.viaAlias ? { viaAlias: true } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}
