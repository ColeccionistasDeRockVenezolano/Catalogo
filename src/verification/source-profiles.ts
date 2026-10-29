// CRV · Perfiles por fuente y votación por campo (búsqueda por APIs).
//
// Funciones puras. Cada API confirmada aporta su propia versión del artista
// («Jeremías (Deezer)», «Jeremías (Discogs)»…); aquí se juntan por disco y se
// vota cada campo. Nada se escribe en el catálogo.
//
//  * SE CUENTAN ORÍGENES, NO FUENTES. Deezer, iTunes y Spotify reciben los
//    datos del mismo distribuidor: un error suyo aparece repetido y no debe
//    ganar por mayoría. Cada familia vota una sola vez.
//  * CADA CAMPO TIENE SU FUENTE FUERTE. El año de las plataformas suele ser el
//    de la subida digital: en el año pesan más MusicBrainz y Discogs; en las
//    pistas, las plataformas.
//  * NO SE PROMEDIA. Un empate o una fuente fuerte que contradice a la mayoría
//    va a revisión con todos los valores a la vista.
//  * EL TIPO DE DISCO NO SE VOTA. Lo manda la hoja o la fuente documental; las
//    APIs solo lo informan.
import { normalizeIdentitySecondary } from "../normalization/claims.js";
import type { MatchOutcome } from "../genres/external/identity.js";

export type ProfileSourceSlug = "deezer" | "itunes" | "musicbrainz" | "discogs" | "lastfm";
export type OriginFamily = "distribuidor" | "musicbrainz" | "discogs" | "lastfm";

export const SOURCE_FAMILY: Record<ProfileSourceSlug, OriginFamily> = {
  deezer: "distribuidor", itunes: "distribuidor", musicbrainz: "musicbrainz", discogs: "discogs", lastfm: "lastfm",
};

// Last.fm junta en una página a todos los homónimos y sus discos los arman los
// usuarios al escuchar («Promo Only…», «Álbum desconocido»): se muestra, pero
// no vota ni cuenta para decir que un disco existe.
const NON_VOTING: OriginFamily[] = ["lastfm"];

export interface ProfileRelease {
  externalId: string;
  title: string;
  year: number | null;
  type: string | null;
  trackCount: number | null;
  tracks: string[];
  label: string | null;
  coverUrl: string | null;
  url: string | null;
}

export interface SourceProfile {
  source: ProfileSourceSlug;
  externalId: string;
  name: string;
  url: string | null;
  country: string | null;
  beginYear: number | null;
  tags: string[];
  releases: ProfileRelease[];
  /** `born`: el año de inicio es el nacimiento de una persona, no el del proyecto. */
  beginKind?: "born" | "formed" | null;
  /** Cómo se confirmó que es el mismo artista. */
  identity: { status: MatchOutcome["status"]; score: number; reason: string; signals: string[] };
  requests: number;
}

export interface CatalogAlbum {
  id: number;
  title: string;
  year: number | null;
  type: string | null;
  trackTitles: string[];
  /** Otros títulos registrados de esas pistas (alias): cuentan como la misma pista. */
  trackAliases?: string[];
  /** Sello de la ficha, si lo tiene. */
  label?: string | null;
  hasCover: boolean;
}

export interface CatalogArtist {
  id: number;
  name: string;
  aliases: string[];
  country: string | null;
  formedYear: number | null;
  /** Nacimiento del titular, para un solista. */
  birthYear?: number | null;
  memberNames: string[];
  albums: CatalogAlbum[];
}

export type FieldStatus = "coincide" | "propuesta" | "discrepancia" | "dudoso" | "sin_datos";

export interface FieldVote<T> {
  status: FieldStatus;
  value: T | null;
  catalog: T | null;
  /** Valor de cada fuente, para la tabla comparativa. */
  bySource: Partial<Record<ProfileSourceSlug, T | null>>;
  /** Familias que respaldan el valor elegido. */
  support: OriginFamily[];
  note?: string;
}

export interface WorkComparison {
  key: string;
  title: string;
  catalogAlbumId: number | null;
  /** Familias que publican este disco. */
  families: OriginFamily[];
  year: FieldVote<number>;
  trackCount: FieldVote<number>;
  label: FieldVote<string>;
  tracks: { status: FieldStatus; proposed: string[]; agreement: number; from: ProfileSourceSlug | null; note?: string };
  types: Partial<Record<ProfileSourceSlug, string | null>>;
  covers: Partial<Record<ProfileSourceSlug, string>>;
}

// Marcas de edición que no cambian la obra: el disco remasterizado o de lujo
// es una versión del mismo disco, no otro.
const EDITION_MARKS = [
  /\s+-\s+(single|ep)$/iu,
  /\s*[([](\d{4}\s+)?(remaster(ed|izado)?|remasterizada|deluxe( edition| version)?|edici[oó]n (de lujo|especial|deluxe)|expanded edition|bonus track version)[^)\]]*[)\]]/giu,
];

/** Título sin marcas de edición («Acuérdate - Single» → «Acuérdate»). */
export function editionless(title: string): string {
  let value = title;
  for (const pattern of EDITION_MARKS) value = value.replace(pattern, "");
  return value.trim() || title;
}

/** Clave de obra: título sin tildes y sin marcas de edición. */
export function workKey(title: string): string {
  return normalizeIdentitySecondary(editionless(title));
}

// Títulos que cualquier homónimo puede tener: no prueban identidad. «Demo»,
// «En vivo», «Grandes éxitos» o «Vol. 2» aparecen en miles de discografías.
const GENERIC_TITLES = [
  /^(the )?(demo|demos|maqueta|promo|ep|single|sencillo|live|en vivo|en directo|en concierto|unplugged|acustico|acoustic|instrumental(es)?|remix(es)?|intro|interludio|outro|untitled|sin titulo|s ?t|self titled|homonimo|debut|primer disco|rarezas|b ?sides|lados b|bonus)$/u,
  /^(the )?(greatest hits|best of|the best|lo mejor( de.*)?|grandes exitos( de.*)?|exitos|20 exitos|coleccion|antologia|grandes exitos de oro|historia musical|mis (exitos|canciones)|sus (exitos|mejores canciones))$/u,
  /^(vol(umen|ume)?|parte|part|capitulo|chapter) ?([ivx]+|\d+)$/u,
  /^([ivx]+|\d+)$/u,
];

/**
 * El título no identifica a nadie: genérico, o una sola palabra corta
 * («Tú», «Vida»). Sigue siendo un disco de la ficha; solo no cuenta como
 * prueba de que un perfil externo sea este artista.
 */
export function isGenericTitle(title: string): boolean {
  const key = workKey(title);
  if (!key || GENERIC_TITLES.some((pattern) => pattern.test(key))) return true;
  return !key.includes(" ") && key.length < 6;
}

/**
 * Con un solo disco en común, el año tiene que acompañar: dos homónimos pueden
 * tener un disco con el mismo título, pero rara vez del mismo año. Un año
 * posterior en la fuente suele ser la subida digital de un disco viejo: no
 * contradice, pero tampoco confirma, y entonces el título debe ser
 * inconfundible (dos palabras o más y al menos 12 letras).
 */
export function singleTitleCheck(title: string, catalogYear: number | null | undefined, sourceYear: number | null | undefined): { ok: boolean; reason: string } {
  if (catalogYear && sourceYear && Math.abs(catalogYear - sourceYear) <= 1) return { ok: true, reason: `un disco en común y el año coincide (${sourceYear})` };
  if (catalogYear && sourceYear && sourceYear < catalogYear) return { ok: false, reason: `un solo disco en común («${title}») y la fuente lo fecha antes (${sourceYear} frente a ${catalogYear})` };
  const key = workKey(title).replace(/\s/gu, "");
  const distinctive = workKey(title).includes(" ") && key.length >= 12;
  const why = catalogYear && sourceYear ? `fecha digital posterior (${sourceYear} frente a ${catalogYear})` : "sin año para comparar";
  return distinctive
    ? { ok: true, reason: `un disco en común, ${why}, con título inconfundible («${title}»)` }
    : { ok: false, reason: `un solo disco en común («${title}»), ${why} y el título no basta` };
}

// Ruido de catálogo en los títulos de pista: invitados, numeración romana o
// arábiga delante, versión en vivo o remasterizada y el año pegado al final.
const TRACK_NOISE = [
  /\s*[([](feat\.?|ft\.?|con)\s[^)\]]*[)\]]/giu,
  /^\s*(?:[IVXLC]+|\d{1,2})(?:\.|\s+-|\s)\s+/u,
  /\s*[([][^)\]]*\b(version|versión|live|en vivo|remaster(ed|izado)?|mix|edit)\b[^)\]]*[)\]]/giu,
  /\s+-\s+[^-]*\b(version|versión|live|en vivo|remaster(ed|izado)?|edit)\b.*$/iu,
  /\s*[([]?\b(19|20)\d{2}\b[)\]]?\s*$/u,
];

export function trackKey(title: string): string {
  let value = title;
  for (const pattern of TRACK_NOISE) value = value.replace(pattern, "");
  return normalizeIdentitySecondary(value.trim() || title);
}

/** Misma pista: igual, o una empieza con la otra («Nigredo : Lider De Sueños» y «Nigredo»). */
export function sameTrack(left: string, right: string): boolean {
  const a = trackKey(left), b = trackKey(right);
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 6 && long.startsWith(`${short} `);
}

/**
 * Elige un valor entre familias. Cada familia ya entrega un solo valor; gana
 * el que más familias respalden. Con empate decide la prioridad del campo, y
 * si la familia más fuerte queda en minoría el campo va a revisión.
 */
export function voteField<T>(
  bySource: Partial<Record<ProfileSourceSlug, T | null>>,
  catalog: T | null,
  options: { priority: OriginFamily[]; collapse: (values: T[]) => T; same?: (a: T, b: T) => boolean },
): FieldVote<T> {
  const same = options.same ?? ((a: T, b: T) => a === b);
  const perFamily = new Map<OriginFamily, T[]>();
  for (const [source, value] of Object.entries(bySource) as Array<[ProfileSourceSlug, T | null]>) {
    if (value === null || value === undefined) continue;
    const family = SOURCE_FAMILY[source];
    if (NON_VOTING.includes(family)) continue;
    perFamily.set(family, [...(perFamily.get(family) ?? []), value]);
  }
  if (perFamily.size === 0) return { status: "sin_datos", value: null, catalog, bySource, support: [] };
  const familyValue = new Map([...perFamily].map(([family, values]) => [family, options.collapse(values)]));
  const tallies: Array<{ value: T; families: OriginFamily[] }> = [];
  for (const [family, value] of familyValue) {
    const tally = tallies.find((item) => same(item.value, value));
    if (tally) tally.families.push(family); else tallies.push({ value, families: [family] });
  }
  const rank = (families: OriginFamily[]) => Math.min(...families.map((family) => {
    const index = options.priority.indexOf(family);
    return index < 0 ? options.priority.length : index;
  }));
  tallies.sort((a, b) => b.families.length - a.families.length || rank(a.families) - rank(b.families));
  const winner = tallies[0]!;
  const runnerUp = tallies[1];
  let status: FieldStatus;
  let note: string | undefined;
  const strongest = options.priority.find((family) => familyValue.has(family));
  if (runnerUp && runnerUp.families.length === winner.families.length) {
    // La prioridad ordena la tabla, pero un empate lo decide una persona.
    status = "dudoso"; note = `empate: ${String(winner.value)} [${winner.families.join("+")}] frente a ${String(runnerUp.value)} [${runnerUp.families.join("+")}]`;
  } else if (strongest && !winner.families.includes(strongest) && runnerUp) {
    status = "dudoso"; note = `la fuente fuerte (${strongest}) contradice a la mayoría`;
  } else if (catalog === null) {
    status = "propuesta";
  } else {
    status = same(catalog, winner.value) ? "coincide" : "discrepancia";
  }
  return { status, value: winner.value, catalog, bySource, support: winner.families, ...(note ? { note } : {}) };
}

const earliest = (values: number[]) => Math.min(...values);
const mostCommon = <T>(values: T[]): T => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
};

/** Junta los discos de todas las fuentes confirmadas por obra y vota cada campo. */
export function compareWorks(catalog: CatalogArtist, profiles: SourceProfile[]): WorkComparison[] {
  const confirmed = profiles.filter((profile) => profile.identity.status === "matched");
  const works = new Map<string, { title: string; album: CatalogAlbum | null; releases: Array<{ source: ProfileSourceSlug; release: ProfileRelease }> }>();
  for (const album of catalog.albums) {
    const key = workKey(album.title);
    if (!works.has(key)) works.set(key, { title: album.title, album, releases: [] });
  }
  for (const profile of confirmed) {
    for (const release of profile.releases) {
      const key = workKey(release.title);
      if (!key) continue;
      const work = works.get(key) ?? { title: release.title, album: null, releases: [] };
      work.releases.push({ source: profile.source, release });
      works.set(key, work);
    }
  }
  const result: WorkComparison[] = [];
  for (const [key, work] of works) {
    // Una fuente puede listar varias ediciones de la misma obra: el año es el
    // más antiguo y las pistas, las de la edición más común.
    const bySource = new Map<ProfileSourceSlug, ProfileRelease[]>();
    for (const { source, release } of work.releases) bySource.set(source, [...(bySource.get(source) ?? []), release]);
    const pick = <T>(read: (release: ProfileRelease) => T | null, collapse: (values: T[]) => T) =>
      Object.fromEntries([...bySource].map(([source, releases]) => {
        const values = releases.map(read).filter((value): value is T => value !== null && value !== undefined);
        return [source, values.length ? collapse(values) : null];
      })) as Partial<Record<ProfileSourceSlug, T | null>>;
    const year = voteField(pick((release) => release.year, earliest), work.album?.year ?? null,
      { priority: ["musicbrainz", "discogs", "distribuidor", "lastfm"], collapse: earliest });
    // Las plataformas solas no corrigen un año: suelen dar el de la subida digital.
    if (year.support.length === 1 && year.support[0] === "distribuidor" && (year.status === "propuesta" || year.status === "discrepancia")) {
      year.note = "solo plataformas: puede ser la fecha de subida digital";
      if (year.status === "discrepancia") year.status = "dudoso";
    }
    const trackCount = voteField(pick((release) => release.trackCount, mostCommon), work.album && work.album.trackTitles.length ? work.album.trackTitles.length : null,
      { priority: ["distribuidor", "musicbrainz", "discogs", "lastfm"], collapse: mostCommon });
    const label = voteField(pick((release) => release.label, mostCommon), work.album?.label ?? null,
      { priority: ["discogs", "musicbrainz", "distribuidor", "lastfm"], collapse: mostCommon, same: (a, b) => normalizeIdentitySecondary(a) === normalizeIdentitySecondary(b) });
    result.push({
      key, title: work.album?.title ?? work.title, catalogAlbumId: work.album?.id ?? null,
      families: [...new Set(work.releases.map(({ source }) => SOURCE_FAMILY[source]))].filter((family) => !NON_VOTING.includes(family)),
      year, trackCount, label,
      tracks: compareTracks(work.album, bySource, trackCount.value),
      types: Object.fromEntries([...bySource].map(([source, releases]) => [source, releases.map((release) => release.type).find(Boolean) ?? null])),
      covers: Object.fromEntries([...bySource].flatMap(([source, releases]) => {
        const cover = releases.map((release) => release.coverUrl).find(Boolean);
        return cover ? [[source, cover]] : [];
      })),
    });
  }
  return result.sort((a, b) => Number(b.catalogAlbumId !== null) - Number(a.catalogAlbumId !== null)
    || b.families.length - a.families.length || (a.year.value ?? 9999) - (b.year.value ?? 9999));
}

/**
 * Lista de pistas: se propone la de una fuente cuyo número de pistas coincide
 * con el votado, y cada pista cuenta cuántas familias la nombran igual.
 */
function compareTracks(album: CatalogAlbum | null, bySource: Map<ProfileSourceSlug, ProfileRelease[]>, count: number | null): WorkComparison["tracks"] {
  const lists = [...bySource].flatMap(([source, releases]) => releases.filter((release) => release.tracks.length).map((release) => ({ source, tracks: release.tracks })));
  if (!lists.length) return { status: "sin_datos", proposed: [], agreement: 0, from: null };
  const order: ProfileSourceSlug[] = ["itunes", "deezer", "musicbrainz", "discogs", "lastfm"];
  const chosen = lists.filter((list) => count === null || list.tracks.length === count)
    .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))[0] ?? lists[0]!;
  const familiesFor = (title: string) => new Set(lists.filter((list) => list.tracks.some((track) => sameTrack(track, title)))
    .map((list) => SOURCE_FAMILY[list.source]).filter((family) => !NON_VOTING.includes(family))).size;
  const agreement = Math.min(...chosen.tracks.map(familiesFor));
  if (album && album.trackTitles.length) {
    const missing = chosen.tracks.filter((track) => ![...album.trackTitles, ...(album.trackAliases ?? [])].some((own) => sameTrack(own, track)));
    return { status: missing.length ? "discrepancia" : "coincide", proposed: chosen.tracks, agreement, from: chosen.source, ...(missing.length ? { note: `no están en la ficha: ${missing.join(" · ")}` } : {}) };
  }
  const single = chosen.tracks.filter((track) => familiesFor(track) < 2);
  return { status: single.length ? "dudoso" : "propuesta", proposed: chosen.tracks, agreement, from: chosen.source,
    ...(single.length ? { note: `${chosen.tracks.length - single.length}/${chosen.tracks.length} pistas en dos o más familias; solo en una: ${single.join(" · ")}` } : {}) };
}

export interface ArtistComparison {
  country: FieldVote<string>;
  beginYear: FieldVote<number>;
  birthYear: FieldVote<number>;
  tags: Partial<Record<ProfileSourceSlug, string[]>>;
}

export function compareArtist(catalog: CatalogArtist, profiles: SourceProfile[]): ArtistComparison {
  const confirmed = profiles.filter((profile) => profile.identity.status === "matched");
  const country = voteField(Object.fromEntries(confirmed.map((profile) => [profile.source, profile.country])), catalog.country,
    { priority: ["musicbrainz", "discogs", "lastfm", "distribuidor"], collapse: mostCommon, same: (a, b) => normalizeIdentitySecondary(a) === normalizeIdentitySecondary(b) });
  const years = (kind: "born" | "formed") => Object.fromEntries(confirmed.map((profile) => [profile.source, (profile.beginKind ?? "formed") === kind ? profile.beginYear : null]));
  const beginYear = voteField(years("formed"), catalog.formedYear, { priority: ["musicbrainz", "discogs", "lastfm", "distribuidor"], collapse: earliest });
  const birthYear = voteField(years("born"), catalog.birthYear ?? null, { priority: ["musicbrainz", "discogs", "lastfm", "distribuidor"], collapse: earliest });
  return { country, beginYear, birthYear, tags: Object.fromEntries(confirmed.filter((profile) => profile.tags.length).map((profile) => [profile.source, profile.tags])) };
}
