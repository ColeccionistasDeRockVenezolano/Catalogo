// CRV · Cómo se firma una pista en la radio.
//
// La fuente de la radio trae dos formas de nombrar una pista:
//   · artista propio + título limpio («Convoy» / «Hoy Voy Por Ti»);
//   · recopilatorio, donde el campo de artista no sirve («Various Artists»,
//     «Varios artistas», «VA», «V.A.») y el autor viaja dentro del título:
//     «7 Balazos - Paranoia».
//
// La tarjeta enseña el título de la música y, debajo, «Artista - Álbum - Año».
// Nunca se enseña la marca de recopilatorio: cuando el campo de artista no
// sirve, se toma el autor del propio título.
//
// La misma regla vive en el cliente de la radio (src/landing/client/radio.js),
// que repinta la tarjeta cada 30 s sin volver a pedir la página.
const COMPILATION_ARTIST = /^(various artists|varios artistas|v\.?\s*a\.?)$/iu;
/** «Autor - Título»: el guion suelto separa; el que va pegado a una palabra no. */
const TITLE_WITH_ARTIST = /^(.{1,120}?)\s+-\s+(.+)$/u;

export function isCompilationArtist(artist: string | null | undefined): boolean {
  return COMPILATION_ARTIST.test(String(artist ?? "").trim());
}

/** El artista que se puede enseñar; vacío cuando la pista viene de un recopilatorio. */
export function displayArtist(artist: string | null | undefined): string {
  const value = String(artist ?? "").trim();
  return value === "" || isCompilationArtist(value) ? "" : value;
}

interface Track {
  artist?: string | null;
  album?: string | null;
  year?: number | null;
  title?: string | null;
}

/**
 * Título y artista que se enseñan. Con artista fiable, el título se deja tal
 * cual y solo se le quita el prefijo si lo repite; sin artista fiable, se toma
 * el autor del título («Artista - Título»).
 */
export function trackDisplay(track: Track | null | undefined): { artist: string; title: string } {
  const rawTitle = String(track?.title ?? "").trim();
  const known = displayArtist(track?.artist);
  if (known) {
    const prefix = `${known} - `;
    if (rawTitle.toLocaleLowerCase("es").startsWith(prefix.toLocaleLowerCase("es"))) {
      return { artist: known, title: rawTitle.slice(prefix.length).trim() };
    }
    return { artist: known, title: rawTitle };
  }
  const match = TITLE_WITH_ARTIST.exec(rawTitle);
  if (!match) return { artist: "", title: rawTitle };
  const [, left = "", right = ""] = match;
  return { artist: left.trim(), title: right.trim() };
}

/** Línea principal de la tarjeta: el título de la música, sin el artista. */
export function trackTitle(track: Track | null | undefined): string {
  return trackDisplay(track).title;
}

/** Línea de «A continuación»: artista y después el nombre de la música. */
export function trackLine(track: Track | null | undefined): string {
  const { artist, title } = trackDisplay(track);
  return [artist, title].filter(Boolean).join(" - ");
}

/** Línea pequeña: artista - álbum - año, sin el artista de recopilatorio. */
export function trackCredits(track: Track | null | undefined): string {
  if (!track) return "";
  const artist = trackDisplay(track).artist;
  return [artist, (track.album ?? "").trim(), track.year ? String(track.year) : ""].filter(Boolean).join(" - ");
}
