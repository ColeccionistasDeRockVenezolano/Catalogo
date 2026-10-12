// CRV · Versiones de una obra (plan del primo, etapa 2, punto 9).
//
// El álbum es la obra (la página) y sus versiones viven dentro. Una versión
// gana página propia solo si aporta algo que la obra no tiene: repertorio
// distinto, portada propia o notas propias (decisión de Brian, 2026-10-12).

export interface VersionFormat {
  /** Nombre corto de la versión («Reedición en CD», «Edición en casete»), o null. */
  title: string | null;
  /** Soporte: «CD», «LP», «Casete», «CD + DVD», «Vinilo», «Digital». */
  format: string | null;
  /** Descripción al estilo Discogs: «CD, Sencillo», «CD, Reedición». */
  details: string | null;
}

const MEDIA: ReadonlyArray<[RegExp, string]> = [
  [/\bcd\s*\/\s*dvd\b|\bcd\s*\+\s*dvd\b/iu, "CD + DVD"],
  [/\bdvd\b/iu, "DVD"],
  [/\bvinyl|\bvinilo|\blp\b|12"|7"/iu, "Vinilo"],
  [/\bcassette|\bcasete|\bk7\b/iu, "Casete"],
  [/\bcd\b|\b2cd\b/iu, "CD"],
  [/\bdigital\b/iu, "Digital"],
  [/\bvhs\b/iu, "VHS"],
];

/** Soporte en español a partir de lo que dice la fuente («12" vinyl (33⅓ RPM)» → «Vinilo»). */
export function mediaFormatLabel(value: string | null | undefined): string | null {
  if (!value || /^unknown$/iu.test(value.trim())) return null;
  for (const [pattern, label] of MEDIA) if (pattern.test(value)) return /^2cd$/iu.test(value.trim()) ? "2 CD" : label;
  return value.trim();
}

/**
 * Formato y nombre de una versión a partir del título con que la fuente la
 * registró («Atabal Yémal (CD Reissue)», «Flor De Fuego (CD/DVD)») y de su
 * `media_format`.
 */
export function versionFormatOf(title: string, mediaFormat: string | null | undefined): VersionFormat {
  const fromTitle = MEDIA.find(([pattern]) => pattern.test(title))?.[1] ?? null;
  const format = mediaFormatLabel(mediaFormat) ?? fromTitle;
  const reissue = /\breissue|\breedici[oó]n|\bremaster/iu.test(title);
  const single = /\bsingle\b|\bsencillo\b/iu.test(title);
  const deluxe = title.match(/\b(super deluxe|deluxe|special|especial)\b[^)]*edition|edici[oó]n (?:especial|de lujo)/iu)?.[0] ?? null;
  const details = [format, single ? "Sencillo" : null, reissue ? "Reedición" : null, deluxe ? deluxe.replace(/\bvinyl\b\s*/iu, "").trim() : null]
    .filter(Boolean).join(", ") || null;
  const name = reissue ? `Reedición${format ? ` en ${format}` : ""}` : single ? `Sencillo${format ? ` en ${format}` : ""}`
    : deluxe ? deluxe : format ? `Edición en ${format.toLowerCase() === "cd + dvd" ? "CD + DVD" : format.toLowerCase() === "cd" ? "CD" : format.toLowerCase()}` : null;
  return { title: name, format, details };
}

/** ¿La versión merece página propia? Solo con repertorio, portada o notas propias. */
export function versionHasOwnPage(version: { distinctTracks: boolean; coverUrl: string | null; publicNotes: string | null }): boolean {
  return version.distinctTracks || Boolean(version.coverUrl) || Boolean(version.publicNotes?.trim());
}
