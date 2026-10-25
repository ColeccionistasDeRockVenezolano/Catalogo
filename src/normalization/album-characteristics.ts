import type { AlbumEditionType } from "../shared/album-categories.js";

const acoustic = /\bac[uú]stic[oa]s?\b|\bacoustic\b|\bunplugged\b|\bdesenchufad[oa]s?\b/iu;
const instrumental = /\binstrumental(?:es|s)?\b/iu;
const remix = /\bremix(?:es|ed)?\b|\bremezclas?\b/iu;
const edition = /\bdeluxe\b|\bremaster\w*\b|\breissue\b|\breedici[oó]n\b|\bexpanded\b|\b(?:edition|edici[oó]n)\b/iu;

/** Inferencias del título; no afirma géneros, fechas ni grabación en vivo. */
export function albumTitleCharacteristics(title: string): string[] {
  const text = title.normalize("NFC");
  const result: string[] = [];
  if (acoustic.test(text)) result.push("Acústico");
  if (instrumental.test(text)) result.push("Instrumental");
  if (remix.test(text)) result.push("Remix");
  return result;
}

export function albumTitleEdition(title: string): { title: string; types: AlbumEditionType[] } | null {
  const text = title.normalize("NFC");
  if (!edition.test(text)) return null;
  const types: AlbumEditionType[] = [];
  if (/\bdeluxe\b|\bexpanded\b/iu.test(text)) types.push("deluxe");
  if (/\bremaster\w*\b/iu.test(text)) types.push("remastered");
  if (/\breissue\b|\breedici[oó]n\b/iu.test(text)) types.push("reissue");
  if (/\bedici[oó]n\s+especial\b|\bspecial\s+edition\b/iu.test(text)) types.push("special_edition");
  if (/\bedici[oó]n\s+limitada\b|\blimited\s+edition\b/iu.test(text)) types.push("limited_edition");
  if (!types.length) types.push("other_edition");
  const qualifiers = [...text.matchAll(/[([]([^()[\]]+)[)\]]/gu)]
    .map(match => match[1]!).filter(part => edition.test(part));
  return { title: qualifiers.length ? qualifiers.join("; ") : title, types };
}
