// CRV · Índice de búsqueda en memoria (PHASES E11.9; plan P12).
//
// LA BASE ES `SQL_ASCII` Y NO SABE COMPARAR SIN TILDES: `lower('ÁNGEL')` sigue
// devolviendo `Ángel` y `ILIKE '%jose%'` no encuentra «José» (regla 0.1.11 del
// plan). Con ~10k personas, cargar nombres y alias (dos SELECT, <1 MB) y
// filtrar en Node es más barato y exacto que cualquier truco en SQL.
//
// REFRESCO SIN BLOQUEAR (auditoría de rendimiento #2). Antes, al vencer el TTL
// de 60 s, la primera búsqueda pagaba la recarga completa dentro de su propia
// petición: medido entre 0,2–0,6 s con la caché del disco fría y hasta 24–30 s
// con el disco ocupado (contenedores de prueba, respaldos), porque PostgreSQL
// vive en un HDD. Ahora el patrón es stale-while-revalidate: una lectura con
// el índice vencido recibe LO QUE HAY y dispara el refresco de fondo —uno solo
// a la vez, con 5 s de espera tras un fallo—. Bloquea únicamente el primer
// uso absoluto: sin datos no hay nada que servir.
//
// LA INVALIDACIÓN ES UN AVISO, NO UN BORRADO: `invalidateSearchIndex()` marca
// los índices vencidos y ARRANCA el refresco en el acto —la escritura recién
// confirmada deja la base caliente y la recarga cuesta ~100 ms—. Una lectura
// que llegue en ese instante sirve el índice anterior; la siguiente ya ve el
// cambio. Es el precio de no colgar a nadie detrás de una recarga larga.
//
// CONSULTAS CORTAS Y RELEVANCIA (2026-10-13). Sin mínimo de caracteres, «a»
// coincidía por «contiene» con ~47k entradas y ordenarlas costaba ~100 ms de
// CPU por consulta, con la API bloqueada. Ahora el orden (relevancia y luego
// alfabético) se calcula UNA vez al cargar y cada consulta recorre la lista
// ya ordenada repartiendo en niveles: nombre o alias idéntico, empieza por,
// alguna palabra empieza por y contiene. Por debajo de MIN_CONTAINS_LENGTH no
// hay nivel «contiene»: una o dos letras solo encuentran comienzos. Las
// siglas son alias documentados (`acronym`), no se calculan: «DP» encuentra
// a Desorden Público porque su alias lo dice.
//
// LAS PISTAS TAMBIÉN VIVEN AQUÍ. Antes eran un `ILIKE '%q%'` sobre ~121k filas
// en cada consulta (~40 ms de base con 3 letras, ~285 ms con una); ahora
// ninguna búsqueda recorre tablas: la base solo resuelve los ids ganadores.
import { getPool } from "../db/client.js";
import { moduleLogger } from "../logger/index.js";
import { normalizeEntityName } from "../normalization/entity-name.js";

export type IndexedKind = "person" | "artist" | "organization" | "album" | "track";

export interface SearchIndexEntry {
  id: number;
  name: string;
  /** Claves comparables: el nombre propio y cada alias, sin tildes ni mayúsculas. */
  keys: string[];
  /** Relevancia para ordenar dentro de cada nivel (ver WEIGHT_SQL); a igual peso, alfabético. */
  weight: number;
}

/** Por debajo de este largo (normalizado) no se busca «contiene», solo comienzos. */
export const MIN_CONTAINS_LENGTH = 3;
const collator = new Intl.Collator("es");

const log = moduleLogger("api:search-index");

/**
 * Vencimiento por tipo. Las escrituras de la API invalidan al momento; el
 * vencimiento solo cubre lo que escriben los scripts en otro proceso. Las
 * pistas (~121k + ~77k alias, ~2 s de recarga) vencen a los 15 minutos para
 * no releer esa tabla cada minuto.
 */
const TTL_MS: Readonly<Record<IndexedKind, number>> = {
  artist: 60_000, person: 60_000, organization: 60_000, album: 60_000, track: 15 * 60_000,
};
/** Tras un fallo, espacio antes de volver a intentar (no castigar la base). */
const REFRESH_RETRY_MS = 5_000;

const SOURCES: Readonly<Record<IndexedKind, { aliasTable: string; aliasColumn: string }>> = {
  album: { aliasTable: "ingest.album_aliases", aliasColumn: "album_id" },
  person: { aliasTable: "ingest.person_aliases", aliasColumn: "person_id" },
  artist: { aliasTable: "ingest.artist_aliases", aliasColumn: "artist_id" },
  organization: { aliasTable: "ingest.organization_aliases", aliasColumn: "organization_id" },
  track: { aliasTable: "ingest.track_aliases", aliasColumn: "track_id" },
};

// Relevancia: cuánto pesa cada ficha en el catálogo. Artista = sus discos;
// persona = sus créditos e integraciones; organización = discos y pistas en
// que aparece; disco y pista = los discos de su artista (un tema de Los
// Melódicos antes que uno de un demo). Se agrega con un solo recorrido por
// tabla (GROUP BY), no con una subconsulta por fila. «Various Artists» no
// pesa (como en la portada): sus 200+ recopilatorios y los alias con sus
// nombres lo pondrían primero en casi cualquier búsqueda.
const ARTIST_ALBUMS = `(SELECT al.artist_id, count(*) AS n FROM ingest.catalog_albums al JOIN ingest.catalog_artists x ON x.id = al.artist_id
  WHERE lower(x.name) NOT IN ('various artists', 'varios artistas') GROUP BY al.artist_id)`;
const ENTITY_SQL: Readonly<Record<IndexedKind, string>> = {
  artist: `SELECT a.id::text, a.name, coalesce(w.n, 0)::text AS weight
             FROM ingest.catalog_artists a LEFT JOIN ${ARTIST_ALBUMS} w ON w.artist_id = a.id`,
  person: `SELECT p.id::text, p.name, (coalesce(tc.n, 0) + coalesce(ac.n, 0) + coalesce(am.n, 0))::text AS weight
             FROM public.persons p
             LEFT JOIN (SELECT person_id, count(*) AS n FROM ingest.catalog_track_credits WHERE person_id IS NOT NULL GROUP BY person_id) tc ON tc.person_id = p.id
             LEFT JOIN (SELECT person_id, count(*) AS n FROM ingest.catalog_album_credits WHERE person_id IS NOT NULL GROUP BY person_id) ac ON ac.person_id = p.id
             LEFT JOIN (SELECT person_id, count(*) AS n FROM public.artist_members GROUP BY person_id) am ON am.person_id = p.id`,
  organization: `SELECT o.id::text, o.name, (coalesce(tc.n, 0) + coalesce(ac.n, 0))::text AS weight
             FROM public.organizations o
             LEFT JOIN (SELECT organization_id, count(*) AS n FROM ingest.catalog_track_credits WHERE organization_id IS NOT NULL GROUP BY organization_id) tc ON tc.organization_id = o.id
             LEFT JOIN (SELECT organization_id, count(*) AS n FROM ingest.catalog_album_credits WHERE organization_id IS NOT NULL GROUP BY organization_id) ac ON ac.organization_id = o.id`,
  album: `SELECT al.id::text, al.title AS name, a.name AS context, coalesce(w.n, 0)::text AS weight
             FROM ingest.catalog_albums al JOIN ingest.catalog_artists a ON a.id = al.artist_id LEFT JOIN ${ARTIST_ALBUMS} w ON w.artist_id = al.artist_id`,
  // Las pistas solo se buscan por su título y sus alias, como antes: «desorden»
  // no debe traer cada tema de Desorden Público (para eso están sus discos).
  track: `SELECT t.id::text, t.title AS name, coalesce(w.n, 0)::text AS weight
             FROM ingest.catalog_tracks t JOIN ingest.catalog_albums al ON al.id = t.album_id LEFT JOIN ${ARTIST_ALBUMS} w ON w.artist_id = al.artist_id`,
};

/**
 * El índice de un tipo: las entradas en su orden y, para recorrerlas rápido,
 * todas sus claves en UNA cadena (`haystack`): cada entrada empieza con
 * ENTRY_MARK y separa sus claves con KEY_MARK. `offsets[i]` es donde empieza la
 * entrada i. Buscar con `indexOf` sobre esa cadena es varias veces más rápido
 * que preguntar clave por clave, y con una o dos letras basta buscar los
 * comienzos (marca + consulta, espacio + consulta) en vez de cada aparición.
 */
interface IndexData {
  entries: SearchIndexEntry[];
  haystack: string;
  offsets: Int32Array;
  /**
   * Claves de una o dos letras («C4», «SS», «pm») → entradas, en su orden. Con
   * ellas una consulta corta conoce sus idénticos sin recorrer todo, y puede
   * cortar el recorrido en cuanto llena el nivel «empieza por».
   */
  shortExact: Map<string, number[]>;
}

const ENTRY_MARK = "\u0001";
const KEY_MARK = "\u0002";
const EMPTY_INDEX: IndexData = { entries: [], haystack: "", offsets: new Int32Array(0), shortExact: new Map() };

function buildIndexData(entries: SearchIndexEntry[]): IndexData {
  const offsets = new Int32Array(entries.length);
  const parts: string[] = [];
  const shortExact = new Map<string, number[]>();
  let length = 0;
  entries.forEach((entry, index) => {
    offsets[index] = length;
    for (const key of new Set(entry.keys)) {
      if (key.length < MIN_CONTAINS_LENGTH) shortExact.set(key, [...(shortExact.get(key) ?? []), index]);
    }
    const part = ENTRY_MARK + entry.keys.join(KEY_MARK);
    parts.push(part);
    length += part.length;
  });
  return { entries, haystack: parts.join(""), offsets, shortExact };
}

/** Índice de la entrada que contiene la posición `position` del haystack. */
function entryAt(offsets: Int32Array, position: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= position) low = middle; else high = middle - 1;
  }
  return low;
}

interface CacheEntry {
  data: IndexData;
  /** true desde la primera carga con éxito (aunque el catálogo esté vacío). */
  loaded: boolean;
  /** Momento de la última carga con éxito. */
  loadedAt: number;
  /** Una invalidación pidió refresco: la próxima lectura sirve lo que hay y refresca. */
  stale: boolean;
  /** Último fallo (0 = ninguno): espacia los reintentos. */
  failureAt: number;
}

const cache = new Map<IndexedKind, CacheEntry>();
/** Sube con cada carga exitosa: las cachés de resultados lo usan para no servir datos viejos. */
let version = 0;
/** Cargas en vuelo: una sola por tipo, compartida por quien la espere. */
const inFlight = new Map<IndexedKind, Promise<void>>();

function entryFor(kind: IndexedKind): CacheEntry {
  let entry = cache.get(kind);
  if (!entry) {
    entry = { data: EMPTY_INDEX, loaded: false, loadedAt: 0, stale: false, failureAt: 0 };
    cache.set(kind, entry);
  }
  return entry;
}

/** Copia nueva de la cadena, reservada ahora (y no un trozo de la original). */
function flatCopy(value: string): string {
  return Buffer.from(value, "utf8").toString("utf8");
}

async function loadEntries(kind: IndexedKind): Promise<SearchIndexEntry[]> {
  const source = SOURCES[kind];
  const [entities, aliases] = await Promise.all([
    getPool().query<{ id: string; name: string; context?: string; weight: string }>(ENTITY_SQL[kind]),
    getPool().query<{ owner_id: string; alias: string }>(
      `SELECT ${source.aliasColumn}::text AS owner_id, alias FROM ${source.aliasTable}`),
  ]);
  const byId = new Map<number, SearchIndexEntry>();
  for (const row of entities.rows) {
    const key = normalizeEntityName(row.name).secondaryKey;
    const keys=key ? [key] : [];
    if(row.context) keys.push(normalizeEntityName(row.context).secondaryKey,normalizeEntityName(`${row.name} ${row.context}`).secondaryKey);
    byId.set(Number(row.id), { id: Number(row.id), name: row.name, keys, weight: Number(row.weight) });
  }
  for (const row of aliases.rows) {
    const entry = byId.get(Number(row.owner_id));
    const key = normalizeEntityName(row.alias).secondaryKey;
    if (entry && key && !entry.keys.includes(key)) entry.keys.push(key);
  }
  // El orden (relevancia, luego alfabético) se paga aquí, una vez por carga, y
  // no en cada consulta. Las entradas se vuelven a crear en ese orden para que
  // queden contiguas en memoria: recorrerlas dispersas (orden de id) hacía la
  // consulta 3–4× más lenta.
  return [...byId.values()]
    .sort((left, right) => right.weight - left.weight || collator.compare(left.name, right.name))
    .map((entry) => ({ ...entry, keys: entry.keys.map(flatCopy) }));
}

/** Carga y guarda; el fallo sube (bloqueante) y queda fechado para el reintento. */
async function loadInto(kind: IndexedKind): Promise<void> {
  const entry = entryFor(kind);
  try {
    const entries = await loadEntries(kind);
    entry.data = buildIndexData(entries);
    entry.loaded = true;
    entry.loadedAt = Date.now();
    entry.stale = false;
    entry.failureAt = 0;
    version += 1;
  } catch (error) {
    entry.failureAt = Date.now();
    throw error;
  }
}

/** Carga compartida: dos lecturas simultáneas sin datos pagan una sola carga. */
function loadOnce(kind: IndexedKind): Promise<void> {
  const running = inFlight.get(kind);
  if (running) return running;
  const promise = loadInto(kind).finally(() => inFlight.delete(kind));
  inFlight.set(kind, promise);
  return promise;
}

/**
 * Refresco de fondo: nunca lanza y, si falla, conserva el índice anterior
 * (mejor viejo que una búsqueda caída). Un solo refresco por tipo a la vez.
 */
function refreshInBackground(kind: IndexedKind, onError?: (error: unknown) => void): Promise<void> {
  const running = inFlight.get(kind);
  if (running) return running;
  const entry = entryFor(kind);
  if (entry.failureAt !== 0 && Date.now() - entry.failureAt < REFRESH_RETRY_MS) return Promise.resolve();
  return loadOnce(kind).catch((error: unknown) => {
    log.warn({ err: error, kind }, "no se pudo refrescar el índice de búsqueda; se sirve el anterior");
    onError?.(error);
  });
}

/**
 * Fuerza la recarga (de uno o de los tres) y espera a que termine. La usan el
 * arranque y las pruebas; en operación normal basta la invalidación al escribir.
 */
export async function refreshSearchIndex(kind?: IndexedKind): Promise<void> {
  const kinds = kind ? [kind] : Object.keys(SOURCES) as IndexedKind[];
  await Promise.all(kinds.map((current) => refreshInBackground(current)));
}

async function indexFor(kind: IndexedKind): Promise<IndexData> {
  const entry = cache.get(kind);
  if (entry?.loaded) {
    if (entry.stale || Date.now() - entry.loadedAt >= TTL_MS[kind]) void refreshInBackground(kind);
    return entry.data;
  }
  // Primer uso absoluto: no hay índice anterior que servir.
  await loadOnce(kind);
  return entryFor(kind).data;
}

/**
 * Ids que coinciden con la consulta (sin tildes ni mayúsculas), por niveles:
 * nombre o alias idéntico, empieza por, alguna palabra empieza por y, con
 * MIN_CONTAINS_LENGTH o más, contiene. Dentro de cada nivel manda el orden
 * precalculado (relevancia, luego alfabético): nada se ordena por consulta.
 * Vacío si la consulta no tiene nada que comparar.
 */
export async function searchIds(kind: IndexedKind, q: string, limit = Number.POSITIVE_INFINITY): Promise<number[]> {
  const needle = normalizeEntityName(q).secondaryKey;
  if (!needle || limit <= 0) return [];
  const { entries, haystack, offsets, shortExact } = await indexFor(kind);
  const wordStart = ` ${needle}`;
  const allowContains = needle.length >= MIN_CONTAINS_LENGTH;
  // Qué buscar en el haystack: la consulta en cualquier parte o, si es corta,
  // solo donde empieza una entrada, una clave o una palabra. Cada patrón es un
  // cursor; se avanza siempre por el más cercano para respetar el orden.
  const patterns = allowContains ? [needle] : [ENTRY_MARK + needle, KEY_MARK + needle, wordStart];
  const cursors = patterns.map((pattern) => haystack.indexOf(pattern));
  const tiers: number[][] = [[], [], [], []];
  // Consulta corta: los idénticos salen del mapa y el recorrido ya no los busca.
  const exact = allowContains ? null : new Set(shortExact.get(needle) ?? []);
  if (exact) tiers[0] = [...exact].slice(0, limit).map((index) => entries[index]!.id);
  for (;;) {
    let position = -1;
    for (const cursor of cursors) if (cursor !== -1 && (position === -1 || cursor < position)) position = cursor;
    if (position === -1) break;
    const index = entryAt(offsets, position);
    const entry = entries[index]!;
    let tier = exact?.has(index) ? 0 : -1;
    for (const key of entry.keys) {
      if (!key.includes(needle)) continue;
      const current = key === needle ? 0 : key.startsWith(needle) ? 1 : key.includes(wordStart) ? 2 : allowContains ? 3 : -1;
      if (current !== -1 && (tier === -1 || current < tier)) tier = current;
      if (tier === 0) break;
    }
    // Ningún nivel necesita guardar más que el límite: lo demás no se devolvería.
    // Los idénticos de una consulta corta ya vienen del mapa.
    if (tier !== -1 && !(exact && tier === 0) && tiers[tier]!.length < limit) tiers[tier]!.push(entry.id);
    // Lo que falta por recorrer ya no puede desplazar a lo reunido: con el nivel
    // de idénticos lleno, nada; en una consulta corta (idénticos ya conocidos),
    // con idénticos + «empieza por» llenando el límite, tampoco.
    if (tiers[0]!.length >= limit || (exact && tiers[0]!.length + tiers[1]!.length >= limit)) break;
    // Siguiente entrada: cada cursor salta a la primera aparición después de esta.
    const next = index + 1 < offsets.length ? offsets[index + 1]! : haystack.length;
    for (let cursor = 0; cursor < cursors.length; cursor += 1) {
      if (cursors[cursor] !== -1 && cursors[cursor]! < next) cursors[cursor] = haystack.indexOf(patterns[cursor]!, next);
    }
  }
  return tiers.flat().slice(0, limit);
}

/** Versión del índice (sube con cada carga): clave para cachés de resultados. */
export function searchIndexVersion(): number {
  return version;
}

/**
 * Sin `kind`, invalida todos los índices. Se llama al terminar cualquier
 * escritura del catálogo: marca lo servido como vencido y refresca ya, sin
 * bloquear a quien escribió ni a quien lea en el intervalo.
 */
export function invalidateSearchIndex(kind?: IndexedKind): void {
  const kinds = kind ? [kind] : Object.keys(SOURCES) as IndexedKind[];
  for (const current of kinds) {
    const entry = cache.get(current);
    // Importers also call this after each batch. A process that has never
    // served this index has no cached results to refresh; its first read
    // will load the current catalog normally.
    if (!entry) continue;
    entry.stale = true;
    void refreshInBackground(current);
  }
}

/**
 * Carga los índices de entidades. Se llama al arrancar la API —en segundo plano y sin
 * bloquear el `listen`— para que la primera búsqueda real no sea la que pague
 * la lectura completa (~900 ms en caliente; en frío, lo que diga el disco).
 * Con los índices ya frescos no hace nada.
 */
export async function warmSearchIndex(onError?: (error: unknown) => void): Promise<void> {
  await Promise.all((Object.keys(SOURCES) as IndexedKind[]).map(async (kind) => {
    const entry = cache.get(kind);
    if (entry?.loaded && !entry.stale && Date.now() - entry.loadedAt < TTL_MS[kind]) return;
    await refreshInBackground(kind, onError);
  }));
}

/** Cuántos tipos de índice están cargados (diagnóstico y sondas). */
export function searchIndexSize(): number {
  return [...cache.values()].filter((entry) => entry.loaded).length;
}
