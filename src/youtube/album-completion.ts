// CRV · Tipo y géneros del disco de cada video del canal (Brian, 2026-10-31).
//
// El vigilante enlaza o crea el disco y la IA del alta resuelve el artista,
// pero ninguno completaba el tipo de un disco ya existente ni sus géneros, y la
// radio lo recibía «sin clasificar». Este paso corre después de ambos y antes
// de la radio (ops/youtube-canal/nuevo.sh y el timer horario):
//
//  * TIPO, solo si el disco está en `other`: manda la hoja de seguimiento
//    (seed_uploads.type_raw del video); si no la trae, la etiqueta del título
//    del canal («[EP]», «[Single]»…). Un tipo compuesto o dudoso no se toca.
//  * GÉNEROS, solo si el disco no tiene principal confirmado (AGENTS.md
//    «Géneros de un disco sin fuente»):
//      1. reglas sobre las fuentes ya capturadas (claims del catálogo);
//      2. la IA del catálogo con evidencia citada (solo se aceptan sus
//         `assign_genre` sobre este disco);
//      3. herencia: un artista → sus géneros; varios → el promedio.
//    La herencia se registra con `confirmGenre`, como las demás aceptaciones
//    automáticas, con actor `yt:genres` y el motivo «[herencia:artist]» o
//    «[herencia:artists]»; la radio lo lee de ahí (genreOrigin).
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { moduleLogger } from "../logger/index.js";
import { updateEntity, withOperatorRun } from "../merge/operator.js";
import { GenreCurationError } from "../genres/errors.js";
import { confirmGenre } from "../genres/human.js";
import { syncEntityGenres } from "../genres/store.js";
import { decidePlan, getPlan, startPlan, type PlanWork } from "../curation/ai/store.js";
import type { CatalogPlan } from "../curation/ai/types.js";
import { CRV_CHANNEL_ID } from "./home-channel.js";
import { parseYouTubeTitle } from "./parsers.js";
import { classifyContentType, sheetClassifications } from "./normalization.js";

const log = moduleLogger("youtube:complete");

export const COMPLETE_OPERATOR = "yt:genres";
export const INHERIT_ARTIST = "[herencia:artist]";
export const INHERIT_ARTISTS = "[herencia:artists]";
const VARIOUS = new Set(["various artists", "varios artistas"]);
const PLAN_WAIT_MS = 3 * 60 * 1000;
/** Un disco cuyo género no se pudo resolver no se reintenta (fuentes + IA) antes de esto, salvo video nuevo. */
const GENRE_RETRY_DAYS = 7;
const MAX_SECONDARY = 3;

// ---------------------------------------------------------------------------
// Tipo (puro)
// ---------------------------------------------------------------------------

/** Tipo de publicación único que dicen la hoja o el título; null si no hay o es dudoso. */
export function releaseTypeFrom(sheetType: string | null, videoTitle: string | null): { type: string; via: "hoja" | "título del canal" } | null {
  const fromSheet = new Set(sheetClassifications(sheetType).flatMap((part) => {
    const found = classifyContentType(part);
    return found.kind === "release" && found.normalizedType && found.normalizedType !== "other" ? [found.normalizedType] : [];
  }));
  if (fromSheet.size === 1) return { type: [...fromSheet][0]!, via: "hoja" };
  if (fromSheet.size > 1) return null;
  const tag = videoTitle ? parseYouTubeTitle(videoTitle).format : null;
  if (!tag) return null;
  const found = classifyContentType(tag);
  return found.kind === "release" && found.normalizedType && found.normalizedType !== "other"
    ? { type: found.normalizedType, via: "título del canal" } : null;
}

// ---------------------------------------------------------------------------
// Herencia y promedio (puro)
// ---------------------------------------------------------------------------

export interface ArtistGenres {
  artistId: number;
  name: string;
  genres: Array<{ slug: string; role: "primary" | "secondary"; specific: boolean }>;
}
export interface InheritedGenres {
  primary: string;
  secondary: string[];
  basis: "artist" | "artists";
  artists: Array<{ id: number; name: string }>;
  scores: Record<string, number>;
}

/**
 * AGENTS.md «Géneros de un disco sin fuente»: cada artista pesa lo mismo; su
 * principal vale 2 y cada secundario 1, divididos entre la suma de su ficha.
 * El mayor promedio es el principal; hasta 3 más con al menos la mitad son
 * secundarios. Empate: más artistas, luego el más específico, luego el slug.
 */
export function inheritGenres(artists: ArtistGenres[]): InheritedGenres | null {
  const counted = artists.filter((artist) => artist.genres.length);
  if (!counted.length) return null;
  const score = new Map<string, { total: number; artists: number; specific: boolean }>();
  for (const artist of counted) {
    const weight = artist.genres.reduce((sum, genre) => sum + (genre.role === "primary" ? 2 : 1), 0);
    for (const genre of artist.genres) {
      const entry = score.get(genre.slug) ?? { total: 0, artists: 0, specific: genre.specific };
      entry.total += (genre.role === "primary" ? 2 : 1) / weight;
      entry.artists += 1;
      score.set(genre.slug, entry);
    }
  }
  const ranked = [...score.entries()]
    .map(([slug, entry]) => ({ slug, average: entry.total / counted.length, artists: entry.artists, specific: entry.specific }))
    .sort((a, b) => b.average - a.average || b.artists - a.artists || Number(b.specific) - Number(a.specific) || a.slug.localeCompare(b.slug));
  const [first, ...rest] = ranked;
  if (!first) return null;
  return {
    primary: first.slug,
    secondary: rest.filter((genre) => genre.average >= first.average / 2 - 1e-9).slice(0, MAX_SECONDARY).map((genre) => genre.slug),
    basis: counted.length === 1 ? "artist" : "artists",
    artists: counted.map((artist) => ({ id: artist.artistId, name: artist.name })),
    scores: Object.fromEntries(ranked.map((genre) => [genre.slug, Math.round(genre.average * 1000) / 1000])),
  };
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

interface Target { albumId: number; title: string; albumType: string; artistId: number; artistName: string; videoId: string; videoTitle: string | null; sheetType: string | null; hasPrimary: boolean }

async function targets(videoIds: string[] | undefined): Promise<Array<Target & { recentlyTried: boolean }>> {
  const { rows } = await getPool().query<{ album_id: string; title: string; album_type: string; artist_id: string; artist_name: string; video_id: string; video_title: string | null; sheet_type: string | null; has_primary: boolean; recently_tried: boolean }>(`
    SELECT DISTINCT ON (al.id) al.id::text AS album_id, al.title, al.album_type::text, al.artist_id::text, ar.name AS artist_name,
           v.video_id, v.title AS video_title,
           (SELECT s.type_raw FROM ingest.seed_uploads s WHERE s.video_id = v.video_id ORDER BY s.id LIMIT 1) AS sheet_type,
           EXISTS (SELECT 1 FROM ingest.album_genres g WHERE g.album_id = al.id AND g.status = 'confirmed' AND g.role = 'primary') AS has_primary,
           EXISTS (SELECT 1 FROM ingest.scrape_runs r WHERE r.params->>'operator' = $3 AND r.params->>'albumId' = al.id::text
                      AND r.params->>'action' = 'disco-del-canal-generos-fuentes' AND r.started_at > now() - make_interval(days => $4)) AS recently_tried
      FROM media.video_albums va
      JOIN media.youtube_videos v ON v.id = va.video_id
      JOIN public.albums al ON al.id = va.album_id
      JOIN public.artists ar ON ar.id = al.artist_id
     WHERE va.is_primary_link AND v.channel_id = $1
       AND v.publication_status NOT IN ('unpublished', 'copyright_blocked')
       AND ($2::text[] IS NULL OR v.video_id = ANY($2::text[]))
       AND (al.album_type = 'other' OR NOT EXISTS (
             SELECT 1 FROM ingest.album_genres g WHERE g.album_id = al.id AND g.status = 'confirmed' AND g.role = 'primary'))
     ORDER BY al.id, v.published_at DESC NULLS LAST`, [CRV_CHANNEL_ID, videoIds ?? null, COMPLETE_OPERATOR, GENRE_RETRY_DAYS]);
  return rows.map((row) => ({
    albumId: Number(row.album_id), title: row.title, albumType: row.album_type, artistId: Number(row.artist_id),
    artistName: row.artist_name, videoId: row.video_id, videoTitle: row.video_title, sheetType: row.sheet_type, hasPrimary: row.has_primary,
    recentlyTried: row.recently_tried,
  }));
}

/** Artistas del disco: el titular (salvo Various Artists) y los intérpretes acreditados en sus pistas. */
export async function albumArtistGenres(albumId: number): Promise<ArtistGenres[]> {
  const { rows } = await getPool().query<{ artist_id: string; name: string; slug: string | null; role: "primary" | "secondary" | null; specific: boolean | null }>(`
    WITH artists AS (
      SELECT al.artist_id FROM public.albums al JOIN public.artists ar ON ar.id = al.artist_id
       WHERE al.id = $1 AND lower(ar.name) <> ALL($2::text[])
      UNION
      SELECT tc.artist_id FROM public.track_credits tc JOIN public.tracks t ON t.id = tc.track_id
       WHERE t.album_id = $1 AND tc.artist_id IS NOT NULL AND tc.credit_type = 'musician'
         AND (tc.role ILIKE 'int_rprete%' OR tc.role ILIKE 'performer%' OR tc.role ILIKE 'artist%')
    )
    SELECT ar.id::text AS artist_id, ar.name, g.slug, x.role, (g.family_id IS NOT NULL) AS specific
      FROM artists a JOIN public.artists ar ON ar.id = a.artist_id
      LEFT JOIN ingest.artist_genres x ON x.artist_id = ar.id AND x.status = 'confirmed'
      LEFT JOIN ingest.genre_lineage g ON g.id = x.genre_id
     WHERE lower(ar.name) <> ALL($2::text[])
     ORDER BY ar.id, (x.role = 'primary') DESC, g.slug`, [albumId, [...VARIOUS]]);
  const byArtist = new Map<number, ArtistGenres>();
  for (const row of rows) {
    const id = Number(row.artist_id);
    const entry = byArtist.get(id) ?? { artistId: id, name: row.name, genres: [] };
    if (row.slug && row.role) entry.genres.push({ slug: row.slug, role: row.role, specific: Boolean(row.specific) });
    byArtist.set(id, entry);
  }
  return [...byArtist.values()].filter((artist) => artist.genres.length);
}

async function hasPrimary(albumId: number): Promise<boolean> {
  const { rowCount } = await getPool().query(
    "SELECT 1 FROM ingest.album_genres WHERE album_id=$1 AND status='confirmed' AND role='primary'", [albumId]);
  return Boolean(rowCount);
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

async function waitPlan(plan: CatalogPlan): Promise<CatalogPlan> {
  const until = Date.now() + PLAN_WAIT_MS;
  while ((plan.status === "queued" || plan.status === "running") && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    plan = await getPlan(plan.id);
  }
  return plan;
}

/** La IA del catálogo: solo se aceptan sus géneros para este disco, con evidencia. */
async function genresFromAi(target: Target, work?: PlanWork): Promise<{ planId: number | null; accepted: string[]; reason: string | null }> {
  if (!work && !getEnv().DEEPSEEK_API_KEY) return { planId: null, accepted: [], reason: "sin DEEPSEEK_API_KEY" };
  const instruction = [
    `Disco «${target.title}» de ${target.artistName}${target.videoTitle ? ` (video del canal ${target.videoId}: «${target.videoTitle}»)` : ""}.`,
    "Investiga en fuentes documentadas los géneros de ESTE disco y propón el principal y los secundarios respaldados, citando la evidencia.",
    "No heredes los géneros del artista ni de otros discos: si no hay fuente para este disco, déjalo en unresolved (la herencia la aplica otra regla).",
    "No cambies título, tipo ni pistas; no propongas fusiones, retiradas ni renombres.",
  ].join("\n");
  let plan = await waitPlan(await startPlan("album", target.albumId, instruction, COMPLETE_OPERATOR, ...(work ? [work] : [])));
  if (plan.status !== "ready") return { planId: plan.id, accepted: [], reason: `propuesta ${plan.status}` };
  const accepted: string[] = [];
  const ops = [...(plan.draft?.operations ?? [])]
    .filter((op) => op.op === "assign_genre" && op.target.kind === "album" && "id" in op.target && op.target.id === target.albumId)
    .sort((a, b) => Number(b.op === "assign_genre" && b.role === "primary") - Number(a.op === "assign_genre" && a.role === "primary"));
  for (const op of ops) {
    if (op.op !== "assign_genre" || plan.decisions?.[op.key]) continue;
    plan = await decidePlan(plan.id, plan.revision, op.key, "accepted", COMPLETE_OPERATOR);
    accepted.push(`${op.genreSlug} (${op.role})`);
  }
  return { planId: plan.id, accepted, reason: accepted.length ? null : "la IA no encontró fuente para el disco" };
}

export interface CompletionOutcome {
  albumId: number; title: string; videoId: string;
  type: { from: string; to: string; via: string } | { skipped: string } | null;
  genres: { basis: "fuentes" | "ia" | "artist" | "artists"; detail: string } | { skipped: string } | null;
  runIds: number[];
  error?: string;
}

export async function completeChannelAlbums(options: {
  videoIds?: string[]; limit?: number; dryRun?: boolean; ai?: boolean; aiWork?: PlanWork;
} = {}): Promise<CompletionOutcome[]> {
  // Solo cuenta para el cupo lo que tiene algo que hacer: un tipo que la hoja o el
  // título resuelven, o un género pendiente fuera de su espera (B-Sides y tipos
  // dudosos siguen en `other` a propósito y no ocupan la pasada).
  const explicit = Boolean(options.videoIds?.length);
  const list = (await targets(options.videoIds))
    .map((target) => ({ target, type: target.albumType === "other" ? releaseTypeFrom(target.sheetType, target.videoTitle) : null,
      genres: !target.hasPrimary && (explicit || !target.recentlyTried) }))
    .filter((item) => explicit || item.type || item.genres)
    .slice(0, options.limit ?? getEnv().CRV_YT_COMPLETE_MAX);
  const outcomes: CompletionOutcome[] = [];
  for (const { target, type: found, genres: wantsGenres } of list) {
    const outcome: CompletionOutcome = { albumId: target.albumId, title: target.title, videoId: target.videoId, type: null, genres: null, runIds: [] };
    try {
      // 1. Tipo
      if (target.albumType === "other") {
        if (!found) outcome.type = { skipped: "ni la hoja ni el título traen un tipo único" };
        else {
          outcome.type = { from: "other", to: found.type, via: found.via };
          if (!options.dryRun) {
            const { runId } = await withOperatorRun({
              name: "disco-del-canal-tipo", operator: COMPLETE_OPERATOR,
              note: `Tipo del disco según ${found.via} del video ${target.videoId} (Brian, 2026-10-31)`,
              params: { albumId: target.albumId, videoId: target.videoId, type: found.type },
            }, (context) => updateEntity(context, "album", target.albumId, { album_type: found.type }));
            outcome.runIds.push(runId);
          }
        }
      }
      // 2. Géneros
      if (wantsGenres) outcome.genres = await completeGenres(target, options, outcome.runIds);
      else if (!target.hasPrimary) outcome.genres = { skipped: `intentado hace menos de ${GENRE_RETRY_DAYS} días` };
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
      log.warn({ albumId: target.albumId, error: outcome.error }, "No se pudo completar el disco del video.");
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

async function completeGenres(target: Target, options: { dryRun?: boolean; ai?: boolean; aiWork?: PlanWork }, runIds: number[]): Promise<CompletionOutcome["genres"]> {
  // 2.1 Fuentes ya capturadas: las reglas de siempre.
  if (!options.dryRun) {
    const { runId } = await withOperatorRun({
      name: "disco-del-canal-generos-fuentes", operator: COMPLETE_OPERATOR,
      note: "Géneros del disco desde las fuentes capturadas (reglas del catálogo)", params: { albumId: target.albumId },
    }, (context) => syncEntityGenres(context.client, "album", target.albumId, { runId: context.runId }));
    runIds.push(runId);
    if (await hasPrimary(target.albumId)) return { basis: "fuentes", detail: "las fuentes capturadas ya lo decían" };
  }
  // 2.2 IA del catálogo con evidencia.
  if (options.ai !== false && !options.dryRun) {
    const ai = await genresFromAi(target, options.aiWork);
    if (ai.accepted.length && await hasPrimary(target.albumId)) return { basis: "ia", detail: `propuesta ${ai.planId}: ${ai.accepted.join(", ")}` };
    log.info({ albumId: target.albumId, planId: ai.planId, reason: ai.reason }, "La IA no dio el género del disco; se hereda.");
  }
  // 2.3 Herencia del artista o promedio de los artistas.
  const inherited = inheritGenres(await albumArtistGenres(target.albumId));
  if (!inherited) return { skipped: "ningún artista del disco tiene géneros confirmados: queda para revisión" };
  const names = inherited.artists.map((artist) => `${artist.name} (${artist.id})`).join(", ");
  const marker = inherited.basis === "artist" ? INHERIT_ARTIST : INHERIT_ARTISTS;
  const reason = `${marker} Sin fuente ni IA para el disco; ${inherited.basis === "artist" ? "heredado del artista" : `promedio de ${inherited.artists.length} artistas`}: ${names} (AGENTS.md, Brian 2026-10-31)`;
  const detail = `${inherited.primary}${inherited.secondary.length ? ` + ${inherited.secondary.join(", ")}` : ""} ← ${names}`;
  if (options.dryRun) return { basis: inherited.basis, detail };
  const { runId } = await withOperatorRun({
    name: "disco-del-canal-generos-herencia", operator: COMPLETE_OPERATOR, note: reason.slice(0, 1000),
    params: { albumId: target.albumId, ...inherited },
  }, async (context) => {
    await confirmGenre(context.client, { kind: "album", entityId: target.albumId, genreSlug: inherited.primary, role: "primary", actor: COMPLETE_OPERATOR, reason, runId: context.runId });
    for (const slug of inherited.secondary) {
      // Una familia por encima de un género ya confirmado no se añade: sería perder precisión.
      try {
        await confirmGenre(context.client, { kind: "album", entityId: target.albumId, genreSlug: slug, role: "secondary", actor: COMPLETE_OPERATOR, reason, runId: context.runId });
      } catch (error) {
        if (!(error instanceof GenreCurationError && error.code === "conflict")) throw error;
      }
    }
  });
  runIds.push(runId);
  return { basis: inherited.basis, detail };
}
