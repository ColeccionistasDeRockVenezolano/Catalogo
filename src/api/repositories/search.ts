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
import { getPool } from "../../db/client.js";
import { normalizeEntityName } from "../../normalization/entity-name.js";
import { ApiError } from "../http-errors.js";
import { ALL_SEARCH_TYPES, type SearchEntityType } from "../schemas.js";
import { searchIds, searchIndexVersion, type IndexedKind } from "../search-index.js";

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

/** Hits de una entidad indexada: el orden lo manda el índice (los que empiezan primero). */
async function searchIndexed<T extends { id: string; name: string; image_url: string | null }>(
  kind: IndexedKind, q: string, limit: number, type: SearchEntityType,
  sql: string, context: (row: T) => string | null,
): Promise<SearchHit[]> {
  const ids = await searchIds(kind, q, limit);
  if (ids.length === 0) return [];
  const { rows } = await getPool().query<T>(sql, [ids]);
  return rows.map((row) => ({ type, id: Number(row.id), label: row.name, context: context(row), albumId: null, imageUrl: row.image_url }));
}

async function searchArtists(q: string, limit: number): Promise<SearchHit[]> {
  return searchIndexed<{ id: string; name: string; origin_city: string | null; image_url: string | null }>("artist", q, limit, "artist",
    `SELECT a.id::text AS id, a.name, a.origin_city, coalesce(a.picture_url, a.logo_url) AS image_url FROM ingest.catalog_artists a
      WHERE a.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], a.id)`,
    (row) => row.origin_city);
}

async function searchPersons(q: string, limit: number): Promise<SearchHit[]> {
  return searchIndexed<{ id: string; name: string; nationality: string | null; image_url: string | null }>("person", q, limit, "person",
    `SELECT p.id::text AS id, p.name, p.nationality, p.picture_url AS image_url FROM public.persons p
      WHERE p.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], p.id)`,
    (row) => row.nationality);
}

async function searchAlbums(q: string, limit: number): Promise<SearchHit[]> {
  return searchIndexed<{id:string;name:string;artist_name:string;image_url:string|null}>("album",q,limit,"album",
    `SELECT al.id::text,al.title AS name,a.name AS artist_name,al.cover_url AS image_url FROM ingest.catalog_albums al JOIN ingest.catalog_artists a ON a.id=al.artist_id
     WHERE al.id=ANY($1::bigint[]) ORDER BY array_position($1::bigint[],al.id)`,row=>row.artist_name);
}

async function searchTracks(q: string, limit: number): Promise<SearchHit[]> {
  const ids = await searchIds("track", q, limit);
  if (ids.length === 0) return [];
  const { rows } = await getPool().query<{ id: string; title: string; album_id: string; album_title: string; artist_name: string; image_url: string | null }>(
    `SELECT t.id::text, t.title, al.id::text AS album_id, al.title AS album_title, ar.name AS artist_name, al.cover_url AS image_url
       FROM ingest.catalog_tracks t
       JOIN ingest.catalog_albums al ON al.id = t.album_id
       JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
      WHERE t.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], t.id)`,
    [ids],
  );
  return rows.map((row) => ({
    type: "track", id: Number(row.id), label: row.title, context: `${row.artist_name} · ${row.album_title}`,
    albumId: Number(row.album_id), imageUrl: row.image_url,
  }));
}

async function searchOrganizations(q: string, limit: number): Promise<SearchHit[]> {
  return searchIndexed<{ id: string; name: string; organization_type: string | null; image_url: string | null }>("organization", q, limit, "organization",
    `SELECT o.id::text AS id, o.name, o.organization_type, o.picture_url AS image_url FROM public.organizations o
      WHERE o.id = ANY($1::bigint[]) ORDER BY array_position($1::bigint[], o.id)`,
    (row) => row.organization_type);
}

const SEARCHERS: Record<SearchEntityType, (q: string, limit: number) => Promise<SearchHit[]>> = {
  artist: searchArtists,
  person: searchPersons,
  album: searchAlbums,
  track: searchTracks,
  organization: searchOrganizations,
};

type SearchResult = Record<SearchEntityType, SearchHit[]>;

const RESULT_TTL_MS = 60_000;
const RESULT_CACHE_MAX = 1_000;
/** Búsquedas distintas resolviéndose a la vez; por encima se responde 503 (cada una son ~10–30 ms de CPU). */
const MAX_UNCACHED_IN_FLIGHT = 24;
let uncachedInFlight = 0;
/** Respuestas recientes (orden de inserción = antigüedad) y consultas en vuelo. */
const resultCache = new Map<string, { at: number; promise: Promise<SearchResult> }>();
export function clearSearchResults(): void { resultCache.clear(); }

export async function globalSearch(
  q: string, limit: number, types: readonly SearchEntityType[] = ALL_SEARCH_TYPES,
  observe?: (cache: "hit" | "miss") => void,
): Promise<SearchResult> {
  const needle = normalizeEntityName(q).secondaryKey;
  const key = `${searchIndexVersion()}|${needle}|${limit}|${[...types].sort().join(",")}`;
  const cached = resultCache.get(key);
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) { observe?.("hit"); return cached.promise; }
  observe?.("miss");
  if (uncachedInFlight >= MAX_UNCACHED_IN_FLIGHT) {
    throw new ApiError(503, "search_busy", "El buscador está ocupado; intenta de nuevo en un momento");
  }
  uncachedInFlight += 1;
  const promise = runSearch(q, limit, types).finally(() => { uncachedInFlight -= 1; });
  resultCache.delete(key);
  resultCache.set(key, { at: Date.now(), promise });
  // Un fallo no se guarda: la siguiente petición vuelve a intentarlo.
  promise.catch(() => { if (resultCache.get(key)?.promise === promise) resultCache.delete(key); });
  while (resultCache.size > RESULT_CACHE_MAX) resultCache.delete(resultCache.keys().next().value!);
  return promise;
}

async function runSearch(q: string, limit: number, types: readonly SearchEntityType[]): Promise<SearchResult> {
  const entries = await Promise.all(types.map(async (type) => [type, await SEARCHERS[type](q, limit)] as const));
  const result = {} as SearchResult;
  for (const [type, hits] of entries) result[type] = hits;
  for (const type of ALL_SEARCH_TYPES) result[type] ??= [];
  return result;
}
