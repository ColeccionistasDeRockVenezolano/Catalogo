import { getPool } from "../../db/client.js";
import { B_SIDES_SQL, LIVE_SQL } from "./albums.js";
import { ALBUM_EDITION_TYPES_SQL } from "./album-categories.js";

/**
 * «Aparece en» (Brian, 2026-10-27): los discos de OTRO titular en los que el
 * artista figura como intérprete, invitado o participante, leídos en cada
 * consulta de sus créditos de pista y de disco. No hay lista fija: un compilado
 * o una colaboración nueva aparece en cuanto sus créditos lo nombran.
 *
 * `compilation`: tipo compilado o titular Various Artists; `collaboration`: el
 * resto (disco de otro artista con él como invitado o colaborador).
 */
export type AppearanceKind = "compilation" | "collaboration";

export interface ArtistAppearance {
  albumId: number; title: string; releaseYear: number | null; albumType: string; coverUrl: string | null;
  isLive: boolean; isBSides: boolean; classifications: Array<{ classification: string }>; editionTypes: string[];
  ownerId: number; ownerName: string; kind: AppearanceKind;
  /** Pistas en las que figura, en su orden del disco; vacío si el crédito es del disco entero. */
  tracks: string[];
}

/** Créditos que dicen que suena en el disco; producir, componer o mezclar no es «aparecer». */
const APPEARING_CREDITS = ["musician", "guest", "other"];
/**
 * Roles que no son sonar en el disco aunque vengan como `other`: armar el
 * recopilatorio, arreglar, remezclar, grabar, editar, diseñar, asesorar,
 * representar o firmar la música (eso es composición). Los créditos sin rol
 * especificado sí cuentan: en los compilados son los intérpretes.
 */
const NON_PERFORMING_ROLE =
  "(recopilaci|compil|track selection|selecci[oó]n|arreg|arrang|remez|remix|mixed|mezcl|grabad|recorded|edited|editor|concepto|gr[aá]fic|consult|manager|^\\s*music( by)?\\s*$)";

/**
 * Un crédito de disco que nombra pistas («Tracks 01, 05», «Tracks 01 to 04
 * performed by», «CD1 Tracks 01-02 from Album», «Guest Musicians on track 06»)
 * se lleva a esas pistas. Las posiciones de vinilo (A1, B2) y los roles con
 * varios intérpretes no se leen: sin el largo de cada lado no hay número fiable.
 */
const TRACK_REF = /^(?:.*\bon\s+|cd\s*(\d+)\s+)?tracks?\s+([\d\s,&-]+(?:\s*to\s*\d+)?)(?:\s+(?:performed by|from album))?\s*$/i;

function referencedTracks(role: string): Array<{ disc: number | null; number: number }> {
  const match = TRACK_REF.exec(role.trim());
  if (!match) return [];
  const disc = match[1] ? Number(match[1]) : null;
  const refs: Array<{ disc: number | null; number: number }> = [];
  for (const part of match[2]!.split(/[,&]/)) {
    const range = /^\s*(\d+)\s*(?:-|to)\s*(\d+)\s*$/i.exec(part);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]); n += 1) refs.push({ disc, number: n });
    } else {
      for (const n of part.match(/\d+/g) ?? []) refs.push({ disc, number: Number(n) });
    }
  }
  return refs;
}

interface AppearanceRow extends ArtistAppearance {
  albumRoles: string[];
  albumTracks: Array<{ disc: number | null; number: number | null; title: string }> | null;
}

export async function artistAppearances(artistId: number): Promise<ArtistAppearance[]> {
  const { rows } = await getPool().query<AppearanceRow>(
    `WITH credits AS (
       SELECT t.album_id, t.title AS track_title, t.disc_number, t.track_number, tc.credit_type::text AS credit_type, tc.role
         FROM ingest.catalog_tracks t JOIN public.track_credits tc ON tc.track_id = t.id
        WHERE tc.artist_id = $1
       UNION ALL
       SELECT ac.album_id, NULL, NULL, NULL, ac.credit_type::text, ac.role
         FROM public.album_credits ac WHERE ac.artist_id = $1
     ), appearing AS (
       SELECT * FROM credits WHERE credit_type = ANY($2::text[]) AND coalesce(role, '') !~* $3
     )
     SELECT al.id::int AS "albumId", al.title, al.release_year AS "releaseYear", al.album_type::text AS "albumType",
            al.cover_url AS "coverUrl", ${LIVE_SQL} AS "isLive", ${B_SIDES_SQL} AS "isBSides", ${ALBUM_EDITION_TYPES_SQL} AS "editionTypes",
            (SELECT coalesce(jsonb_agg(jsonb_build_object('classification', c.classification) ORDER BY c.position, c.id), '[]'::jsonb)
               FROM ingest.effective_album_classifications c WHERE c.album_id = al.id) AS classifications,
            aa.id::int AS "ownerId", aa.name AS "ownerName",
            CASE WHEN al.album_type::text = 'compilation' OR lower(aa.name) IN ('various artists', 'varios artistas')
                 THEN 'compilation' ELSE 'collaboration' END AS kind,
            ARRAY(SELECT x.track_title FROM appearing x WHERE x.album_id = al.id AND x.track_title IS NOT NULL
                   GROUP BY x.track_title ORDER BY min(x.disc_number) NULLS LAST, min(x.track_number) NULLS LAST, x.track_title) AS tracks,
            ARRAY(SELECT DISTINCT x.role FROM appearing x WHERE x.album_id = al.id AND x.track_title IS NULL AND x.role IS NOT NULL) AS "albumRoles",
            (SELECT jsonb_agg(jsonb_build_object('disc', t.disc_number, 'number', t.track_number, 'title', t.title) ORDER BY t.disc_number, t.track_number)
               FROM ingest.catalog_tracks t
              WHERE t.album_id = al.id AND EXISTS (SELECT 1 FROM appearing x WHERE x.album_id = al.id AND x.track_title IS NULL AND x.role ~* 'track')) AS "albumTracks"
       FROM ingest.catalog_albums al JOIN ingest.catalog_artists aa ON aa.id = al.artist_id
      WHERE al.artist_id <> $1 AND al.id IN (SELECT album_id FROM appearing)
      ORDER BY al.release_year NULLS LAST, al.title, al.id`,
    [artistId, APPEARING_CREDITS, NON_PERFORMING_ROLE],
  );
  return rows.map(({ albumRoles, albumTracks, ...album }) => {
    const titles = new Set(album.tracks);
    const discs = new Set((albumTracks ?? []).map((track) => track.disc ?? 1));
    for (const ref of albumRoles.flatMap(referencedTracks)) {
      // Sin «CD n» la referencia solo vale si el disco tiene un único CD/lado.
      if (ref.disc === null && discs.size > 1) continue;
      const track = albumTracks?.find((t) => t.number === ref.number && (ref.disc === null || (t.disc ?? 1) === ref.disc));
      if (track) titles.add(track.title);
    }
    const order = new Map((albumTracks ?? []).map((t, index) => [t.title, index]));
    return { ...album, tracks: titles.size === album.tracks.length ? album.tracks
      : [...titles].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity)) };
  });
}
