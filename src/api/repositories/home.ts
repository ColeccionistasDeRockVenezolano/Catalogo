// CRV · Portada del catálogo: cifras, épocas, canal de YouTube,
// artista del día, un disco para escuchar y sellos. Todo sale del core y
// Las selecciones rotan con la fecha de Venezuela; los videos se consultan
// directamente al canal oficial y las cifras reflejan el catálogo actual.
import { getPool } from "../../db/client.js";
import { publicGenresFor, type PublicGenre } from "../../genres/public.js";
import { similarArtists } from "./artist-neighbors.js";
import { artistGroupSql } from "./artist-groups.js";
import { CRV_CHANNEL_ID, CRV_CHANNEL_URL, latestChannelSnapshot } from "../../youtube/home-channel.js";
import { dailyCycleForDate, dayNumber, type DailyCycle } from "../../shared/daily-cycle.js";
import { imageFocus, type ImageFocus } from "../../storage/image-focus.js";
export { dailyDate as caracasToday, dayNumber } from "../../shared/daily-cycle.js";

/** Décadas que la portada ofrece en «Por época», de la más vieja a la más nueva. */
export const ERA_DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020] as const;
const ERA_LIMIT = 12;
/** Discos por década que entran al sorteo del día antes de equilibrar géneros. */
const ERA_POOL = 120;
const VIDEO_LIMIT = 8;
const LISTEN_LIMIT = 6;
const LABEL_LIMIT = 8;
const SIMILAR_LIMIT = 6;
const BIO_EXCERPT = 320;
const NOT_VARIOUS = (name: string) => `lower(${name}) NOT IN ('various artists', 'varios artistas')`;

export interface HomeAlbum {
  id: number; title: string; releaseYear: number | null; albumType: string;
  artistId: number; artistName: string; coverUrl: string | null; genres: PublicGenre[];
}

export interface HomeData {
  dailyCycle: DailyCycle;
  date: string;
  wall: HomeAlbum[];
  channel: { url: string; checkedAt: string | null; stale: boolean };
  stats: { artists: number; albums: number; tracks: number; persons: number; firstYear: number | null; lastYear: number | null };
  eras: Array<{ decade: number; total: number; albums: HomeAlbum[] }>;
  videos: Array<{
    videoId: string; title: string | null; publishedAt: string | null; thumbnailUrl: string | null;
    album: { id: number; title: string } | null; artist: { id: number; name: string } | null;
  }>;
  featuredArtist: {
    id: number; name: string; artistType: string; pictureUrl: string | null; excerpt: string;
    /** Caja de rostros de la foto (fracciones 0–1) para encuadrarla en cualquier recuadro. */
    pictureFocus: ImageFocus | null;
    originCity: string | null; startYear: number | null; albumCount: number; genre: string | null; primaryGenre: PublicGenre | null;
    album: HomeAlbum | null;
    similar: Array<{ id: number; name: string; pictureUrl: string | null }>;
  } | null;
  listen: Array<HomeAlbum & { links: Array<{ platform: string; url: string }> }>;
  labels: Array<{ id: number; name: string; pictureUrl: string | null; albumCount: number; fromYear: number | null; toYear: number | null }>;
}

type AlbumRow = {
  id: string; title: string; release_year: number | null; album_type: string;
  artist_id: string; artist_name: string; cover_url: string | null;
};

const ALBUM_COLUMNS = `al.id, al.title, al.release_year, al.album_type::text AS album_type,
  ar.id AS artist_id, ar.name AS artist_name, al.cover_url`;

function toAlbum(row: AlbumRow): HomeAlbum {
  return {
    id: Number(row.id), title: row.title, releaseYear: row.release_year, albumType: row.album_type,
    artistId: Number(row.artist_id), artistName: row.artist_name, coverUrl: row.cover_url, genres: [],
  };
}

/** Primeras frases de la biografía, cortadas en un final de frase o, si no hay, en una palabra. */
export function bioExcerpt(text: string, max = BIO_EXCERPT): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= max * 0.45) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return `${head.slice(0, word > 0 ? word : max).replace(/[,;:\s]+$/u, "")}…`;
}

export async function getHomeData(date: string): Promise<HomeData> {
  const pool = getPool();
  const [stats, eras, videos, listen, labels, featured, wall, channel] = await Promise.all([
    pool.query<{ artists: string; albums: string; tracks: string; persons: string; first_year: number | null; last_year: number | null }>(
      `SELECT (SELECT count(*) FROM ingest.catalog_artists)::text AS artists,
              (SELECT count(*) FROM ingest.catalog_albums)::text AS albums,
              (SELECT count(*) FROM ingest.catalog_tracks)::text AS tracks,
              (SELECT count(*) FROM public.persons)::text AS persons,
              (SELECT min(release_year) FROM ingest.catalog_albums) AS first_year,
              (SELECT max(release_year) FROM ingest.catalog_albums) AS last_year`),
    // Por década, una tanda nueva cada día: se sortean con la fecha los discos con portada
    // (primero los propios: estudio, EP, en vivo) y se intercalan las familias de género.
    // Un título repetido en el mismo año (fichas dobles del mismo disco) sale una sola vez.
    pool.query<AlbumRow & { decade: number; total: string }>(
      `WITH candidates AS (
         SELECT DISTINCT ON (al.release_year, lower(al.title)) ${ALBUM_COLUMNS},
                (al.release_year / 10) * 10 AS decade,
                count(*) OVER (PARTITION BY (al.release_year / 10) * 10)::text AS total
           FROM ingest.catalog_albums al JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
          WHERE (al.release_year / 10) * 10 = ANY($1::int[])
          ORDER BY al.release_year, lower(al.title), (al.cover_url IS NULL), al.id
       ), pooled AS (
         SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY decade
           ORDER BY (cover_url IS NULL), (album_type IN ('studio_album', 'ep', 'live_album')) DESC, md5(id::text || $2)) AS draw
           FROM candidates) drawn WHERE draw <= $4
       ), balanced AS (
         SELECT pooled.*, genre.family, row_number() OVER (PARTITION BY decade, genre.family
           ORDER BY (cover_url IS NULL), (album_type IN ('studio_album', 'ep', 'live_album')) DESC, md5(id::text || $2)) AS genre_round
         FROM pooled LEFT JOIN LATERAL (
           SELECT COALESCE(g.family_id, g.id) AS family FROM ingest.album_genres ag
           JOIN ingest.genre_lineage g ON g.id = ag.genre_id
           WHERE ag.album_id = pooled.id AND ag.status = 'confirmed'
           ORDER BY (ag.role = 'primary') DESC, g.id LIMIT 1
         ) genre ON true
       ), ranked AS (
         SELECT *, row_number() OVER (PARTITION BY decade
           ORDER BY genre_round, (cover_url IS NULL), (family IS NULL),
             (album_type IN ('studio_album', 'ep', 'live_album')) DESC, md5(id::text || $2)) AS rn FROM balanced
       ) SELECT * FROM ranked WHERE rn <= $3 ORDER BY decade, rn`, [[...ERA_DECADES], date, ERA_LIMIT, ERA_POOL]),
    pool.query<{ video_id: string; title: string | null; published_at: string | null; thumbnail_url: string | null;
      album_id: string | null; album_title: string | null; artist_id: string | null; artist_name: string | null }>(
      `SELECT v.video_id, v.title, v.published_at::text AS published_at, v.thumbnail_url,
              al.id AS album_id, al.title AS album_title, ar.id AS artist_id, ar.name AS artist_name
         FROM media.youtube_videos v
         LEFT JOIN LATERAL (SELECT vab.album_id FROM media.video_albums vab WHERE vab.video_id = v.id
                             ORDER BY vab.is_primary_link DESC, vab.album_id LIMIT 1) va ON true
         LEFT JOIN ingest.catalog_albums al ON al.id = va.album_id
         LEFT JOIN LATERAL (SELECT vr.artist_id FROM media.video_artists vr WHERE vr.video_id = v.id
                             ORDER BY (vr.relation_kind = 'performer') DESC, vr.artist_id LIMIT 1) vr ON true
         LEFT JOIN ingest.catalog_artists ar ON ar.id = vr.artist_id
        WHERE v.publication_status = 'published' AND v.channel_id = $2
        ORDER BY v.published_at DESC NULLS LAST, v.id DESC
        LIMIT $1`, [VIDEO_LIMIT, CRV_CHANNEL_ID]),
    pool.query<AlbumRow & { links: Array<{ platform: string; url: string }> }>(
      `WITH eligible AS (SELECT ${ALBUM_COLUMNS},
              (SELECT jsonb_agg(jsonb_build_object('platform', sl.platform, 'url', sl.url) ORDER BY sl.platform)
                 FROM public.streaming_links sl WHERE sl.album_id = al.id AND sl.verified) AS links
         FROM ingest.catalog_albums al JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
        WHERE al.cover_url IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.streaming_links sl WHERE sl.album_id = al.id AND sl.verified)
        ), ranked AS (SELECT *, row_number() OVER (ORDER BY md5(id::text)) - 1 AS position, count(*) OVER () AS size FROM eligible)
        SELECT * FROM ranked
        ORDER BY mod(position - mod($1::bigint * $2, size) + size, size)
        LIMIT $2`, [dayNumber(date), LISTEN_LIMIT]),
    pool.query<{ id: string; name: string; picture_url: string | null; album_count: string; from_year: number | null; to_year: number | null }>(
      `WITH eligible AS (SELECT o.id, o.name, o.picture_url, count(*)::text AS album_count,
              min(al.release_year) AS from_year, max(al.release_year) AS to_year
         FROM public.organizations o JOIN ingest.catalog_albums al ON al.label_id = o.id
        GROUP BY o.id ORDER BY count(*) DESC, o.name LIMIT 40)
        SELECT * FROM eligible ORDER BY md5(id::text || $2)
        LIMIT $1`, [LABEL_LIMIT, date]),
    featuredArtist(date),
    pool.query<AlbumRow>(`SELECT ${ALBUM_COLUMNS} FROM ingest.catalog_albums al
      JOIN ingest.catalog_artists ar ON ar.id = al.artist_id WHERE al.cover_url IS NOT NULL
      ORDER BY md5(al.id::text || $1) LIMIT 90`, [date]),
    latestChannelSnapshot(),
  ]);

  const s = stats.rows[0]!;
  const groups = new Map<number, HomeData["eras"][number]>();
  for (const row of eras.rows) {
    const group = groups.get(row.decade) ?? { decade: row.decade, total: Number(row.total), albums: [] };
    group.albums.push(toAlbum(row));
    groups.set(row.decade, group);
  }

  const homeWall = wall.rows.map(toAlbum);
  const homeListen = listen.rows.map(row => ({ ...toAlbum(row), links: row.links ?? [] }));
  const albums = [...homeWall, ...homeListen, ...[...groups.values()].flatMap(group => group.albums), ...(featured?.album ? [featured.album] : [])];
  const albumGenres = await publicGenresFor("album", albums.map(album => album.id));
  for (const album of albums) album.genres = albumGenres.get(album.id)?.genres ?? [];
  return {
    dailyCycle: dailyCycleForDate(date),
    date,
    wall: homeWall,
    channel: { url: CRV_CHANNEL_URL, checkedAt: channel.checkedAt, stale: channel.stale },
    stats: {
      artists: Number(s.artists), albums: Number(s.albums), tracks: Number(s.tracks), persons: Number(s.persons),
      firstYear: s.first_year, lastYear: s.last_year,
    },
    eras: [...groups.values()].sort((a, b) => a.decade - b.decade),
    videos: (channel.checkedAt ? channel.videos.map(video => {
      const known = videos.rows.find(row => row.video_id === video.videoId);
      return { ...video, album: known?.album_id ? { id: Number(known.album_id), title: known.album_title! } : null,
        artist: known?.artist_id ? { id: Number(known.artist_id), name: known.artist_name! } : null };
    }) : videos.rows.map((row) => ({
      videoId: row.video_id, title: row.title, publishedAt: row.published_at, thumbnailUrl: row.thumbnail_url,
      album: row.album_id ? { id: Number(row.album_id), title: row.album_title! } : null,
      artist: row.artist_id ? { id: Number(row.artist_id), name: row.artist_name! } : null,
    }))),
    featuredArtist: featured,
    listen: homeListen,
    labels: labels.rows.map((row) => ({
      id: Number(row.id), name: row.name, pictureUrl: row.picture_url, albumCount: Number(row.album_count),
      fromYear: row.from_year, toYear: row.to_year,
    })),
  };
}

/** Una ficha completa (foto, biografía y al menos una portada) por día. */
async function featuredArtist(date: string): Promise<HomeData["featuredArtist"]> {
  const pool = getPool();
  const { rows: [row] } = await pool.query<{
    id: string; name: string; artist_type: string; picture_url: string | null; biography: string;
    origin_city: string | null; formed_year: number | null; album_count: string;
  }>(
    // El tipo que se muestra es el grupo público (Banda, Solista, Dúo: artist-groups.ts).
    `WITH eligible AS (SELECT a.id, a.name, ${artistGroupSql("a")} AS artist_type, a.picture_url, a.biography,
            NULLIF(btrim(a.origin_city), '') AS origin_city, a.formed_year,
            (SELECT count(*) FROM ingest.catalog_albums b WHERE b.artist_id = a.id)::text AS album_count
       FROM ingest.catalog_artists a
      WHERE a.picture_url IS NOT NULL AND btrim(COALESCE(a.biography, '')) <> ''
        AND ${NOT_VARIOUS("a.name")}
        AND EXISTS (SELECT 1 FROM ingest.catalog_albums b WHERE b.artist_id = a.id AND b.cover_url IS NOT NULL)
      ) SELECT * FROM eligible ORDER BY md5(id::text)
      LIMIT 1 OFFSET (SELECT mod($1::bigint, greatest(count(*), 1)) FROM eligible)`, [dayNumber(date)]);
  if (!row) return null;
  const id = Number(row.id);
  const [album, genres, focus] = await Promise.all([
    // Disco con portada, priorizando estudio y variando la selección con la fecha.
    pool.query<AlbumRow>(
      `SELECT ${ALBUM_COLUMNS}
         FROM ingest.catalog_albums al JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
        WHERE al.artist_id = $1 AND al.cover_url IS NOT NULL
        ORDER BY (al.album_type = 'studio_album') DESC, md5(al.id::text || $2)
        LIMIT 1`, [id, date]),
    publicGenresFor("artist", [id]),
    imageFocus([row.picture_url]),
  ]);
  const primaryGenre = genres.get(id)?.primaryGenre ?? null;
  const { similar } = await similarArtists(id, primaryGenre);
  const firstAlbumYear = (await pool.query<{ y: number | null }>(
    "SELECT min(release_year) AS y FROM ingest.catalog_albums WHERE artist_id = $1", [id])).rows[0]?.y ?? null;
  return {
    id, name: row.name, artistType: row.artist_type, pictureUrl: row.picture_url,
    pictureFocus: (row.picture_url && focus.get(row.picture_url)) || null,
    excerpt: bioExcerpt(row.biography), originCity: row.origin_city,
    startYear: row.formed_year ?? firstAlbumYear, albumCount: Number(row.album_count),
    genre: primaryGenre?.name ?? null, primaryGenre,
    album: album.rows[0] ? toAlbum(album.rows[0]) : null,
    similar: similar.slice(0, SIMILAR_LIMIT).map((item) => ({ id: item.id, name: item.name, pictureUrl: item.pictureUrl })),
  };
}
