// CRV · Búsqueda global (PHASES §E7A: "búsqueda global... los alias
// participan"). El nombre/título propio o cualquiera de sus alias
// (ingest.*_aliases) puede matchear.
//
// Todos los tipos —pistas incluidas— buscan en el índice en memoria (E11.9 y
// 2026-10-13): la base es SQL_ASCII y `ILIKE '%jose%'` no encuentra «José», y
// recorrer 121k pistas por consulta era el punto débil frente a ráfagas. La
// base solo resuelve por clave primaria los ids que el índice ya eligió.
//
// CONSULTAS CORTAS SIN RIESGO (2026-10-13): (1) las respuestas se guardan un
// rato en memoria, ligadas a la versión del índice; (2) dos peticiones
// idénticas en vuelo comparten una sola consulta; (3) con demasiadas
// búsquedas distintas a la vez se responde «ocupado» en lugar de encolar sin
// fin. El límite por IP vive en la ruta.
//
// PAGINACIÓN (2026-10-26): además de la página se devuelve `total` por tipo,
// con un tope de recolección (`PAGE_CAP`) para que cueste lo mismo que antes.
// Los títulos que forman una serie («Venezuelademo 1…34») se ordenan por su
// número, no alfabéticamente.
import { getPool } from "../../db/client.js";
import { normalizeEntityName } from "../../normalization/entity-name.js";
import { ApiError } from "../http-errors.js";
import { ALL_SEARCH_TYPES, type SearchEntityType } from "../schemas.js";
import { searchAllIds, searchIndexVersion, type IndexedKind } from "../search-index.js";

export interface SearchHit {
  type: SearchEntityType;
  id: number;
  label: string;
  context: string | null;
  /** Solo `track`: el disco al que pertenece (no tiene ficha propia; se navega al álbum). */
  albumId: number | null;
  /** Miniatura del resultado: portada del disco (también de la pista), foto o logo. */
  imageUrl: string | null;
}

export interface SearchPage {
  hits: SearchHit[];
  /** Coincidencias conocidas, hasta PAGE_CAP; la paginación se apoya en este tope. */
  total: number;
}

/** Tope de coincidencias que se recolectan por tipo y consulta. */
export const PAGE_CAP = 200;

/** Series con número final: mismo texto y distinto número → orden numérico. */
function seriesNumber(label: string): { prefix: string; n: number } | null {
  const match = /^(.*?)(\d{1,3})$/.exec(label.trim());
  if (!match) return null;
  return { prefix: match[1]!.trim().toLowerCase(), n: Number(match[2]) };
}

function sortSeries(hits: SearchHit[]): SearchHit[] {
  const parsed = hits.map((hit) => seriesNumber(hit.label));
  if (parsed.some((value) => value === null)) return hits;
  const prefixes = new Set(parsed.map((value) => value!.prefix));
  if (prefixes.size !== 1) return hits;
  return [...hits].sort((left, right) => seriesNumber(left.label)!.n - seriesNumber(right.label)!.n);
}

/** Hits de una entidad indexada: el orden lo manda el índice (los que empiezan primero). */
async function searchIndexed<T extends { id: string; name: string; image_url: string | null }>(
  kind: IndexedKind, q: string, limit: number, type: SearchEntityType,
  sql: string, context: (row: T) => string | null,
  options: { offset?: number; series?: boolean } = {},
): Promise<SearchPage> {
  const offset = Math.max(0, options.offset ?? 0);
  const cap = Math.min(PAGE_CAP, Math.max(offset + limit, 50));
  const all = await searchAllIds(kind, q, options.series ? PAGE_CAP : cap);
  if (all.length === 0) return { hits: [], total: 0 };
  const { rows } = await getPool().query<T>(sql, [all]);
  const hits = rows.map((row) => ({ type, id: Number(row.id), label: row.name, context: context(row), albumId: null, imageUrl: row.image_url }));
  const ordered = options.series ? sortSeries(hits) : hits;
  return { hits: ordered.slice(offset, offset + limit), total: ordered.length };
}

async function searchArtists(q: string, limit: number, offset: number): Promise<SearchPage> {
  return searchIndexed<{ id: string; name: string; origin_city: string | null; image_url: string | null }>("artist", q, limit, "artist",
    `SELECT a.id::text AS id, a.name, a.origin_city, coalesce(a.picture_url, a.logo_url) AS image_url FROM ingest.catalog_artists a
      WHERE a.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], a.id)`,
    (row) => row.origin_city, { offset });
}

async function searchPersons(q: string, limit: number, offset: number): Promise<SearchPage> {
  return searchIndexed<{ id: string; name: string; nationality: string | null; image_url: string | null }>("person", q, limit, "person",
    `SELECT p.id::text AS id, p.name, p.nationality, p.picture_url AS image_url FROM public.persons p
      WHERE p.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], p.id)`,
    (row) => row.nationality, { offset });
}

async function searchAlbums(q: string, limit: number, offset: number): Promise<SearchPage> {
  return searchIndexed<{ id: string; name: string; artist_name: string; image_url: string | null }>("album", q, limit, "album",
    `SELECT al.id::text,al.title AS name,a.name AS artist_name,al.cover_url AS image_url FROM ingest.catalog_albums al JOIN ingest.catalog_artists a ON a.id=al.artist_id
     WHERE al.id=ANY($1::bigint[]) ORDER BY array_position($1::bigint[],al.id)`, row => row.artist_name,
    { offset, series: true });
}

async function searchTracks(q: string, limit: number, offset: number): Promise<SearchPage> {
  const cap = Math.min(PAGE_CAP, Math.max(offset + limit, 50));
  const all = await searchAllIds("track", q, cap);
  if (all.length === 0) return { hits: [], total: 0 };
  const { rows } = await getPool().query<{ id: string; title: string; album_id: string; album_title: string; artist_name: string; image_url: string | null }>(
    `SELECT t.id::text, t.title, al.id::text AS album_id, al.title AS album_title, ar.name AS artist_name, al.cover_url AS image_url
       FROM ingest.catalog_tracks t
       JOIN ingest.catalog_albums al ON al.id = t.album_id
       JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
      WHERE t.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], t.id)`,
    [all],
  );
  const hits = rows.map((row) => ({
    type: "track" as const, id: Number(row.id), label: row.title, context: `${row.artist_name} · ${row.album_title}`,
    albumId: Number(row.album_id), imageUrl: row.image_url,
  }));
  return { hits: hits.slice(offset, offset + limit), total: hits.length };
}

async function searchOrganizations(q: string, limit: number, offset: number): Promise<SearchPage> {
  return searchIndexed<{ id: string; name: string; organization_type: string | null; image_url: string | null }>("organization", q, limit, "organization",
    `SELECT o.id::text AS id, o.name, o.organization_type, o.picture_url AS image_url FROM public.organizations o
      WHERE o.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], o.id)`,
    (row) => row.organization_type, { offset });
}

const SEARCHERS: Record<SearchEntityType, (q: string, limit: number, offset: number) => Promise<SearchPage>> = {
  artist: searchArtists,
  person: searchPersons,
  album: searchAlbums,
  track: searchTracks,
  organization: searchOrganizations,
};

type SearchResult = Record<SearchEntityType, SearchHit[]>;
type SearchTotals = Record<SearchEntityType, number>;
/** Forma plana (una clave por tipo, como siempre) más `totals` para paginar. */
export type GlobalSearchResult = SearchResult & { totals: SearchTotals };

const RESULT_TTL_MS = 60_000;
const RESULT_CACHE_MAX = 1_000;
/** Búsquedas distintas resolviéndose a la vez; por encima se responde 503 (cada una son ~10–30 ms de CPU). */
const MAX_UNCACHED_IN_FLIGHT = 24;
let uncachedInFlight = 0;
/** Respuestas recientes (orden de inserción = antigüedad) y consultas en vuelo. */
const resultCache = new Map<string, { at: number; promise: Promise<GlobalSearchResult> }>();
export function clearSearchResults(): void { resultCache.clear(); }

export async function globalSearch(
  q: string, limit: number, types: readonly SearchEntityType[] = ALL_SEARCH_TYPES,
  observe?: (cache: "hit" | "miss") => void, offset = 0,
): Promise<GlobalSearchResult> {
  const needle = normalizeEntityName(q).secondaryKey;
  const key = `${searchIndexVersion()}|${needle}|${limit}|${offset}|${[...types].sort().join(",")}`;
  const cached = resultCache.get(key);
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) { observe?.("hit"); return cached.promise; }
  observe?.("miss");
  if (uncachedInFlight >= MAX_UNCACHED_IN_FLIGHT) {
    throw new ApiError(503, "search_busy", "El buscador está ocupado; intenta de nuevo en un momento");
  }
  uncachedInFlight += 1;
  const promise = runSearch(q, limit, offset, types).finally(() => { uncachedInFlight -= 1; });
  resultCache.delete(key);
  resultCache.set(key, { at: Date.now(), promise });
  // Un fallo no se guarda: la siguiente petición vuelve a intentarlo.
  promise.catch(() => { if (resultCache.get(key)?.promise === promise) resultCache.delete(key); });
  while (resultCache.size > RESULT_CACHE_MAX) resultCache.delete(resultCache.keys().next().value!);
  return promise;
}

async function runSearch(q: string, limit: number, offset: number, types: readonly SearchEntityType[]): Promise<GlobalSearchResult> {
  const entries = await Promise.all(types.map(async (type) => [type, await SEARCHERS[type](q, limit, offset)] as const));
  const result = {} as SearchResult;
  const totals = {} as SearchTotals;
  for (const [type, page] of entries) { result[type] = page.hits; totals[type] = page.total; }
  for (const type of ALL_SEARCH_TYPES) { result[type] ??= []; totals[type] ??= 0; }
  return { ...result, totals };
}
