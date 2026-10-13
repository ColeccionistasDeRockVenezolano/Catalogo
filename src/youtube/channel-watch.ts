// CRV · Los videos del canal entran solos (Brian, 2026-10-13).
//
// Hasta hoy un video nuevo del canal aparecía en la portada (que lee YouTube
// en vivo) pero no llegaba al catálogo: descubrir, hidratar y enlazar eran
// comandos a mano. Este módulo hace dos trabajos programados:
//
//  * VIDEOS NUEVOS (cada hora). Toma los últimos videos del canal que no están
//    en `media.youtube_videos`, los hidrata y decide, con las reglas que fijó
//    Brian el 2026-10-13:
//      - el disco existe con el mismo nombre → se enlaza como video principal;
//      - existe con otro nombre (artículo, alias, «Vol. I/1»…) o lo delata el
//        tracklist → se enlaza, se RENOMBRA al título del canal y el nombre
//        viejo queda como alias;
//      - no existe y el artista es uno solo → SE CREA el disco con sus pistas;
//      - artista nuevo, ambiguo o pruebas a medias → cola `youtube_match`.
//    Los minutos de cada pista salen del tracklist de la descripción y los
//    créditos, de los bloques del canal (credit-sections), igual que el resto.
//  * DISPONIBILIDAD (cada día). Pregunta a la API por todos los videos del
//    canal. El que ya no responde pasa a `unpublished` (o `copyright_blocked`);
//    su enlace NO se borra, pero la API pública deja de ofrecerlo. Si el disco
//    tiene otro video vivo, ese pasa a principal.
//
// Cada video se aplica en su propia transacción-run del operador, así que todo
// queda en el diario de cambios y se puede deshacer por run.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import type { PoolClient } from "pg";
import { getPool } from "../db/client.js";
import { moduleLogger } from "../logger/index.js";
import { OperatorError, createEntity, updateEntity, withOperatorRun, type OperatorContext } from "../merge/operator.js";
import { proposeImageCandidate } from "../merge/image-candidates.js";
import { createAlias } from "../api/repositories/aliases.js";
import { YouTubeDataApi, youtubePublicationStatus, type YouTubeVideoPayload } from "./api.js";
import { CRV_CHANNEL_ID } from "./home-channel.js";
import { youtubeLinkKey } from "./linker.js";
import { canonicalVideoUrl, extractYouTubeVideoId } from "./normalization.js";
import { parseYouTubeTitle } from "./parsers.js";
import { persistVideoPayload } from "./pipeline.js";
import { matchTracklist, reconcileYouTubeChannel, type SnapshotTrack } from "./reconcile.js";
import {
  applyMusicianPlan, applyOtherPlan, planMusicianSections, planOtherCredits, readMusicianSectionInputs, readOtherCreditInputs,
} from "./credit-sections.js";

const log = moduleLogger("youtube:watch");

export const WATCH_OPERATOR = "yt:watch";
const WATCH_NOTE = "videos nuevos del canal: enlace, renombre y alta automáticos (decisión de Brian, 2026-10-13)";
const AVAILABILITY_NOTE = "disponibilidad diaria de los videos del canal (decisión de Brian, 2026-10-13)";
/** Estados en que el video ya no se puede ver: el enlace se conserva, el sitio no lo ofrece. */
export const UNAVAILABLE_STATUSES: ReadonlySet<string> = new Set(["unpublished", "copyright_blocked"]);
const LOG_DIR = "logs/youtube-watch";

// ---------------------------------------------------------------------------
// Título del canal → nombre de disco
// ---------------------------------------------------------------------------

const ARTICLE = /^(?:los|las|el|la|lo|the)\s+/u;
const ROMAN: Readonly<Record<string, number>> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/**
 * El nombre del disco tal como lo escribe el canal, sin los añadidos del
 * canal. `parseYouTubeTitle` ya quita «|| Full Album ||», el año y [EP]; aquí
 * se quita lo demás que se midió en los 600 enlaces existentes: «4K60
 * Remastered», el prefijo «Artista:», la arroba de las menciones y un
 * marcador mal cerrado («| Full Album ||»). `null` si lo que queda no sirve
 * como nombre (vacío, o con corchetes o barras que el parser no supo leer).
 */
export function channelAlbumTitle(rawTitle: string): string | null {
  const parsed = parseYouTubeTitle(rawTitle);
  if (parsed.format && !/^(?:ep|single)$/iu.test(parsed.format)) return null;
  let title = parsed.title.replace(/\s*\|.*$/u, "");
  title = title.replace(/\s+4K\s?\d*(?:\s+Remastered)?\s*$/iu, "");
  if (parsed.artist) {
    const colon = title.indexOf(":");
    if (colon > 0 && youtubeLinkKey(title.slice(0, colon)) === youtubeLinkKey(parsed.artist)) title = title.slice(colon + 1);
  }
  title = title.replace(/@(?=[\p{L}\p{N}])/gu, "").replace(/\s+/gu, " ").trim();
  if (!youtubeLinkKey(title) || /[[\]|]/u.test(title)) return null;
  return title;
}

/**
 * Clave «equivalente» de un nombre de disco: además de tildes y signos, ignora
 * el artículo inicial, «Volume/Volumen/Vol.» y su número romano, «&/y/and» y
 * el «'s». Casa «Los sueños simples» con «Sueños Simples» y «Vol. I» con
 * «Vol. 1»; por sí sola no basta para enlazar (ver `planUpload`).
 */
export function looseAlbumKey(title: string): string {
  let text = title.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLocaleLowerCase("es");
  text = text.replace(/'s\b/gu, "").replace(/&/gu, " ").replace(/\b(?:and|y)\b/gu, " ");
  text = text.replace(/\b(?:volumen|volume|vol)\b\.?\s*([ivx]+|\d+)?\b/gu, (_, n: string | undefined) => {
    const value = n === undefined ? "" : ROMAN[n] ?? n;
    return ` vol ${value} `;
  });
  text = text.replace(/\s+/gu, " ").trim().replace(ARTICLE, "");
  return youtubeLinkKey(text);
}

const LIVE_TITLE = /\b(?:en vivo|live|unplugged|desenchufado|ac[uú]stico)\b/iu;

/** Tipo del disco nuevo: la etiqueta del título manda; si no hay, en vivo por el nombre o de estudio. */
export function albumTypeFor(rawTitle: string, albumTitle: string): string {
  const format = parseYouTubeTitle(rawTitle).format?.toLowerCase();
  if (format === "ep" || format === "single") return format;
  return LIVE_TITLE.test(albumTitle) ? "live_album" : "studio_album";
}

// ---------------------------------------------------------------------------
// Decisión pura (se prueba sin PostgreSQL)
// ---------------------------------------------------------------------------

export interface WatchTrack { id: number; discNumber: number; trackNumber: number; title: string; youtubeStartSeconds: number | null; durationSeconds: number | null; }
export interface WatchAlbum {
  id: number; artistId: number; title: string; year: number | null; aliases: string[]; tracks: WatchTrack[];
  coverUrl: string | null;
  /** Video principal actual y si se puede ver. */
  primary: { videoId: string; available: boolean } | null;
}
export interface WatchVideo {
  videoId: string; title: string; durationSeconds: number | null; publicationStatus: string;
  tracklist: Array<{ position: number; title: string; startSeconds: number }>;
}
export interface WatchCatalog {
  /** Artistas por `youtubeLinkKey` de su nombre o alias. */
  artistsByKey: Map<string, Array<{ id: number; name: string }>>;
  albumsOf: (artistId: number) => WatchAlbum[];
}

export type WatchDecision =
  | { action: "ignore"; reason: string }
  | { action: "review"; reason: string; artistIds: number[]; albumIds: number[] }
  | { action: "link"; artistId: number; albumId: number; rename: string | null; via: string; primary: boolean; fillYear: number | null; reasons: string[] }
  | { action: "create"; artistId: number; title: string; year: number | null; albumType: string; reasons: string[] };

/** Proporción del tracklist del video que casa con pistas del disco, y del disco que casa con el video. */
export function tracklistOverlap(entries: WatchVideo["tracklist"], tracks: WatchTrack[]): { matched: number; ofVideo: number; ofAlbum: number } {
  if (entries.length === 0 || tracks.length === 0) return { matched: 0, ofVideo: 0, ofAlbum: 0 };
  const remaining = new Map<string, number>();
  for (const track of tracks) { const key = youtubeLinkKey(track.title); remaining.set(key, (remaining.get(key) ?? 0) + 1); }
  let matched = 0;
  for (const entry of entries) {
    const key = youtubeLinkKey(entry.title);
    const left = remaining.get(key) ?? 0;
    if (left > 0) { matched += 1; remaining.set(key, left - 1); }
  }
  return { matched, ofVideo: matched / entries.length, ofAlbum: matched / tracks.length };
}

const STRONG_OVERLAP = 0.8;
const WEAK_OVERLAP = 0.5;
const MIN_ENTRIES = 3;

export function planUpload(video: WatchVideo, catalog: WatchCatalog): WatchDecision {
  const parsed = parseYouTubeTitle(video.title);
  if (!parsed.isFullAlbum) return { action: "ignore", reason: "no es un Full Album (videoclip, concierto, reseña o pieza editorial)" };
  if (UNAVAILABLE_STATUSES.has(video.publicationStatus)) return { action: "ignore", reason: `video ${video.publicationStatus}` };
  if (!parsed.artist) return { action: "review", reason: "el título no tiene la forma «Artista - Disco»", artistIds: [], albumIds: [] };
  const title = channelAlbumTitle(video.title);
  if (!title) return { action: "review", reason: `«${parsed.title}» no se puede leer como nombre de disco`, artistIds: [], albumIds: [] };

  const artists = catalog.artistsByKey.get(youtubeLinkKey(parsed.artist)) ?? [];
  if (artists.length === 0) return { action: "review", reason: `el artista «${parsed.artist}» no está en el catálogo: hay que darlo de alta antes que el disco`, artistIds: [], albumIds: [] };
  if (artists.length > 1) return { action: "review", reason: `«${parsed.artist}» corresponde a ${artists.length} artistas del catálogo`, artistIds: artists.map((artist) => artist.id), albumIds: [] };
  const artist = artists[0]!;
  const albums = catalog.albumsOf(artist.id);
  const year = parsed.year;
  const yearOk = (album: WatchAlbum): boolean => album.year === null || year === null || album.year === year;
  const link = (album: WatchAlbum, via: string, reasons: string[] = []): WatchDecision => ({
    action: "link", artistId: artist.id, albumId: album.id, via, reasons,
    rename: youtubeLinkKey(album.title) === youtubeLinkKey(title) ? null : title,
    primary: album.primary === null || !album.primary.available,
    fillYear: album.year === null && year !== null ? year : null,
  });
  const pickByYear = (candidates: WatchAlbum[]): WatchAlbum[] => {
    const exactYear = candidates.filter((album) => year !== null && album.year === year);
    return exactYear.length === 1 ? exactYear : candidates;
  };
  const names = (album: WatchAlbum): string[] => [album.title, ...album.aliases];

  // 1. Mismo nombre (o alias) sin tildes ni signos.
  const exactKey = youtubeLinkKey(title);
  const exact = albums.filter((album) => names(album).some((name) => youtubeLinkKey(name) === exactKey));
  if (exact.length > 0) {
    const compatible = pickByYear(exact.filter(yearOk));
    if (compatible.length === 1) return link(compatible[0]!, "nombre exacto");
    if (compatible.length === 0) return { action: "review", reason: `hay un disco «${exact[0]!.title}» del artista pero de otro año (${exact.map((album) => album.year ?? "?").join(", ")} frente a ${year})`, artistIds: [artist.id], albumIds: exact.map((album) => album.id) };
    return { action: "review", reason: `${compatible.length} discos del artista se llaman «${title}»`, artistIds: [artist.id], albumIds: compatible.map((album) => album.id) };
  }

  const overlap = new Map(albums.map((album) => [album.id, tracklistOverlap(video.tracklist, album.tracks)]));
  const strong = (album: WatchAlbum): boolean => {
    const value = overlap.get(album.id)!;
    return video.tracklist.length >= MIN_ENTRIES && value.ofVideo >= STRONG_OVERLAP && value.ofAlbum >= STRONG_OVERLAP;
  };

  // 2. Nombre equivalente: necesita además el mismo año o el tracklist.
  const looseKey = looseAlbumKey(title);
  const loose = albums.filter((album) => names(album).some((name) => looseAlbumKey(name) === looseKey) && yearOk(album));
  const confirmedLoose = loose.filter((album) => (year !== null && album.year === year) || strong(album));
  if (confirmedLoose.length === 1) {
    const album = confirmedLoose[0]!;
    return link(album, "nombre equivalente", [`«${album.title}» y «${title}» son el mismo nombre salvo artículo, volumen o signos`]);
  }
  if (confirmedLoose.length > 1) return { action: "review", reason: `${confirmedLoose.length} discos del artista tienen un nombre equivalente a «${title}»`, artistIds: [artist.id], albumIds: confirmedLoose.map((album) => album.id) };

  // 3. Otro nombre, mismas canciones.
  const byTracks = albums.filter((album) => yearOk(album) && strong(album));
  if (byTracks.length === 1) {
    const album = byTracks[0]!;
    const value = overlap.get(album.id)!;
    return link(album, "tracklist", [`${value.matched} de ${video.tracklist.length} pistas del video coinciden con «${album.title}» (${album.tracks.length} pistas)`]);
  }
  if (byTracks.length > 1) return { action: "review", reason: `el tracklist coincide con ${byTracks.length} discos del artista`, artistIds: [artist.id], albumIds: byTracks.map((album) => album.id) };

  // 4. Pruebas a medias: mejor preguntar que duplicar. Un sencillo comparte
  // canciones con su disco por definición: a él solo lo delata el nombre.
  const single = albumTypeFor(video.title, title) === "single";
  const partial = albums.filter((album) => loose.includes(album)
    || (!single && video.tracklist.length >= MIN_ENTRIES && overlap.get(album.id)!.ofVideo >= WEAK_OVERLAP));
  if (partial.length > 0) {
    return { action: "review", reason: `«${title}» se parece a ${partial.map((album) => `«${album.title}» (${album.year ?? "?"})`).join(", ")} pero sin pruebas suficientes para enlazar`, artistIds: [artist.id], albumIds: partial.map((album) => album.id) };
  }
  if (/^various\b|^varios\b/iu.test(artist.name)) {
    return { action: "review", reason: "recopilación sin disco en el catálogo: sus pistas llevan el artista en el título y se dan de alta a mano", artistIds: [artist.id], albumIds: [] };
  }
  return { action: "create", artistId: artist.id, title, year, albumType: albumTypeFor(video.title, title), reasons: [`«${artist.name}» no tiene un disco «${title}» en el catálogo`] };
}

// ---------------------------------------------------------------------------
// Lectura del catálogo
// ---------------------------------------------------------------------------

/** Artistas por clave de nombre y de alias (la misma que usa el resto del canal). */
async function loadArtistIndex(client: PoolClient): Promise<WatchCatalog["artistsByKey"]> {
  const rows = await client.query<{ id: string; name: string; label: string }>(`
    SELECT a.id::text, a.name, a.name AS label FROM public.artists a
    UNION ALL SELECT x.artist_id::text, a.name, x.alias FROM ingest.artist_aliases x JOIN public.artists a ON a.id = x.artist_id`);
  const index = new Map<string, Array<{ id: number; name: string }>>();
  for (const row of rows.rows) {
    const key = youtubeLinkKey(row.label);
    if (!key) continue;
    const id = Number(row.id);
    const list = index.get(key) ?? [];
    if (!list.some((artist) => artist.id === id)) list.push({ id, name: row.name });
    index.set(key, list);
  }
  return index;
}

async function loadArtistAlbums(client: PoolClient, artistId: number): Promise<WatchAlbum[]> {
  const albums = await client.query<{ id: string; title: string; release_year: number | null; cover_url: string | null }>(
    "SELECT id::text, title, release_year, cover_url FROM public.albums WHERE artist_id=$1 ORDER BY id", [artistId]);
  if (albums.rows.length === 0) return [];
  const ids = albums.rows.map((row) => Number(row.id));
  const aliases = await client.query<{ album_id: string; alias: string }>(
    "SELECT album_id::text, alias FROM ingest.album_aliases WHERE album_id = ANY($1::bigint[])", [ids]);
  const tracks = await client.query<{ id: string; album_id: string; disc_number: number; track_number: number; title: string; youtube_start_seconds: number | null; duration_seconds: number | null }>(`
    SELECT id::text, album_id::text, disc_number, track_number, title, youtube_start_seconds, duration_seconds
      FROM public.tracks WHERE album_id = ANY($1::bigint[]) ORDER BY album_id, disc_number, track_number`, [ids]);
  const primary = await client.query<{ album_id: string; video_id: string; publication_status: string }>(`
    SELECT va.album_id::text, v.video_id, v.publication_status::text
      FROM media.video_albums va JOIN media.youtube_videos v ON v.id = va.video_id
     WHERE va.is_primary_link AND va.album_id = ANY($1::bigint[])`, [ids]);
  return albums.rows.map((row) => {
    const id = Number(row.id);
    const main = primary.rows.find((item) => Number(item.album_id) === id);
    return {
      id, artistId, title: row.title, year: row.release_year, coverUrl: row.cover_url,
      aliases: aliases.rows.filter((item) => Number(item.album_id) === id).map((item) => item.alias),
      tracks: tracks.rows.filter((item) => Number(item.album_id) === id).map((item) => ({
        id: Number(item.id), discNumber: item.disc_number, trackNumber: item.track_number, title: item.title,
        youtubeStartSeconds: item.youtube_start_seconds, durationSeconds: item.duration_seconds,
      })),
      primary: main ? { videoId: main.video_id, available: !UNAVAILABLE_STATUSES.has(main.publication_status) } : null,
    };
  });
}

/** Catálogo para decidir un video: todos los artistas, y los discos del artista que nombra el título. */
async function catalogFor(client: PoolClient, video: WatchVideo): Promise<WatchCatalog> {
  const artistsByKey = await loadArtistIndex(client);
  const artist = parseYouTubeTitle(video.title).artist;
  const candidates = artist ? artistsByKey.get(youtubeLinkKey(artist)) ?? [] : [];
  const albums = new Map<number, WatchAlbum[]>();
  if (candidates.length === 1) albums.set(candidates[0]!.id, await loadArtistAlbums(client, candidates[0]!.id));
  return { artistsByKey, albumsOf: (artistId) => albums.get(artistId) ?? [] };
}

async function readVideo(client: PoolClient, videoId: string): Promise<{ dbId: number; video: WatchVideo; thumbnailUrl: string | null } | null> {
  const row = (await client.query<{ id: string; title: string | null; duration_seconds: number | null; publication_status: string; thumbnail_url: string | null }>(
    "SELECT id::text, title, duration_seconds, publication_status::text, thumbnail_url FROM media.youtube_videos WHERE video_id=$1", [videoId])).rows[0];
  if (!row || row.title === null) return null;
  const entries = await client.query<{ position: number; title: string; start_seconds: number }>(
    "SELECT position, title, start_seconds FROM media.youtube_tracklist_entries WHERE video_id=$1 ORDER BY position", [row.id]);
  return {
    dbId: Number(row.id), thumbnailUrl: row.thumbnail_url,
    video: {
      videoId, title: row.title, durationSeconds: row.duration_seconds, publicationStatus: row.publication_status,
      tracklist: entries.rows.map((entry) => ({ position: entry.position, title: entry.title, startSeconds: entry.start_seconds })),
    },
  };
}

// ---------------------------------------------------------------------------
// Aplicación
// ---------------------------------------------------------------------------

async function apiSourceId(client: PoolClient): Promise<number> {
  const row = (await client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='youtube-data-api'")).rows[0];
  if (!row) throw new Error("falta la fuente youtube-data-api: ejecute crv youtube sync");
  return Number(row.id);
}

/** Deja `videoDbId` como video principal del disco (y el resto como secundarios). */
async function setPrimaryLink(context: OperatorContext, albumId: number, videoDbId: number, primary: boolean): Promise<void> {
  const sourceId = await apiSourceId(context.client);
  if (primary) await context.client.query("UPDATE media.video_albums SET is_primary_link=false WHERE album_id=$1 AND is_primary_link AND video_id<>$2", [albumId, videoDbId]);
  await context.client.query(`
    INSERT INTO media.video_albums(video_id, album_id, album_kind, is_primary_link, confidence, source_id)
    VALUES($1, $2, 'full_album', $3, 'high', $4)
    ON CONFLICT(video_id, album_id) DO UPDATE SET album_kind='full_album', is_primary_link=EXCLUDED.is_primary_link, confidence='high', source_id=EXCLUDED.source_id`,
  [videoDbId, albumId, primary, sourceId]);
}

function trackSeconds(entries: WatchVideo["tracklist"], index: number, videoSeconds: number | null): number | null {
  const start = entries[index]!.startSeconds;
  const next = entries[index + 1]?.startSeconds ?? videoSeconds;
  return next !== null && next !== undefined && next > start ? next - start : null;
}

export interface TrackSync { created: number; startsSet: number; durationsSet: number; unmatched: string[] }

/**
 * Las pistas del disco según el video principal. Disco sin pistas: se crean
 * desde el tracklist. Disco con pistas: cada entrada que casa fija su inicio
 * (el video es ahora el principal, así que su reloj manda) y su duración si
 * faltaba. Lo que no casa se informa; no se inventa ninguna pista.
 */
async function syncTracks(context: OperatorContext, albumId: number, video: WatchVideo): Promise<TrackSync> {
  const result: TrackSync = { created: 0, startsSet: 0, durationsSet: 0, unmatched: [] };
  if (video.tracklist.length === 0) return result;
  const rows = await context.client.query<{ id: string; disc_number: number; track_number: number; title: string; youtube_start_seconds: number | null; duration_seconds: number | null }>(
    "SELECT id::text, disc_number, track_number, title, youtube_start_seconds, duration_seconds FROM public.tracks WHERE album_id=$1 ORDER BY disc_number, track_number", [albumId]);
  if (rows.rows.length === 0) {
    for (const [index, entry] of video.tracklist.entries()) {
      const seconds = trackSeconds(video.tracklist, index, video.durationSeconds);
      await createEntity(context, "track", {
        title: entry.title, track_number: index + 1, disc_number: 1, youtube_start_seconds: entry.startSeconds,
        ...(seconds === null ? {} : { duration_seconds: seconds }),
      }, { albumId, allowSimilar: true });
      result.created += 1;
    }
    return result;
  }
  const tracks: SnapshotTrack[] = rows.rows.map((row) => ({ id: Number(row.id), albumId, discNumber: row.disc_number, trackNumber: row.track_number, title: row.title, youtubeStartSeconds: row.youtube_start_seconds }));
  const durationOf = new Map(rows.rows.map((row) => [Number(row.id), row.duration_seconds]));
  const match = matchTracklist(video.tracklist, tracks, video.durationSeconds, false);
  result.unmatched = match.unmatched;
  const done = new Set<number>();
  for (const occurrence of match.occurrences) {
    // Una pista repetida en el video (reprise) conserva su primer inicio.
    if (done.has(occurrence.trackId)) continue;
    done.add(occurrence.trackId);
    const track = tracks.find((item) => item.id === occurrence.trackId)!;
    const values: Record<string, unknown> = {};
    if (track.youtubeStartSeconds !== occurrence.startSeconds) values["youtube_start_seconds"] = occurrence.startSeconds;
    const seconds = occurrence.endSeconds === null ? null : occurrence.endSeconds - occurrence.startSeconds;
    if (durationOf.get(track.id) === null && seconds !== null && seconds > 0) values["duration_seconds"] = seconds;
    if (Object.keys(values).length === 0) continue;
    await updateEntity(context, "track", track.id, values);
    if ("youtube_start_seconds" in values) result.startsSet += 1;
    if ("duration_seconds" in values) result.durationsSet += 1;
  }
  return result;
}

async function reviewExists(client: PoolClient, videoDbId: number): Promise<boolean> {
  const found = await client.query(`
    SELECT 1 FROM ingest.review_queue
     WHERE kind='youtube_match' AND video_id=$1 AND payload->>'via'=$2 AND status IN ('open','in_progress','dismissed') LIMIT 1`,
  [videoDbId, WATCH_OPERATOR]);
  return (found.rowCount ?? 0) > 0;
}

async function openReview(client: PoolClient, videoDbId: number, payload: Record<string, unknown>, note: string): Promise<boolean> {
  const inserted = await client.query(`
    INSERT INTO ingest.review_queue(kind, video_id, priority, payload, notes)
    SELECT 'youtube_match', $1, 3, $2::jsonb, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM ingest.review_queue
        WHERE kind='youtube_match' AND video_id=$1 AND payload->>'via'=$4
          AND status IN ('open','in_progress','dismissed'))`,
  [videoDbId, JSON.stringify({ via: WATCH_OPERATOR, ...payload }), note.slice(0, 2000), WATCH_OPERATOR]);
  return (inserted.rowCount ?? 0) > 0;
}

async function closeReviews(client: PoolClient, videoDbId: number, note: string): Promise<void> {
  await client.query(`
    UPDATE ingest.review_queue SET status='approved', resolved_by='system', resolution_note=$2, resolved_at=now(), updated_at=now()
     WHERE kind='youtube_match' AND video_id=$1 AND payload->>'via'=$3 AND status IN ('open','in_progress')`,
  [videoDbId, note, WATCH_OPERATOR]);
}

export interface WatchOutcome {
  videoId: string; title: string; decision: WatchDecision; runId?: number;
  albumId?: number; renamedFrom?: string; tracks?: TrackSync; cover?: string; reviewOpened?: boolean; error?: string;
}

async function applyDecision(context: OperatorContext, dbId: number, video: WatchVideo, thumbnailUrl: string | null, decision: WatchDecision): Promise<Omit<WatchOutcome, "videoId" | "title" | "decision">> {
  const url = canonicalVideoUrl(video.videoId);
  if (decision.action === "ignore") return {};
  if (decision.action === "review") {
    const reviewOpened = await openReview(context.client, dbId, {
      videoId: video.videoId, title: video.title, reason: decision.reason, artistIds: decision.artistIds, albumIds: decision.albumIds,
    }, `Video nuevo del canal sin enlace automático: ${decision.reason}`);
    return { reviewOpened };
  }
  if (decision.action === "create") {
    const created = await createEntity(context, "album", {
      title: decision.title, album_type: decision.albumType, youtube_url: url, youtube_status: video.publicationStatus,
      ...(decision.year === null ? {} : { release_year: decision.year }),
    }, { artistId: decision.artistId });
    await setPrimaryLink(context, created.id, dbId, true);
    const tracks = await syncTracks(context, created.id, video);
    let cover: string | undefined;
    if (thumbnailUrl) {
      // La miniatura del canal es 16:9: entra como candidata, no como portada.
      cover = await proposeImageCandidate(context.client, {
        kind: "album", targetId: created.id, currentUrl: null, candidateUrl: thumbnailUrl, source: "Canal de YouTube",
        pageUrl: url, origin: WATCH_OPERATOR, runId: context.runId,
      });
    }
    await closeReviews(context.client, dbId, `disco creado (${created.id}) por ${WATCH_OPERATOR}`);
    return { albumId: created.id, tracks, ...(cover ? { cover } : {}) };
  }
  // link
  const before = (await context.client.query<{ title: string }>("SELECT title FROM public.albums WHERE id=$1", [decision.albumId])).rows[0]!;
  await setPrimaryLink(context, decision.albumId, dbId, decision.primary);
  const values: Record<string, unknown> = {};
  if (decision.fillYear !== null) values["release_year"] = decision.fillYear;
  if (decision.primary) { values["youtube_url"] = url; values["youtube_status"] = video.publicationStatus; }
  if (Object.keys(values).length) await updateEntity(context, "album", decision.albumId, values);
  let renamedFrom: string | undefined;
  if (decision.rename && decision.rename !== before.title) {
    await updateEntity(context, "album", decision.albumId, { title: decision.rename });
    renamedFrom = before.title;
    try {
      await createAlias(context, "album", decision.albumId, { alias: before.title, aliasType: "alternate_title", isPrimary: false });
    } catch (error) {
      if (!(error instanceof OperatorError && error.code === "already_exists")) throw error;
    }
  }
  const tracks = decision.primary ? await syncTracks(context, decision.albumId, video) : undefined;
  await closeReviews(context.client, dbId, `enlazado al disco ${decision.albumId} por ${WATCH_OPERATOR}`);
  return { albumId: decision.albumId, ...(renamedFrom ? { renamedFrom } : {}), ...(tracks ? { tracks } : {}) };
}

// ---------------------------------------------------------------------------
// Videos nuevos
// ---------------------------------------------------------------------------

/** Últimos videos del canal: la lista oficial por API (1 unidad) y, si falla, el feed público. */
export async function latestUploadIds(api: YouTubeDataApi): Promise<string[]> {
  try {
    const channel = (await api.getChannel(CRV_CHANNEL_ID)).items?.[0];
    const playlist = (channel?.contentDetails?.["relatedPlaylists"] as Record<string, unknown> | undefined)?.["uploads"];
    if (typeof playlist !== "string") throw new Error("el canal no expuso su lista de publicaciones");
    const page = await api.listPlaylistItems(playlist);
    return (page.items ?? []).flatMap((item) => {
      const id = extractYouTubeVideoId(item.contentDetails?.["videoId"] as string | undefined);
      return id ? [id] : [];
    });
  } catch (error) {
    log.warn({ error: String(error) }, "la API no dio la lista del canal; se usa el feed público");
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CRV_CHANNEL_ID}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`feed de YouTube: ${response.status}`);
    const $ = load(await response.text(), { xml: true });
    return $("entry").toArray().flatMap((entry) => {
      const id = extractYouTubeVideoId($(entry).find("yt\\:videoId").text());
      return id ? [id] : [];
    });
  }
}

export interface WatchResult {
  dryRun: boolean; checked: number; newVideos: number; outcomes: WatchOutcome[];
  credits: { runs: number[]; added: number; retired: number; retyped: number; reviews: string[] } | null;
  reconcileRunId?: number;
}

/**
 * Una pasada: videos del canal que faltan en el espejo + videos Full Album del
 * canal que siguen sin disco (por si el catálogo cambió desde la última vez).
 * `videoIds` fuerza la lista (pruebas, o un video concreto).
 */
export async function watchChannelUploads(options: { dryRun?: boolean; api?: YouTubeDataApi; videoIds?: string[] } = {}): Promise<WatchResult> {
  const dryRun = options.dryRun ?? false;
  const api = options.api ?? new YouTubeDataApi();
  const pool = getPool();
  const latest = options.videoIds ?? await latestUploadIds(api);
  const known = await pool.query<{ video_id: string }>("SELECT video_id FROM media.youtube_videos WHERE video_id = ANY($1::text[]) AND title IS NOT NULL", [latest]);
  const knownIds = new Set(known.rows.map((row) => row.video_id));
  const fresh = latest.filter((id) => !knownIds.has(id));
  const payloads = new Map<string, YouTubeVideoPayload>();
  for (let offset = 0; offset < fresh.length; offset += 50) {
    for (const item of (await api.listVideos(fresh.slice(offset, offset + 50))).items ?? []) {
      if (item.snippet?.["channelId"] === CRV_CHANNEL_ID) payloads.set(item.id, item);
    }
  }
  // Los Full Album del canal ya en el espejo que siguen sin disco.
  const pending = await pool.query<{ video_id: string; title: string }>(`
    SELECT v.video_id, v.title FROM media.youtube_videos v
     WHERE v.channel_id=$1 AND v.title IS NOT NULL AND v.publication_status NOT IN ('unpublished','copyright_blocked')
       AND NOT EXISTS (SELECT 1 FROM media.video_albums va WHERE va.video_id=v.id)
       ${options.videoIds ? "AND v.video_id = ANY($2::text[])" : ""}`,
  options.videoIds ? [CRV_CHANNEL_ID, options.videoIds] : [CRV_CHANNEL_ID]);
  const queue = [...payloads.keys(), ...pending.rows.filter((row) => parseYouTubeTitle(row.title).isFullAlbum && !payloads.has(row.video_id)).map((row) => row.video_id)];

  const outcomes: WatchOutcome[] = [];
  for (const videoId of queue) {
    const payload = payloads.get(videoId);
    let outcome: WatchOutcome = { videoId, title: payload ? String(payload.snippet?.["title"] ?? "") : "", decision: { action: "ignore", reason: "sin datos" } };
    // Un video que ya espera en la cola no abre un run cada hora: se mira
    // primero sin escribir, y solo se aplica si el catálogo ya lo resuelve.
    if (!payload) {
      const client = await pool.connect();
      try {
        const read = await readVideo(client, videoId);
        if (read) {
          const decision = planUpload(read.video, await catalogFor(client, read.video));
          if (decision.action === "review" && await reviewExists(client, read.dbId)) continue;
        }
      } finally { client.release(); }
    }
    try {
      const { runId, result } = await withOperatorRun(
        { name: "youtube-video-nuevo", operator: WATCH_OPERATOR, note: WATCH_NOTE, params: { videoId } },
        async (context) => {
          if (payload) await persistVideoPayload(context.client, payload);
          const read = await readVideo(context.client, videoId);
          if (!read) return { ...outcome, decision: { action: "ignore", reason: "el video no tiene metadatos" } as WatchDecision };
          const catalog = await catalogFor(context.client, read.video);
          const decision = planUpload(read.video, catalog);
          const applied = await applyDecision(context, read.dbId, read.video, read.thumbnailUrl, decision);
          return { videoId, title: read.video.title, decision, ...applied };
        },
        { rollbackOnly: dryRun },
      );
      outcome = { ...result, ...(result.decision.action === "ignore" || dryRun ? {} : { runId }) };
    } catch (error) {
      outcome = { ...outcome, error: error instanceof Error ? error.message : String(error) };
      log.error({ videoId, error: outcome.error }, "video del canal no aplicado");
    }
    outcomes.push(outcome);
  }

  // Créditos de los bloques del canal y relaciones video↔pista, con las mismas
  // reglas que el resto del canal. Solo cuando algo se escribió.
  const touched = new Set(outcomes.flatMap((item) => !dryRun && !item.error && item.albumId !== undefined ? [item.albumId] : []));
  let credits: WatchResult["credits"] = null;
  let reconcileRunId: number | undefined;
  if (touched.size > 0) {
    credits = { runs: [], added: 0, retired: 0, retyped: 0, reviews: [] };
    const client = await pool.connect();
    let musicians, others;
    try {
      musicians = await readMusicianSectionInputs(client);
      others = await readOtherCreditInputs(client);
    } finally { client.release(); }
    const musicianPlan = planMusicianSections(musicians.albums.filter((album) => touched.has(album.albumId)), musicians.people);
    const musicianApplied = await applyMusicianPlan(musicianPlan, { note: WATCH_NOTE, operator: WATCH_OPERATOR });
    // El segundo plan se lee después de aplicar el primero: ve a los músicos ya puestos.
    const again = await pool.connect();
    try { others = await readOtherCreditInputs(again); } finally { again.release(); }
    const otherPlan = planOtherCredits(others.albums.filter((album) => touched.has(album.albumId)), others.catalog);
    const otherApplied = await applyOtherPlan(otherPlan, { note: WATCH_NOTE, operator: WATCH_OPERATOR });
    credits.runs.push(...musicianApplied.runs, ...otherApplied.runs);
    credits.added = musicianApplied.added + otherApplied.added;
    credits.retired = musicianApplied.retired + otherApplied.retired;
    credits.retyped = musicianApplied.retyped;
    credits.reviews = [...musicianPlan, ...otherPlan].flatMap((change) => change.action === "review" ? [`disco ${change.albumId}: ${change.name} — ${change.reason}`] : []);
    for (const skip of [...musicianApplied.skipped, ...otherApplied.skipped]) credits.reviews.push(`disco ${skip.change.albumId}: omitido — ${skip.error}`);
    const reconciled = await reconcileYouTubeChannel({ reportDir: LOG_DIR });
    reconcileRunId = reconciled.runId;
  }

  const result: WatchResult = { dryRun, checked: latest.length, newVideos: fresh.length, outcomes, credits, ...(reconcileRunId === undefined ? {} : { reconcileRunId }) };
  if (!dryRun && (outcomes.length > 0 || fresh.length > 0)) await writeLog("videos-nuevos.jsonl", result);
  return result;
}

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

export interface AvailabilityChange { videoId: string; from: string; to: string }
export interface AvailabilityResult {
  dryRun: boolean; checked: number; batchesFailed: number; changes: AvailabilityChange[];
  albums: Array<{ albumId: number; title: string; action: "status" | "promoted"; status?: string; videoId?: string }>;
  runId?: number;
}

/**
 * Pregunta por todos los videos que el catálogo usa (los del canal, los
 * enlazados a un disco y los de `albums.youtube_url` / enlaces por disco). Un
 * lote que falla no marca nada: solo cuenta como borrado lo que la API, al
 * responder, ya no devuelve.
 */
export async function checkChannelAvailability(options: { dryRun?: boolean; api?: YouTubeDataApi } = {}): Promise<AvailabilityResult> {
  const dryRun = options.dryRun ?? false;
  const api = options.api ?? new YouTubeDataApi();
  const pool = getPool();
  const rows = await pool.query<{ video_id: string; status: string | null }>(`
    WITH ids AS (
      SELECT v.video_id FROM media.youtube_videos v
       WHERE v.channel_id=$1 OR EXISTS (SELECT 1 FROM media.video_albums va WHERE va.video_id=v.id)
      UNION SELECT substring(youtube_url FROM '(?:v=|youtu\\.be/)([A-Za-z0-9_-]{11})') FROM public.albums WHERE youtube_url IS NOT NULL
      UNION SELECT substring(url FROM '(?:v=|youtu\\.be/)([A-Za-z0-9_-]{11})') FROM public.album_disc_links WHERE platform='youtube'
    )
    SELECT ids.video_id, v.publication_status::text AS status
      FROM ids LEFT JOIN media.youtube_videos v ON v.video_id = ids.video_id
     WHERE ids.video_id IS NOT NULL`, [CRV_CHANNEL_ID]);
  const current = new Map(rows.rows.map((row) => [row.video_id, row.status]));
  const ids = [...current.keys()];
  const seen = new Map<string, string>();
  const answered = new Set<string>();
  let batchesFailed = 0;
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    try {
      const response = await api.listVideos(batch);
      for (const item of response.items ?? []) seen.set(item.id, youtubePublicationStatus(item.status));
      for (const id of batch) answered.add(id);
    } catch (error) {
      batchesFailed += 1;
      log.warn({ error: String(error), offset }, "lote de disponibilidad sin respuesta: no se marca nada");
    }
  }
  const changes: AvailabilityChange[] = [];
  for (const id of answered) {
    const to = seen.get(id) ?? "unpublished";
    const from = current.get(id) ?? "(sin espejo)";
    if (from !== to) changes.push({ videoId: id, from, to });
  }

  const albumsChanged: AvailabilityResult["albums"] = [];
  const { runId } = await withOperatorRun(
    { name: "youtube-disponibilidad", operator: WATCH_OPERATOR, note: AVAILABILITY_NOTE, params: { checked: ids.length, changes: changes.length } },
    async (context) => {
      for (const change of changes) {
        await context.client.query(`
          INSERT INTO media.youtube_videos(video_id, url, publication_status, last_fetched_at, updated_at)
          VALUES($1, $2, $3, now(), now())
          ON CONFLICT(video_id) DO UPDATE SET publication_status=EXCLUDED.publication_status, last_fetched_at=now(), updated_at=now()`,
        [change.videoId, canonicalVideoUrl(change.videoId), change.to]);
      }
      // Cada disco con video principal: si ese video cayó y hay otro vivo, el
      // otro pasa a principal; si no, el disco solo cambia de estado.
      const primaries = await context.client.query<{ album_id: string; title: string; video_db_id: string; video_id: string; status: string; youtube_url: string | null; youtube_status: string }>(`
        SELECT al.id::text AS album_id, al.title, v.id::text AS video_db_id, v.video_id, v.publication_status::text AS status,
               al.youtube_url, al.youtube_status::text
          FROM media.video_albums va JOIN media.youtube_videos v ON v.id=va.video_id JOIN public.albums al ON al.id=va.album_id
         WHERE va.is_primary_link ORDER BY al.id`);
      for (const row of primaries.rows) {
        const albumId = Number(row.album_id);
        if (UNAVAILABLE_STATUSES.has(row.status)) {
          const alternative = (await context.client.query<{ video_db_id: string; video_id: string; status: string }>(`
            SELECT v.id::text AS video_db_id, v.video_id, v.publication_status::text AS status
              FROM media.video_albums va JOIN media.youtube_videos v ON v.id=va.video_id
             WHERE va.album_id=$1 AND NOT va.is_primary_link AND va.album_kind='full_album'
               AND v.publication_status IN ('published','unlisted')
             ORDER BY v.published_at DESC NULLS LAST LIMIT 1`, [albumId])).rows[0];
          if (alternative) {
            await setPrimaryLink(context, albumId, Number(alternative.video_db_id), true);
            await updateEntity(context, "album", albumId, { youtube_url: canonicalVideoUrl(alternative.video_id), youtube_status: alternative.status });
            const read = await readVideo(context.client, alternative.video_id);
            if (read) await syncTracks(context, albumId, read.video);
            albumsChanged.push({ albumId, title: row.title, action: "promoted", videoId: alternative.video_id });
            continue;
          }
        }
        const wantedUrl = canonicalVideoUrl(row.video_id);
        const values: Record<string, unknown> = {};
        if (row.youtube_status !== row.status) values["youtube_status"] = row.status;
        if (row.youtube_url !== wantedUrl && extractYouTubeVideoId(row.youtube_url) !== row.video_id) values["youtube_url"] = wantedUrl;
        if (Object.keys(values).length === 0) continue;
        await updateEntity(context, "album", albumId, values);
        albumsChanged.push({ albumId, title: row.title, action: "status", status: row.status });
      }
      return null;
    },
    { rollbackOnly: dryRun },
  );
  const result: AvailabilityResult = { dryRun, checked: ids.length, batchesFailed, changes, albums: albumsChanged, ...(dryRun ? {} : { runId }) };
  if (!dryRun && (changes.length > 0 || albumsChanged.length > 0 || batchesFailed > 0)) await writeLog("disponibilidad.jsonl", result);
  return result;
}

async function writeLog(file: string, entry: unknown): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(path.join(LOG_DIR, file), `${JSON.stringify({ at: new Date().toISOString(), ...entry as object })}\n`);
  } catch (error) {
    log.warn({ error: String(error) }, "no se pudo escribir el historial");
  }
}
