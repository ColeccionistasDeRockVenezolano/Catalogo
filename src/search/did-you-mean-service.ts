import { getPool } from "../db/client.js";
import { normalizeEntityName } from "../normalization/entity-name.js";
import { searchIndexEntries, searchIndexVersion, type IndexedKind } from "../api/search-index.js";
import { buildFuzzyIndex, MIN_LENGTH, suggest, type FuzzyIndex, type FuzzyKind, type Suggestion } from "./did-you-mean.js";

/** Tipos que se comparan. Las pistas se incluyen: sus títulos también se escriben mal. */
export const FUZZY_KINDS: readonly FuzzyKind[] = ["artist", "album", "organization", "person", "track"];

export interface DidYouMeanHit { type: FuzzyKind; id: number; label: string; context: string | null; albumId: number | null }

// Un índice aproximado por tipo, atado a la identidad del array de entradas: cada recarga del índice lo sustituye y
// el nuestro se reconstruye solo la primera vez que hace falta (no hay que invalidarlo a mano).
const built = new WeakMap<object, FuzzyIndex>();
async function fuzzyIndex(kind: FuzzyKind): Promise<FuzzyIndex> {
  const entries = await searchIndexEntries(kind as IndexedKind);
  let index = built.get(entries);
  if (!index) { index = buildFuzzyIndex(kind, entries); built.set(entries, index); }
  return index;
}

const CACHE_TTL_MS = 60_000, CACHE_MAX = 500;
const cache = new Map<string, { at: number; version: number; hits: DidYouMeanHit[] }>();
export function clearDidYouMeanCache(): void { cache.clear(); }

async function hydrate(found: Suggestion[]): Promise<DidYouMeanHit[]> {
  const ids = (kind: FuzzyKind) => found.filter(item => item.kind === kind).map(item => item.id);
  const db = getPool();
  const [albums, tracks, artists] = await Promise.all([
    ids("album").length ? db.query<{ id: string; artist_name: string }>(
      `SELECT al.id::text, a.name AS artist_name FROM ingest.catalog_albums al JOIN ingest.catalog_artists a ON a.id = al.artist_id WHERE al.id = ANY($1::bigint[])`, [ids("album")]) : null,
    ids("track").length ? db.query<{ id: string; album_id: string; album_title: string; artist_name: string }>(
      `SELECT t.id::text, al.id::text AS album_id, al.title AS album_title, ar.name AS artist_name FROM ingest.catalog_tracks t
         JOIN ingest.catalog_albums al ON al.id = t.album_id JOIN ingest.catalog_artists ar ON ar.id = al.artist_id WHERE t.id = ANY($1::bigint[])`, [ids("track")]) : null,
    ids("artist").length ? db.query<{ id: string; origin_city: string | null }>(
      `SELECT id::text, origin_city FROM ingest.catalog_artists WHERE id = ANY($1::bigint[])`, [ids("artist")]) : null,
  ]);
  const albumCtx = new Map(albums?.rows.map(row => [Number(row.id), row.artist_name]));
  const trackCtx = new Map(tracks?.rows.map(row => [Number(row.id), row]));
  const artistCtx = new Map(artists?.rows.map(row => [Number(row.id), row.origin_city]));
  return found.map(item => {
    const track = item.kind === "track" ? trackCtx.get(item.id) : undefined;
    return { type: item.kind, id: item.id, label: item.name, albumId: track ? Number(track.album_id) : null,
      context: item.kind === "album" ? albumCtx.get(item.id) ?? null : track ? `${track.artist_name} · ${track.album_title}` : item.kind === "artist" ? artistCtx.get(item.id) ?? null : null };
  });
}

/** Sugerencias para una consulta que no encontró nada. Nunca lanza: una sugerencia es opcional. */
export async function didYouMean(q: string): Promise<{ hits: DidYouMeanHit[]; ms: number }> {
  const started = performance.now();
  try {
    const needle = normalizeEntityName(q).secondaryKey;
    if (needle.length < MIN_LENGTH) return { hits: [], ms: performance.now() - started };
    const version = searchIndexVersion();
    const cached = cache.get(needle);
    if (cached && cached.version === version && Date.now() - cached.at < CACHE_TTL_MS) return { hits: cached.hits, ms: performance.now() - started };
    const indexes = await Promise.all(FUZZY_KINDS.map(fuzzyIndex));
    const hits = await hydrate(suggest(needle, indexes));
    cache.delete(needle); cache.set(needle, { at: Date.now(), version, hits });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return { hits, ms: performance.now() - started };
  } catch { return { hits: [], ms: performance.now() - started }; }
}
