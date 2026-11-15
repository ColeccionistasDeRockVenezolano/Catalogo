// Regla de Brian (2026-11-12): el sitio público no nombra ni enlaza RYM ni AOTY.
// Son fuentes de captura internas: su enlace solo se ve en la procedencia de los editores.
const HIDDEN_SOURCE = /^https?:\/\/([a-z0-9-]+\.)*(rateyourmusic\.com|albumoftheyear\.org|sonemic\.com)(\/|$)/i;

/** ¿Se puede mostrar este enlace de fuente al público? */
export const isPublicSourceUrl = (url: string | null | undefined): url is string => Boolean(url) && !HIDDEN_SOURCE.test(url!);
