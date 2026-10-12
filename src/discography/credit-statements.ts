// CRV · Créditos en frase (plan del primo, etapa 2, punto 8).
//
// El canal escribe los créditos técnicos como frases: «All tracks Mixed by John
// Karpowich at A&M Studios (Hollywood, CA) except;». Al atomizarlos en
// `album_credits` se pierde el «dónde» y el «cuándo». Aquí se guarda la línea
// entera y se marcan sus tramos (rol, persona o estudio, año, lugar, alcance)
// para enlazarlos sin trocear la frase en pantalla.
//
// Este módulo es puro: devuelve los tramos con su texto; quien lo usa los
// enlaza con el catálogo (persona, organización, artista, lugar).
import { looksLikeOrganization, matchCreditLine } from "../youtube/parsers.js";
import { creditTypeForRole } from "../merge/relations.js";
import { resolvePlace } from "./places.js";

export type StatementPartType = "role" | "person" | "organization" | "place" | "year" | "tracks";

export interface StatementPart {
  /** Posición en code points (como `Array.from(text)`), [start, end). */
  start: number;
  end: number;
  type: StatementPartType;
  text: string;
  /** Rol normalizado del tramo de rol («mixing», «mastering»…). */
  roleKey?: string;
  /** Un nombre de «by» que parece estudio o sello («Fisgón-Design»). */
  organizationLike?: boolean;
}

export interface ParsedStatement {
  text: string;
  trackNumbers: number[];
  parts: StatementPart[];
}

/** «their respective artists», enlaces y usuarios: no son nombres de nadie. */
const NOT_A_NAME = /@|https?:|www\.|\btheir\b|\brespective\b|\bvarios\b|\bvarious\b/iu;

const YEAR = /(?<![\d/])(1[89]\d{2}|20\d{2})(?![\d/])/gu;

/** Offsets de String (UTF-16) → code points, para que la web pueda cortar con Array.from. */
function codePointOffset(text: string, index: number): number {
  return Array.from(text.slice(0, index)).length;
}

/**
 * Lee una línea de crédito y devuelve sus tramos, o null si la línea no es
 * una frase «… by/at …». Los tramos no se solapan y van en orden.
 */
export function parseCreditStatement(line: string): ParsedStatement | null {
  const text = line.trim().replace(/\s+/gu, " ");
  if (!text) return null;
  // «… (Hollywood, California) &» sigue en la línea siguiente: el conector final
  // no es parte del lugar. Se lee sin él; los tramos se buscan en la línea entera.
  const match = matchCreditLine(text.replace(/\s*(?:&|\band\b|\by\b|,)\s*$/iu, ""));
  if (!match) return null;
  const spans: Array<Omit<StatementPart, "start" | "end"> & { from: number; to: number }> = [];
  const taken: Array<[number, number]> = [];
  const free = (from: number, to: number) => taken.every(([a, b]) => to <= a || from >= b);
  const add = (from: number, length: number, part: Omit<StatementPart, "start" | "end">): boolean => {
    if (from < 0 || length <= 0 || !free(from, from + length)) return false;
    spans.push({ ...part, from, to: from + length });
    taken.push([from, from + length]);
    return true;
  };

  let cursor = 0;
  if (match.scope) {
    const at = text.indexOf(match.scope);
    if (add(at, match.scope.length, { type: "tracks", text: match.scope })) cursor = at + match.scope.length;
  }
  const roleAt = text.indexOf(match.role, cursor);
  if (roleAt >= 0) {
    add(roleAt, match.role.length, { type: "role", text: match.role, roleKey: creditTypeForRole(match.role) });
    cursor = roleAt + match.role.length;
  }
  const valueAt = text.indexOf(match.value, cursor);
  const venueSplit = match.preposition === "by" ? text.slice(Math.max(valueAt, 0)).search(/\s\bat\b\s/iu) : 0;
  const venueFrom = valueAt >= 0 && venueSplit >= 0 ? valueAt + venueSplit : text.length;
  // Nombres de «by»: en el tramo anterior a « at ».
  let nameCursor = Math.max(valueAt, cursor);
  for (const name of match.credit.names) {
    if (NOT_A_NAME.test(name)) continue;
    const at = text.indexOf(name, nameCursor);
    if (at < 0 || at >= venueFrom) continue;
    const organizationLike = looksLikeOrganization(name);
    if (add(at, name.length, { type: organizationLike ? "organization" : "person", text: name, ...(organizationLike ? { organizationLike } : {}) })) {
      nameCursor = at + name.length;
    }
  }
  // El estudio. Con un año pegado («at Casita, 2026 (Chicago, IL)») el lector
  // del canal lo descarta; aquí se recupera lo que va entre « at » y la coma.
  const venueStart = match.preposition === "at" ? Math.max(valueAt, 0) : venueFrom;
  const venue = match.credit.venue
    ?? (venueFrom < text.length ? text.slice(venueFrom).replace(/^\s+at\s+/iu, "").split(/\s*[,(;]\s*/u)[0]!.trim() : null);
  if (venue && venue.length >= 2 && !/^\d+$/u.test(venue)) {
    const at = text.indexOf(venue, venueStart);
    add(at, venue.length, { type: "organization", text: venue });
  }
  if (match.credit.location) {
    const at = text.lastIndexOf(match.credit.location);
    add(at, match.credit.location.length, { type: "place", text: match.credit.location });
  }
  for (const year of text.matchAll(YEAR)) add(year.index!, year[0].length, { type: "year", text: year[0] });

  spans.sort((a, b) => a.from - b.from);
  return {
    text,
    trackNumbers: match.credit.trackNumbers,
    parts: spans.map(({ from, to, ...part }) => ({ ...part, start: codePointOffset(text, from), end: codePointOffset(text, to) })),
  };
}

/**
 * «Photos: Anibal Morino», «Artwork & Design: Jesus Maduro R.»: rol y nombres
 * separados por dos puntos. Null si la línea no tiene esa forma.
 */
export function parseRoleColonStatement(line: string): ParsedStatement | null {
  const text = line.trim().replace(/\s+/gu, " ");
  const match = text.match(/^([^:]{2,40}?)\s*:\s*(\S.*)$/u);
  if (!match || /https?$/iu.test(match[1]!) || match[1]!.trim().split(/\s+/u).length > 5) return null;
  const role = match[1]!;
  const parts: StatementPart[] = [{ start: 0, end: Array.from(role).length, type: "role", text: role, roleKey: creditTypeForRole(role) }];
  const valueFrom = text.indexOf(match[2]!, role.length);
  const span = (at: number, value: string, part: Omit<StatementPart, "start" | "end" | "text">) =>
    parts.push({ start: codePointOffset(text, at), end: codePointOffset(text, at + value.length), text: value, ...part });
  // «Nombre & Nombre at Estudio, 2013 (Ciudad, País)»: lugar, año y estudio salen
  // del final; lo que queda delante son los nombres.
  let rest = text.slice(valueFrom);
  const location = rest.match(/\(([^()]{2,60})\)\s*$/u);
  let placePart: [number, string] | null = null;
  // Entre paréntesis puede ir un lugar o un correo, una web, un apodo: solo
  // cuenta como lugar si se reconoce como tal.
  const resolved = location && !/[@/\d]|\.\w{2,4}\b/u.test(location[1]!) ? resolvePlace(location[1]!) : null;
  if (location && resolved && !/sin país/u.test(resolved.doubt ?? "")) {
    placePart = [valueFrom + location.index! + 1, location[1]!];
    rest = rest.slice(0, location.index!);
  }
  const years = [...rest.matchAll(YEAR)].map((year) => [valueFrom + year.index!, year[0]] as [number, string]);
  const firstYear = rest.search(YEAR);
  const venueAt = rest.search(/\s\bat\b\s/iu);
  const namesEnd = Math.min(...[rest.length, venueAt, firstYear, rest.indexOf("(")].filter((value) => value >= 0));
  let cursor = valueFrom;
  for (const raw of rest.slice(0, namesEnd).split(/\s*(?:&|,|\/|\band\b|\by\b)\s*/u)) {
    const name = raw.replace(/[.;,]+$/u, "").replace(/\s*\(.*$/u, "").trim();
    if (name.length < 2 || /^\d+$/u.test(name) || NOT_A_NAME.test(name)) continue;
    const at = text.indexOf(name, cursor);
    if (at < 0) continue;
    const organizationLike = looksLikeOrganization(name);
    span(at, name, { type: organizationLike ? "organization" : "person", ...(organizationLike ? { organizationLike } : {}) });
    cursor = at + name.length;
  }
  if (venueAt >= 0) {
    const venue = rest.slice(venueAt).replace(/^\s+at\s+/iu, "").split(/\s*[,(;]\s*/u)[0]!.trim();
    const at = venue.length >= 2 ? text.indexOf(venue, valueFrom + venueAt) : -1;
    if (at >= 0) span(at, venue, { type: "organization" });
  }
  for (const [at, year] of years) if (!parts.some((part) => part.type !== "role" && codePointOffset(text, at) < part.end && codePointOffset(text, at) >= part.start)) span(at, year, { type: "year" });
  if (placePart) span(placePart[0], placePart[1], { type: "place" });
  parts.sort((a, b) => a.start - b.start);
  return parts.length > 1 ? { text, trackNumbers: [], parts } : null;
}

/**
 * Segunda línea de un crédito cortado con «&»: «El Charquito y El Piel Estudios
 * (Buenos Aires, Argentina)». Es otro estudio con su lugar.
 */
export function parseVenueContinuation(line: string): ParsedStatement | null {
  const text = line.trim().replace(/\s+/gu, " ");
  const match = text.replace(/\s*(?:&|,)\s*$/u, "").match(/^([^()]{2,80}?)\s*\(([^()]{2,60})\)$/u);
  if (!match) return null;
  const venue = match[1]!.trim();
  const place = match[2]!.trim();
  const placeAt = text.lastIndexOf(place);
  return { text, trackNumbers: [], parts: [
    { start: 0, end: Array.from(venue).length, type: "organization", text: venue },
    { start: codePointOffset(text, placeAt), end: codePointOffset(text, placeAt + place.length), type: "place", text: place },
  ] };
}
