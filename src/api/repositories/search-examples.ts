// CRV · Ejemplos rotativos del buscador por tipo (persona, artista, disco, organización).
//
// Antes la web elegía 8 posiciones al azar del listado completo y pedía cada una
// con `offset` profundo: 9 listados por carga de página. Con los conteos por
// persona eso saturó el pool y la CPU (incidente 2026-11-08). Ahora una sola
// consulta barata por tipo y día, ordenada por un hash sembrado con la fecha del
// ciclo editorial, y compartida por todos los visitantes del proceso.
import { getPool } from "../../db/client.js";
import { ReadCache } from "../../shared/read-cache.js";

export const SEARCH_EXAMPLE_SCOPES = ["artist", "person", "album", "organization"] as const;
export type SearchExampleScope = typeof SEARCH_EXAMPLE_SCOPES[number];
export interface SearchExampleRow { id: number; label: string }

const SAMPLE = 24;
// Nombres de al menos 3 caracteres con alguna letra: evita «?», «-», «12».
const LABEL_OK = (column: string) => `length(btrim(${column})) >= 3 AND ${column} ~ '[[:alpha:]]'`;
const SQL: Record<SearchExampleScope, string> = {
  artist: `SELECT id::text AS id, name AS label FROM ingest.catalog_artists
            WHERE ${LABEL_OK("name")} ORDER BY md5(id::text || $1) LIMIT ${SAMPLE}`,
  person: `SELECT id::text AS id, name AS label FROM public.persons
            WHERE ${LABEL_OK("name")} ORDER BY md5(id::text || $1) LIMIT ${SAMPLE}`,
  album: `SELECT al.id::text AS id, al.title AS label FROM ingest.catalog_albums al
            JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
           WHERE ${LABEL_OK("al.title")} ORDER BY md5(al.id::text || $1) LIMIT ${SAMPLE}`,
  organization: `SELECT id::text AS id, name AS label FROM public.organizations
            WHERE ${LABEL_OK("name")} ORDER BY md5(id::text || $1) LIMIT ${SAMPLE}`,
};

// 4 tipos × 2 días (el ciclo que termina y el nuevo) caben de sobra.
const cache = new ReadCache<SearchExampleRow[]>(16);
const TTL_MS = 6 * 60 * 60 * 1000;

async function load(scope: SearchExampleScope, date: string): Promise<SearchExampleRow[]> {
  const client = await getPool().connect();
  let released = false;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query<{ id: string; label: string }>(SQL[scope], [`${date}:search:${scope}`]);
    await client.query("COMMIT");
    return result.rows.map(row => ({ id: Number(row.id), label: row.label }));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (rollbackError) { client.release(rollbackError as Error); released = true; }
    throw error;
  } finally {
    if (!released) client.release();
  }
}

/** Muestra diaria y estable: misma fecha, mismos ejemplos para todos. */
export function searchExamples(scope: SearchExampleScope, date: string): Promise<SearchExampleRow[]> {
  return cache.get(`${scope}:${date}`, TTL_MS, () => load(scope, date));
}

export function clearSearchExamples(): void { cache.clear(); }
