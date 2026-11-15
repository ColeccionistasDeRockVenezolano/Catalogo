// CRV · Datos de la tarjeta de disco para fichas de persona y organización.
//
// Estandarización de personas y organizaciones (Brian, 2026-11-14): sus discos
// se muestran con la misma tarjeta (portada, titular, año, tipo y
// características) que la discografía del artista. Se leen de una sola vez
// para los ids que la ficha reunió.
import { getPool } from "../../db/client.js";
import { B_SIDES_SQL, LIVE_SQL } from "./albums.js";
import { ALBUM_EDITION_TYPES_SQL } from "./album-categories.js";

export interface AlbumCard {
  albumId: number;
  title: string;
  releaseYear: number | null;
  albumType: string;
  coverUrl: string | null;
  isLive: boolean;
  isBSides: boolean;
  classifications: Array<{ classification: string }>;
  editionTypes: string[];
  artistId: number;
  artistName: string;
}

/** Tarjetas de los discos visibles del catálogo, por id; los retirados no vuelven. */
export async function albumCardsByIds(ids: readonly number[]): Promise<Map<number, AlbumCard>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { rows } = await getPool().query<AlbumCard>(
    `SELECT al.id::int AS "albumId", al.title, al.release_year AS "releaseYear", al.album_type::text AS "albumType",
            al.cover_url AS "coverUrl", ${LIVE_SQL} AS "isLive", ${B_SIDES_SQL} AS "isBSides", ${ALBUM_EDITION_TYPES_SQL} AS "editionTypes",
            (SELECT coalesce(jsonb_agg(jsonb_build_object('classification', c.classification) ORDER BY c.position, c.id), '[]'::jsonb)
               FROM ingest.effective_album_classifications c WHERE c.album_id = al.id) AS classifications,
            ar.id::int AS "artistId", ar.name AS "artistName"
       FROM ingest.catalog_albums al JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
      WHERE al.id = ANY($1::bigint[])`,
    [unique],
  );
  return new Map(rows.map((row) => [row.albumId, row]));
}

/** Orden cronológico de las fichas: año ascendente, sin año al final; empate por título. */
export function byYearThenTitle<T>(year: (item: T) => number | null, title: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ya = year(a);
    const yb = year(b);
    if (ya !== yb) return ya === null ? 1 : yb === null ? -1 : ya - yb;
    return title(a).localeCompare(title(b), "es");
  };
}
