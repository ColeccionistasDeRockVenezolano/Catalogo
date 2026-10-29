import { seriesVolumeOrderSql } from "./series-order.js";
import { compilationSeriesSql } from "./compilation-series.js";
import { CLASSIFICATION_CATEGORIES, classificationFilterLabel } from "../../shared/classification-filters.js";
import { dateValueText, type DateValue } from "../../catalog/date-value.js";
import { B_SIDES_TITLE_SQL_PATTERN } from "../../normalization/b-sides-title.js";
// CRV · Consultas de lectura para discos (PHASES §E7A: "ALBUM DETAIL... una
// de las páginas más importantes"). La ficha agregada trae tracklist,
// créditos (planos y agrupados por credit_type), formatos, alias y enlaces
// de YouTube en una sola consulta.
import { genreStatusOf, type GenreStatus } from "../../merge/genre-projection.js";
import { getPool } from "../../db/client.js";
import { genreFilterSql, genreMissingSql, publicGenresFor, relatedGenreFilterSql, type PublicGenre } from "../../genres/public.js";
import type { PaginationQuery } from "../pagination.js";
import type { CatalogSort } from "../catalog-sort.js";
import { personDisplayNames, withPublicAliases } from "./person-display.js";
import { albumDiscography, type AlbumDiscography } from "./discography.js";
import { ALBUM_EDITION_TYPES_SQL, extraAlbumFilterSql } from "./album-categories.js";
import { parseCategorySelection } from "../../shared/category-selection.js";
import { albumYoutubeVideoId, youtubeVideoId } from "../../shared/youtube-playback.js";
import { CRV_CHANNEL_ID } from "../../youtube/home-channel.js";
import { playableCrvVideoIds } from "../../youtube/playable-crv.js";

export interface AlbumListRow {
  id: number;
  title: string;
  releaseYear: number | null;
  albumType: string;
  isLive: boolean;
  isBSides: boolean;
  classifications: Array<{ classification: string; inferred: boolean }>;
  editionTypes: string[];
  artistId: number;
  artistName: string;
  coverUrl: string | null;
  primaryGenre: PublicGenre | null;
  genreStatus: GenreStatus;
  /** Tiene al menos un género confirmado propio (con `relatedGenre`, los que no lo tienen entraron por su artista). */
  hasOwnGenre: boolean;
}

export interface AlbumListQuery extends PaginationQuery {
  sort?: CatalogSort | undefined;
  q?: string | undefined;
  artistId?: number | undefined;
  /** Slug de género o familia (PLAN_GENEROS §5): solo asignaciones confirmadas. */
  genre?: string | undefined;
  /** Solo discos sin ningún género confirmado. */
  withoutGenre?: boolean | undefined;
  /** Con `genre`: suma los discos sin género propio cuyo artista tiene ese género. */
  relatedGenre?: boolean | undefined;
  decade?: number | undefined;
  withoutYear?: boolean | undefined;
  beforeYear?: number | undefined;
  /** Tipos y características acumulables: todas deben coincidir. */
  albumType?: string | string[] | undefined;
}

/**
 * Filtro de tipo que no es un `album_type` (Brian, 2026-10-14): los B-Sides
 * tienen ficha propia; se reconocen por la clasificación «B-Sides» de la hoja
 * o por llevarlo en el título («B-Side: X», «… (B-Sides)»).
 */
export const B_SIDES_FILTER = "b_sides";
export const B_SIDES_SQL = `(NOT EXISTS(SELECT 1 FROM ingest.album_classification_decisions d WHERE d.album_id=al.id AND d.classification='B-Sides' AND NOT d.selected) AND (al.title ~* '${B_SIDES_TITLE_SQL_PATTERN}'
  OR EXISTS (SELECT 1 FROM ingest.effective_album_classifications c WHERE c.album_id = al.id AND c.classification = 'B-Sides')))`;

/**
 * Disco en vivo (plan v2 del primo, punto 5): el álbum en vivo y, por D2, el
 * sencillo, EP, demo o compilado que conserva su tipo con la clasificación
 * «En vivo» (scripts/apply-live-album-types.ts).
 */
export const LIVE_SQL = `(al.album_type = 'live_album'
  OR EXISTS (SELECT 1 FROM ingest.effective_album_classifications c WHERE c.album_id = al.id AND c.classification = 'En vivo'))`;
export const LIVE_FILTER = "live";

const classificationCategorySql = `CASE c.classification ${Object.entries(CLASSIFICATION_CATEGORIES).map(([label,key])=>`WHEN '${label}' THEN '${key}'`).join(" ")} ELSE 'classification:' || c.classification END`;
function albumListFilters(query: AlbumListQuery) {
  const pattern = query.q ? `%${query.q}%` : null;
  // $1 título · $2 artista · $3 género · $4 década · $5 categorías (Y)
  // $6 solo sin género · $7 sumar por el género del artista
  const filters = `($1::text IS NULL OR al.title ILIKE $1)
          AND ($2::bigint IS NULL OR al.artist_id = $2)
          AND ($3::text IS NULL OR ${genreFilterSql("album", "al.id", "$3")}
               OR ($7::boolean AND ${genreMissingSql("album", "al.id")} AND ${relatedGenreFilterSql("al.id", "$3")}))
          AND ($4::int IS NULL OR (al.release_year >= $4 AND al.release_year < $4 + 10))
          AND NOT EXISTS (SELECT 1 FROM unnest($5::text[]) requested(category)
            WHERE NOT (al.album_type::text = requested.category
               OR (requested.category = '${LIVE_FILTER}' AND ${LIVE_SQL})
               OR EXISTS (SELECT 1 FROM ingest.effective_album_classifications c WHERE c.album_id=al.id
                 AND ${classificationCategorySql} = requested.category)
               OR (requested.category = '${B_SIDES_FILTER}' AND ${B_SIDES_SQL})
               OR ${extraAlbumFilterSql("requested.category")}))
          AND (NOT $6::boolean OR ${genreMissingSql("album", "al.id")})
          AND (NOT $8::boolean OR al.release_year IS NULL)
          AND ($9::int IS NULL OR al.release_year < $9)`;
  const selectedTypes = parseCategorySelection(typeof query.albumType === "string" ? [query.albumType] : query.albumType ?? []).map(value=>{const label=classificationFilterLabel(value);return label===null?value:`classification:${label}`;});
  const params = [pattern, query.artistId ?? null, query.genre ?? null, query.decade ?? null, selectedTypes,
    query.withoutGenre ?? false, query.relatedGenre ?? false, query.withoutYear ?? false, query.beforeYear ?? null];
  return { filters, params };
}

export async function listAlbums(query: AlbumListQuery): Promise<{ rows: AlbumListRow[]; total: number }> {
  // Los títulos que forman serie («Venezuelademo 1…34») se ordenan por su
  // número y no por el texto: si no, el 3 cae detrás del 29.
  const naturalPrefix = `(CASE WHEN al.title ~ '[0-9]+$' THEN regexp_replace(al.title, '[0-9]+$', '') ELSE al.title END)`;
  const naturalNumber = `(CASE WHEN al.title ~ '[0-9]+$' THEN substring(al.title from '([0-9]+)$')::int END)`;
  const orders: Record<CatalogSort, string> = {
    name: `${naturalPrefix} ASC, ${naturalNumber} ASC NULLS LAST, al.title ASC, al.id ASC`,
    name_desc: `${naturalPrefix} DESC, ${naturalNumber} DESC NULLS LAST, al.title DESC, al.id ASC`,
    year_asc: "al.release_year ASC NULLS LAST, al.title ASC, al.id ASC",
    year_desc: "al.release_year DESC NULLS LAST, al.title ASC, al.id ASC",
  };
  const order = orders[query.sort ?? "name"];
  const { filters, params } = albumListFilters(query);
  const [rows, count] = await Promise.all([
    getPool().query<{
      id: string; title: string; release_year: number | null; album_type: string;
      artist_id: string; artist_name: string; cover_url: string | null; genre: string | null;
      is_live: boolean; is_b_sides: boolean;
      classifications: AlbumListRow["classifications"];
      edition_types: string[];
    }>(
      `SELECT al.id, al.title, al.release_year, al.album_type, ar.id AS artist_id, ar.name AS artist_name, al.cover_url, al.genre,
              ${LIVE_SQL} AS is_live, ${B_SIDES_SQL} AS is_b_sides,
              (SELECT coalesce(jsonb_agg(jsonb_build_object('classification', c.classification, 'inferred', c.inferred) ORDER BY c.position, c.id), '[]'::jsonb)
                 FROM ingest.effective_album_classifications c WHERE c.album_id=al.id) AS classifications,
              ${ALBUM_EDITION_TYPES_SQL} AS edition_types
         FROM ingest.catalog_albums al
         JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
        WHERE ${filters}
        ORDER BY ${order}
        LIMIT $10 OFFSET $11`,
      [...params, query.limit, query.offset],
    ),
    getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ingest.catalog_albums al WHERE ${filters}`,
      params,
    ),
  ]);
  const genres = await publicGenresFor("album", rows.rows.map((row) => Number(row.id)),
    new Map(rows.rows.map((row) => [Number(row.id), row.genre])));
  return {
    rows: rows.rows.map((row) => ({
      id: Number(row.id), title: row.title, releaseYear: row.release_year, albumType: row.album_type,
      isLive: row.is_live, isBSides: row.is_b_sides,
      classifications: row.classifications,
      editionTypes: row.edition_types,
      artistId: Number(row.artist_id), artistName: row.artist_name, coverUrl: row.cover_url,
      primaryGenre: genres.get(Number(row.id))?.primaryGenre ?? null,
      genreStatus: genres.get(Number(row.id))?.genreStatus ?? "unclassified",
      hasOwnGenre: (genres.get(Number(row.id))?.genres.length ?? 0) > 0,
    })),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

export interface AlbumCreditRow {
  id: number;
  creditType: string;
  role: string;
  personId: number | null;
  personName: string | null;
  /** «Nombre "Apodo" Apellido» si la persona tiene apodo (solo pantalla). */
  personDisplayName?: string | null;
  personIsDeceased: boolean;
  artistId: number | null;
  artistName: string | null;
  organizationId: number | null;
  organizationName: string | null;
}

/** Un mismo crédito repetido en varias pistas del disco, visto desde el disco. */
export interface ScopedCreditRow extends AlbumCreditRow {
  creditIds: number[];
  tracks: Array<{ discNumber: number; trackNumber: number }>;
}

export interface AlbumTrackRow {
  notes: string | null;
  id: number;
  discNumber: number;
  trackNumber: number;
  title: string;
  durationSeconds: number | null;
  youtubeStartSeconds: number | null;
  /** Letra disponible (0073): el texto se sirve en el detalle de la pista. */
  hasLyrics: boolean;
  credits: AlbumCreditRow[];
}

export interface AlbumDetail {
  releaseDateText: string | null;
  releaseDateValue: string | null;
  catalogId: string | null;
  mediaFormat: string | null;
  id: number;
  title: string;
  releaseYear: number | null;
  albumType: string;
  isLive: boolean;
  isBSides: boolean;
  classifications: Array<{ classification: string; inferred: boolean }>;
  editionTypes: string[];
  genre: string | null;
  /** `confirmed` (principal confirmado), `pending` (texto de fuente sin confirmar) o `unclassified` (PLAN_GENEROS §5). */
  genreStatus: GenreStatus;
  /** Principal confirmado y todos los confirmados (PLAN_GENEROS §5); nunca sugerencias. */
  primaryGenre: PublicGenre | null;
  genres: PublicGenre[];
  coverUrl: string | null;
  description: string | null;
  notes: string | null;
  youtubeUrl: string | null;
  youtubeStatus: string;
  instagramUrl: string | null;
  instagramStatus: string;
  wordpressUrl: string | null;
  wordpressStatus: string;
  artist: { id: number; name: string };
  label: { id: number; name: string } | null;
  tracklist: AlbumTrackRow[];
  credits: AlbumCreditRow[];
  creditsByType: Record<string, AlbumCreditRow[]>;
  /**
   * Créditos de pista agrupados por acreditado, tipo y rol: "Keyboards ·
   * pistas 1, 3, 5, 10". Un invitado del canal casi siempre viene acotado a
   * pistas y, sin esto, no aparecía en la sección del disco.
   */
  scopedCreditsByType: Record<string, ScopedCreditRow[]>;
  formats: Array<{ id: number; format: string; quality: string | null; archiveStatus: string; filePath: string | null; notes: string | null }>;
  /**
   * Cada disco con nombre («Lado A», «CD 2», «DVD») o con enlaces de escucha
   * propios (0063). Sin nombre, la web numera («Disco 2»).
   */
  discs: Array<{ discNumber: number; title: string | null; platforms: Array<{ platform: string; url: string; externalId: string | null }> }>;
  aliases: Array<{ id: number; alias: string; aliasType: string; isPrimary: boolean; publicHidden: boolean }>;
  youtubeLinks: Array<{ videoId: string; title: string | null; kind: string; isPrimaryLink: boolean }>;
  crvYoutubeVideoIds: string[];
  /** El disco en plataformas de escucha (streaming_links, 0039); solo los de identidad verificada. */
  platforms: Array<{ platform: string; url: string; externalId: string | null }>;
  /** Plan del primo, etapa 2 (0068): versiones, sellos con rol, series y créditos en frase. */
  versions: AlbumDiscography["versions"];
  labels: AlbumDiscography["labels"];
  series: AlbumDiscography["series"];
  creditStatements: AlbumDiscography["creditStatements"];
}

const CREDIT_FIELDS = `jsonb_build_object(
    'id', id, 'creditType', credit_type, 'role', role,
    'personId', person_id, 'personName', person_name, 'personIsDeceased', person_is_deceased,
    'artistId', artist_id, 'artistName', artist_name,
    'organizationId', organization_id, 'organizationName', organization_name
  )`;

function creditKey(credit: AlbumCreditRow): string {
  const target = credit.personId !== null ? `p${credit.personId}` : credit.artistId !== null ? `a${credit.artistId}` : credit.organizationId !== null ? `o${credit.organizationId}` : `reference:${credit.artistName}`;
  return `${credit.creditType}|${credit.role.trim().toLowerCase()}|${target}`;
}

/** Agrupa los créditos de pista; lo que ya está acreditado en el disco entero no se repite. */
export function scopedCreditsByType(tracklist: AlbumTrackRow[], albumCredits: AlbumCreditRow[]): Record<string, ScopedCreditRow[]> {
  const albumWide = new Set(albumCredits.map(creditKey));
  const grouped = new Map<string, ScopedCreditRow>();
  for (const track of tracklist) {
    for (const credit of track.credits) {
      const key = creditKey(credit);
      if (albumWide.has(key)) continue;
      const entry = grouped.get(key) ?? { ...credit, creditIds: [], tracks: [] };
      entry.creditIds.push(credit.id);
      entry.tracks.push({ discNumber: track.discNumber, trackNumber: track.trackNumber });
      grouped.set(key, entry);
    }
  }
  const byType: Record<string, ScopedCreditRow[]> = {};
  for (const entry of grouped.values()) (byType[entry.creditType] ??= []).push(entry);
  return byType;
}

export async function getAlbumDetail(id: number): Promise<AlbumDetail | null> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT al.id, al.title, al.release_year, al.album_type, al.genre, al.cover_url,
       ${LIVE_SQL} AS is_live, ${B_SIDES_SQL} AS is_b_sides,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('classification', c.classification, 'inferred', c.inferred) ORDER BY c.position, c.id), '[]'::jsonb)
          FROM ingest.effective_album_classifications c WHERE c.album_id=al.id) AS classifications,
       ${ALBUM_EDITION_TYPES_SQL} AS edition_types,
            al.description, al.notes, al.release_date_text, al.catalog_id, al.media_format, al.youtube_url, al.youtube_status,
       COALESCE((SELECT jsonb_agg(v.video_id) FROM media.youtube_videos v
         WHERE v.channel_id=$2 AND (strpos(al.youtube_url,v.video_id)>0
           OR EXISTS(SELECT 1 FROM media.video_albums va WHERE va.album_id=al.id AND va.video_id=v.id)
           OR EXISTS(SELECT 1 FROM public.album_disc_links dl WHERE dl.album_id=al.id AND dl.platform='youtube' AND strpos(dl.url,v.video_id)>0))), '[]'::jsonb) AS crv_video_ids,
            al.instagram_url, al.instagram_status, al.wordpress_url, al.wordpress_status,
            ar.id AS artist_id, ar.name AS artist_name,
            lbl.id AS label_id, lbl.name AS label_name,
            EXISTS (SELECT 1 FROM ingest.album_genres ag
                     WHERE ag.album_id = al.id AND ag.role = 'primary' AND ag.status = 'confirmed') AS genre_confirmed,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', t.id, 'discNumber', t.disc_number, 'trackNumber', t.track_number,
           'title', t.title, 'durationSeconds', t.duration_seconds,
           'youtubeStartSeconds', t.youtube_start_seconds, 'notes', t.notes,
           'hasLyrics', (t.lyrics IS NOT NULL),
           'credits', COALESCE((
             SELECT jsonb_agg(${CREDIT_FIELDS})
             FROM (
               SELECT tc.id, tc.credit_type, tc.role, COALESCE(tc.person_id, tca.reference_person_id) AS person_id, COALESCE(tcp.name, (SELECT p.name FROM public.persons p WHERE p.id=tca.reference_person_id)) AS person_name,
                      COALESCE(tcp.is_deceased, false) OR tcp.death_date_value IS NOT NULL AS person_is_deceased,
                      tca.public_artist_id AS artist_id, tca.name AS artist_name, tc.organization_id, tco.name AS organization_name
                 FROM public.track_credits tc
                 LEFT JOIN public.persons tcp ON tcp.id = tc.person_id
                 LEFT JOIN ingest.catalog_credit_artists tca ON tca.id = tc.artist_id
                 LEFT JOIN public.organizations tco ON tco.id = tc.organization_id
                WHERE tc.track_id = t.id
             ) credit_rows
           ), '[]'::jsonb)
         ) ORDER BY t.disc_number, t.track_number)
         FROM ingest.catalog_tracks t WHERE t.album_id = al.id
       ), '[]'::jsonb) AS tracklist,
       COALESCE((
         SELECT jsonb_agg(${CREDIT_FIELDS})
         FROM (
           SELECT ac.id, ac.credit_type, ac.role, COALESCE(ac.person_id, aca.reference_person_id) AS person_id, COALESCE(acp.name, (SELECT p.name FROM public.persons p WHERE p.id=aca.reference_person_id)) AS person_name,
                  COALESCE(acp.is_deceased, false) OR acp.death_date_value IS NOT NULL AS person_is_deceased,
                  aca.public_artist_id AS artist_id, aca.name AS artist_name, ac.organization_id, aco.name AS organization_name
             FROM public.album_credits ac
             LEFT JOIN public.persons acp ON acp.id = ac.person_id
             LEFT JOIN ingest.catalog_credit_artists aca ON aca.id = ac.artist_id
             LEFT JOIN public.organizations aco ON aco.id = ac.organization_id
            WHERE ac.album_id = al.id
         ) credit_rows
       ), '[]'::jsonb) AS credits,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('id', f.id, 'format', f.format, 'quality', f.quality, 'archiveStatus', f.archive_status, 'filePath', f.file_path, 'notes', f.notes))
         FROM public.album_formats f WHERE f.album_id = al.id
       ), '[]'::jsonb) AS formats,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('discNumber', n.disc_number, 'title', d.title, 'platforms', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('platform', l.platform, 'url', l.url, 'externalId', l.external_id) ORDER BY l.platform)
                    FROM public.album_disc_links l WHERE l.album_id = al.id AND l.disc_number = n.disc_number AND l.verified
                     AND NOT (l.platform = 'youtube' AND EXISTS (
                       SELECT 1 FROM media.youtube_videos dv
                        WHERE dv.publication_status IN ('unpublished', 'copyright_blocked') AND strpos(l.url, dv.video_id) > 0))
                ), '[]'::jsonb)) ORDER BY n.disc_number)
           FROM (SELECT disc_number FROM public.album_discs WHERE album_id = al.id
                 UNION SELECT disc_number FROM public.album_disc_links WHERE album_id = al.id AND verified) n
           LEFT JOIN public.album_discs d ON d.album_id = al.id AND d.disc_number = n.disc_number
       ), '[]'::jsonb) AS discs,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('id', x.id, 'alias', x.alias, 'aliasType', x.alias_type, 'isPrimary', x.is_primary))
         FROM ingest.album_aliases x WHERE x.album_id = al.id
       ), '[]'::jsonb) AS aliases,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'videoId', v.video_id, 'title', v.title, 'kind', va.album_kind, 'isPrimaryLink', va.is_primary_link
         ) ORDER BY va.is_primary_link DESC, v.published_at)
         FROM media.video_albums va JOIN media.youtube_videos v ON v.id = va.video_id
         -- Un video borrado o bloqueado conserva su enlace, pero no se ofrece (yt:watch).
         WHERE va.album_id = al.id AND v.publication_status NOT IN ('unpublished', 'copyright_blocked')
       ), '[]'::jsonb) AS youtube_links,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('trackId', vt.track_id, 'videoId', v.video_id,
           'startSeconds', vt.start_seconds, 'durationSeconds', v.duration_seconds) ORDER BY
             EXISTS(SELECT 1 FROM media.youtube_tracklist_entries e WHERE e.video_id=v.id AND e.start_seconds=vt.start_seconds) DESC, vt.start_seconds)
           FROM media.video_tracks vt JOIN ingest.catalog_tracks t ON t.id=vt.track_id
           JOIN media.youtube_videos v ON v.id=vt.video_id
          WHERE t.album_id=al.id AND vt.start_seconds >= 0
            AND v.publication_status NOT IN ('unpublished','copyright_blocked')
       ), '[]'::jsonb) AS youtube_occurrences,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('platform', sl.platform, 'url', sl.url, 'externalId', sl.external_id) ORDER BY sl.platform)
           FROM public.streaming_links sl WHERE sl.album_id = al.id AND sl.verified
       ), '[]'::jsonb) AS platforms
     FROM ingest.catalog_albums al
     JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
     LEFT JOIN public.organizations lbl ON lbl.id = al.label_id
     WHERE al.id = $1`,
    [id, CRV_CHANNEL_ID],
  );
  const row = rows[0];
  if (!row) return null;
  const crvIds = row['crv_video_ids'] as string[];
  const allowedCrvIds = await playableCrvVideoIds(crvIds);
  const blockedCrvIds = new Set(crvIds.filter(videoId => !allowedCrvIds.has(videoId)));
  row['youtube_links'] = (row['youtube_links'] as AlbumDetail['youtubeLinks']).filter(link => !blockedCrvIds.has(link.videoId));
  if (blockedCrvIds.has(youtubeVideoId(row['youtube_url'] as string | null) ?? '')) row['youtube_url'] = null;
  for (const disc of row['discs'] as AlbumDetail['discs']) {
    disc.platforms = disc.platforms.filter(link => link.platform !== 'youtube' || !blockedCrvIds.has(youtubeVideoId(link.url) ?? ''));
  }
  const credits = row["credits"] as AlbumCreditRow[];
  const tracklist = row["tracklist"] as AlbumTrackRow[];
  const occurrences = row["youtube_occurrences"] as Array<{ trackId: number; videoId: string; startSeconds: number; durationSeconds: number | null }>;
  const albumVideo = albumYoutubeVideoId({ youtubeLinks: row["youtube_links"] as AlbumDetail["youtubeLinks"],
    youtubeUrl: ["unpublished", "copyright_blocked"].includes(row["youtube_status"] as string) ? null : row["youtube_url"] as string | null });
  const discs = row["discs"] as AlbumDetail["discs"];
  for (const track of tracklist) {
    // El tiempo pertenece al video que se reproduce, incluido el de un CD/lado propio.
    // La reconciliación guarda aquí los tiempos sin tener que sobrescribir el core.
    const own = discs.find(disc => disc.discNumber === track.discNumber)?.platforms.find(link => link.platform === "youtube");
    const videoId = youtubeVideoId(own?.url ?? null) ?? albumVideo;
    const occurrence = occurrences.find(item => item.trackId === track.id && item.videoId === videoId
      && (item.durationSeconds === null || item.startSeconds < item.durationSeconds));
    track.youtubeStartSeconds = occurrence?.startSeconds ?? null;
    const duration = occurrences.find(item => item.videoId === videoId)?.durationSeconds;
    if (duration !== null && duration !== undefined && track.youtubeStartSeconds !== null && track.youtubeStartSeconds >= duration) track.youtubeStartSeconds = null;
  }
  const allCredits = [...credits, ...tracklist.flatMap((track) => track.credits)];
  const displayNames = await personDisplayNames(allCredits.flatMap((credit) => credit.personId === null ? [] : [credit.personId]));
  for (const credit of allCredits) credit.personDisplayName = credit.personId === null ? null : displayNames.get(credit.personId) ?? null;
  const creditsByType: Record<string, AlbumCreditRow[]> = {};
  for (const credit of credits) {
    (creditsByType[credit.creditType] ??= []).push(credit);
  }
  const structuredRelease=(await getPool().query<{release_date:DateValue|null}>("SELECT release_date FROM ingest.catalog_edition_details WHERE album_id=$1",[id])).rows[0]?.release_date;
  const genres = (await publicGenresFor("album", [id], new Map([[id, row["genre"] as string | null]]))).get(id)!;
  const label = row["label_id"] != null ? { id: Number(row["label_id"]), name: row["label_name"] as string } : null;
  return {
    ...await albumDiscography(id, label),
    id: Number(row["id"]),
    title: row["title"] as string,
    releaseYear: row["release_year"] as number | null,
    releaseDateText: row["release_date_text"] as string | null,
    releaseDateValue: structuredRelease?dateValueText(structuredRelease):null,
    catalogId: row["catalog_id"] as string | null,
    mediaFormat: row["media_format"] as string | null,
    albumType: row["album_type"] as string,
    isLive: row["is_live"] as boolean,
    isBSides: row["is_b_sides"] as boolean,
    classifications: row["classifications"] as AlbumDetail["classifications"],
    editionTypes: row["edition_types"] as string[],
    genre: row["genre"] as string | null,
    genreStatus: genreStatusOf(row["genre_confirmed"] === true, row["genre"] as string | null),
    primaryGenre: genres.primaryGenre,
    genres: genres.genres,
    coverUrl: row["cover_url"] as string | null,
    description: row["description"] as string | null,
    notes: row["notes"] as string | null,
    youtubeUrl: ["unpublished", "copyright_blocked"].includes(row["youtube_status"] as string) ? null : row["youtube_url"] as string | null,
    youtubeStatus: row["youtube_status"] as string,
    instagramUrl: row["instagram_url"] as string | null,
    instagramStatus: row["instagram_status"] as string,
    wordpressUrl: row["wordpress_url"] as string | null,
    wordpressStatus: row["wordpress_status"] as string,
    artist: { id: Number(row["artist_id"]), name: row["artist_name"] as string },
    label,
    tracklist,
    credits,
    creditsByType,
    scopedCreditsByType: scopedCreditsByType(tracklist, credits),
    formats: row["formats"] as AlbumDetail["formats"],
    discs: row["discs"] as AlbumDetail["discs"],
    aliases: withPublicAliases(String(row["title"]), row["aliases"] as Array<{ id: number; alias: string; aliasType: string; isPrimary: boolean }>),
    youtubeLinks: row["youtube_links"] as AlbumDetail["youtubeLinks"],
    crvYoutubeVideoIds: [...allowedCrvIds],
    platforms: row["platforms"] as AlbumDetail["platforms"],
  };
}

export interface SeriesListRow {
  id: number; title: string; kind: "compilation" | "sessions"; artistName: string | null; description: string | null; albumCount: number;
  firstYear: number | null; lastYear: number | null; covers: string[];
}

/** Los filtros se evalúan sobre un mismo volumen; la tarjeta siempre representa la serie completa. */
export async function listSeries(query: AlbumListQuery): Promise<{ rows: SeriesListRow[]; total: number }> {
  const { filters, params } = albumListFilters({ ...query, q: undefined });
  params.push(query.q ? `%${query.q}%` : null);
  const where = `${compilationSeriesSql("s")} AND EXISTS (
    SELECT 1 FROM ingest.series_albums sa JOIN ingest.catalog_albums al ON al.id=sa.album_id
    WHERE sa.series_id=s.id AND ${filters}
      AND ($10::text IS NULL OR s.title ILIKE $10 OR al.title ILIKE $10))`;
  const orders: Record<CatalogSort, string> = {
    name: 's.title ASC, s.id ASC', name_desc: 's.title DESC, s.id ASC',
    year_asc: 'first_year ASC NULLS LAST, s.title ASC, s.id ASC',
    year_desc: 'last_year DESC NULLS LAST, s.title ASC, s.id ASC',
  };
  const [rows, count] = await Promise.all([
    getPool().query<{ id: string; title: string; kind: "compilation" | "sessions"; artist_name: string | null; description: string | null; album_count: string;
      first_year: number | null; last_year: number | null; covers: string[] }>(`
      SELECT s.id::text, s.title, s.kind, (SELECT ar.name FROM ingest.catalog_artists ar WHERE ar.id=s.artist_id) artist_name, s.description, v.*
      FROM ingest.series s CROSS JOIN LATERAL (
        SELECT count(*)::text album_count, min(al.release_year) first_year, max(al.release_year) last_year,
          COALESCE(array_agg(al.cover_url ORDER BY ${seriesVolumeOrderSql("sa", "al")})
            FILTER (WHERE al.cover_url IS NOT NULL AND al.cover_url <> ''), '{}') covers
        FROM ingest.series_albums sa JOIN ingest.catalog_albums al ON al.id=sa.album_id WHERE sa.series_id=s.id
      ) v WHERE ${where} ORDER BY ${orders[query.sort ?? 'name']} LIMIT $11 OFFSET $12`, [...params, query.limit, query.offset]),
    getPool().query<{ count: string }>(`SELECT count(*)::text count FROM ingest.series s WHERE ${where}`, params),
  ]);
  return { rows: rows.rows.map(row => ({ id: Number(row.id), title: row.title, kind: row.kind, artistName: row.artist_name, description: row.description,
    albumCount: Number(row.album_count), firstYear: row.first_year, lastYear: row.last_year, covers: [...new Set(row.covers)] })),
    total: Number(count.rows[0]?.count ?? 0) };
}
