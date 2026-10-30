// CRV · Alta de los videos del canal con la IA del catálogo (Brian, 2026-10-30).
//
// El vigilante horario (channel-watch) ya enlaza el disco cuando existe y lo
// crea cuando el artista es uno solo. Lo que quedaba a mano era el caso
// difícil: artista nuevo, compilación de varios o título que no casa. Este
// módulo toma esos videos y:
//
//   1. lee el título y la descripción con los parsers del canal (artista,
//      disco, año, pistas, créditos);
//   2. resuelve el artista contra el catálogo (nombre y alias) y, si no está,
//      pide a la IA que decida entre usar un candidato, crear la ficha o
//      dejarlo en revisión (nunca inventa una identidad);
//   3. prepara una propuesta del planificador editorial anclada al artista con
//      la evidencia del propio video, para que cree el disco con sus pistas,
//      créditos y géneros documentados;
//   4. cuando la propuesta se aplica (a mano o con la política de altas
//      seguras), enlaza el video como principal del disco, cierra la revisión
//      de ingesta y deja el estado en `ingest.youtube_intake`.
//
// El estado del video vive en ingest.youtube_intake; las propuestas siguen en
// ingest.ai_curation_plans (ancladas al artista), así que se revisan con la
// misma Mesa de siempre.
import { createHash } from "node:crypto";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { moduleLogger } from "../logger/index.js";
import { createEntity, withOperatorRun, type OperatorContext } from "../merge/operator.js";
import {
  createCurationGateway,
  type PlannedDraft,
} from "../curation/ai/planner.js";
import { planningContext } from "../curation/ai/context.js";
import { planProvidedEvidence } from "../curation/ai/provided-evidence.js";
import { decidePlan, getPlan, startPlan, type PlanWork } from "../curation/ai/store.js";
import type { CatalogEvidence, CatalogOperation, CatalogPlan } from "../curation/ai/types.js";
import { parseCreditSections, parseYouTubeDescription, parseYouTubeTitle } from "./parsers.js";
import { youtubeLinkKey } from "./linker.js";
import { canonicalVideoUrl } from "./normalization.js";
import { CRV_CHANNEL_ID } from "./home-channel.js";

const log = moduleLogger("youtube:intake");

export const INTAKE_OPERATOR = "yt:intake";
export const INTAKE_PREFIX = "yt:intake:v1";
export const ENRICH_PREFIX = "yt:intake:enrich:v1";

export type IntakeStatus = "pending" | "planning" | "ready" | "linked" | "review" | "failed" | "skipped";

export interface IntakeVideoRow {
  id: number;
  videoId: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  publicationStatus: string;
}

export interface IntakeParse {
  artist: string;
  album: string;
  year: number | null;
  format: string | null;
  trackCount: number;
  creditCount: number;
  tracklist: Array<{ title: string; startSeconds: number }>;
  credits: Array<{ role: string; name: string }>;
}

export interface IntakeRunResult {
  videoDbId: number;
  videoId: string;
  status: IntakeStatus;
  artistId: number | null;
  artistCreated: boolean;
  planId: number | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Lectura del video
// ---------------------------------------------------------------------------

export async function loadIntakeVideo(videoDbId: number): Promise<IntakeVideoRow | null> {
  const { rows } = await getPool().query<{
    id: string; video_id: string; title: string; description: string | null;
    duration_seconds: number | null; published_at: string | null;
    thumbnail_url: string | null; publication_status: string;
  }>(`SELECT id::text, video_id, title, description, duration_seconds, published_at::text,
             thumbnail_url, publication_status
        FROM media.youtube_videos WHERE id=$1`, [videoDbId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id), videoId: row.video_id, title: row.title, description: row.description,
    durationSeconds: row.duration_seconds, publishedAt: row.published_at,
    thumbnailUrl: row.thumbnail_url, publicationStatus: row.publication_status,
  };
}

/** Título y descripción del canal → datos del disco. `null` si no hay artista legible. */
export function parseIntake(video: Pick<IntakeVideoRow, "title" | "description">): IntakeParse | null {
  const title = parseYouTubeTitle(video.title);
  if (!title.artist) return null;
  // Solo publicaciones musicales: el vigilante ya manda videoclips, conciertos
  // y piezas editoriales a Audiovisuales; aquí no se inventa un disco por un
  // video suelto.
  if (!title.isFullAlbum) return null;
  const description = parseYouTubeDescription(video.description);
  const credits = parseCreditSections(description.sections)
    .map((credit) => ({ role: credit.role, name: credit.name }));
  return {
    artist: title.artist.trim(),
    album: title.title.trim(),
    year: title.year,
    format: title.format,
    trackCount: description.tracklist.length,
    creditCount: credits.length,
    tracklist: description.tracklist.map((entry) => ({ title: entry.title, startSeconds: entry.startSeconds })),
    credits,
  };
}

function albumTypeOf(format: string | null): string {
  const value = (format ?? "").toLowerCase();
  if (value.includes("ep")) return "ep";
  if (value.includes("single")) return "single";
  return "studio_album";
}

// ---------------------------------------------------------------------------
// Identidad del artista
// ---------------------------------------------------------------------------

type ArtistDirectory = Map<string, Array<{ id: number; name: string }>>;

async function loadArtistDirectory(): Promise<ArtistDirectory> {
  const { rows } = await getPool().query<{ id: string; name: string }>(`
    SELECT id::text, name FROM public.artists
    UNION ALL
    SELECT artist_id::text, alias FROM ingest.artist_aliases WHERE alias IS NOT NULL`);
  const directory: ArtistDirectory = new Map();
  for (const row of rows) {
    const key = youtubeLinkKey(row.name);
    if (!key) continue;
    const list = directory.get(key) ?? [];
    if (!list.some((item) => item.id === Number(row.id))) list.push({ id: Number(row.id), name: row.name });
    directory.set(key, list);
  }
  return directory;
}

function trigrams(value: string): Set<string> {
  const text = ` ${value} `;
  const result = new Set<string>();
  for (let index = 0; index + 3 <= text.length; index += 1) result.add(text.slice(index, index + 3));
  return result;
}

/** Candidatos del catálogo para el nombre leído: exactos primero y luego parecidos. */
export function artistCandidates(name: string, directory: ArtistDirectory, limit = 8): Array<{ id: number; name: string }> {
  const key = youtubeLinkKey(name);
  const exact = directory.get(key) ?? [];
  if (exact.length) return exact.slice(0, limit);
  const wanted = trigrams(key);
  const scored: Array<{ id: number; name: string; score: number }> = [];
  for (const [candidateKey, list] of directory) {
    const got = trigrams(candidateKey);
    const shared = [...wanted].filter((gram) => got.has(gram)).length;
    const score = shared / Math.max(wanted.size, got.size);
    if (score < 0.45) continue;
    for (const item of list) scored.push({ ...item, score });
  }
  const byArtist = new Map<number, { id: number; name: string; score: number }>();
  for (const item of scored) if (!byArtist.has(item.id) || byArtist.get(item.id)!.score < item.score) byArtist.set(item.id, item);
  return [...byArtist.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ id, name: candidateName }) => ({ id, name: candidateName }));
}

const artistDecisionSchema = z.object({
  decision: z.enum(["use", "create", "review"]),
  artistId: z.number().int().positive().nullable(),
  name: z.string().trim().min(1).max(200),
  artistType: z.enum(["band", "solo_artist", "duo", "project", "group", "other"]).nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(3).max(700),
}).strict();

type ArtistDecision = z.output<typeof artistDecisionSchema>;

const ARTIST_INSTRUCTIONS = [
  "Decides si el artista de un video del canal ya existe en el catálogo de rock venezolano CRV.",
  "Te doy el nombre leído del título del canal, el disco y los candidatos del catálogo (id, nombre, similitud).",
  "Responde use solo si un candidato es la misma identidad (misma banda o solista, aunque cambie tilde, artículo o grafía).",
  "Responde create solo si el artista no está entre los candidatos y el video es una publicación musical clara del canal.",
  "Responde review si hay duda de identidad, si el nombre parece un proyecto personal de alguien ya existente o si el video no es un disco.",
  "No inventes ids ni nombres: artistId debe ser uno de los candidatos o null.",
].join("\n");

async function resolveArtist(parsed: IntakeParse, candidates: Array<{ id: number; name: string }>): Promise<ArtistDecision> {
  if (candidates.length === 1) {
    const only = candidates[0]!;
    return { decision: "use", artistId: only.id, name: only.name, artistType: null, confidence: 1,
      reason: `nombre exacto en el catálogo: ${only.name}` };
  }
  const gateway = createCurationGateway();
  const { proposal } = await gateway.propose({
    taskKind: "hard_entity_resolution",
    schemaVersion: "yt-intake-artist-v1",
    input: { artistaLeido: parsed.artist, disco: parsed.album, anio: parsed.year, candidatos: candidates },
    instructions: ARTIST_INSTRUCTIONS,
    responseSchema: artistDecisionSchema,
  });
  if (proposal.decision === "use" && !candidates.some((candidate) => candidate.id === proposal.artistId)) {
    return { ...proposal, decision: "review", artistId: null, reason: `la IA eligió un id que no está entre los candidatos: ${proposal.artistId}` };
  }
  return proposal;
}

// ---------------------------------------------------------------------------
// Evidencia del video para el planificador
// ---------------------------------------------------------------------------

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Evidencia citable del propio video: título, descripción, pistas y créditos. */
export function videoEvidence(video: IntakeVideoRow, parsed: IntakeParse): CatalogEvidence[] {
  const url = canonicalVideoUrl(video.videoId);
  const fetchedAt = new Date().toISOString();
  const build = (id: string, label: string, quote: string): CatalogEvidence => ({
    id, url, quote, fetchedAt, origin: "youtube_canal", label,
    contentHash: createHash("sha256").update(quote).digest("hex"),
    readAt: fetchedAt, acquisitionMethod: "http",
  });
  const description = clip(video.description ?? "", 7000);
  const items: CatalogEvidence[] = [
    build("YT1", `Video del canal: ${video.title}`,
      clip(`Título: ${video.title}\nCanal: Coleccionistas De Rock Venezolano\nPublicado: ${video.publishedAt ?? "sin fecha"}\nDescripción:\n${description}`, 8000)),
  ];
  const tracklist = parsed.tracklist
    .map((entry, index) => `${String(index + 1).padStart(2, "0")}. ${entry.title} ${Math.floor(entry.startSeconds / 60)}:${String(entry.startSeconds % 60).padStart(2, "0")}`)
    .join("\n");
  if (tracklist) items.push(build("YT2", "Lista de pistas del video", clip(tracklist, 6000)));
  const credits = parsed.credits.map((credit) => `${credit.role}: ${credit.name}`).join("\n");
  if (credits) items.push(build("YT3", "Créditos del video", clip(credits, 6000)));
  return items;
}

// ---------------------------------------------------------------------------
// Plan de alta
// ---------------------------------------------------------------------------

export function intakeInstruction(video: IntakeVideoRow, parsed: IntakeParse): string {
  const url = canonicalVideoUrl(video.videoId);
  const tracks = parsed.tracklist
    .map((entry, index) => `${index + 1}. ${entry.title}`)
    .join(" · ");
  return [
    `${INTAKE_PREFIX} · Alta del disco del video ${url}`,
    `El canal publicó «${video.title}» y la ficha del disco no existe en el catálogo.`,
    `Datos leídos del título y la descripción: artista «${parsed.artist}», disco «${parsed.album}», ` +
      `año ${parsed.year ?? "sin dato"}, formato ${parsed.format ?? "sin dato"}, ${parsed.trackCount} pistas y ${parsed.creditCount} créditos.`,
    parsed.trackCount ? `Pistas de la evidencia: ${clip(tracks, 2200)}.` : "La descripción no trae lista de pistas.",
    "Crea el disco con las pistas, duraciones/inicios y créditos de la evidencia del video (YT1, YT2, YT3), su año y tipo. " +
      "Asigna solo los géneros que la evidencia respalde. Añade enlaces oficiales y completa la ficha del artista únicamente con lo documentado. " +
      "No propongas fusiones, retiradas ni renombres de fichas existentes; lo que no esté respaldado va a unresolved.",
  ].join("\n");
}

function videoPlanWork(video: IntakeVideoRow, parsed: IntakeParse): PlanWork {
  return async (_kind, id, instruction, notify): Promise<PlannedDraft> => {
    const inventory = await planningContext(getPool(), "artist", id, instruction);
    const context = inventory.context as Record<string, unknown>;
    const evidence = [...inventory.evidence, ...videoEvidence(video, parsed)];
    return planProvidedEvidence(context, evidence, instruction, createCurationGateway(), notify);
  };
}

// ---------------------------------------------------------------------------
// Estado del video
// ---------------------------------------------------------------------------

async function upsertIntake(video: IntakeVideoRow, parsed: IntakeParse | null): Promise<number> {
  const { rows } = await getPool().query<{ id: string }>(`
    INSERT INTO ingest.youtube_intake(video_id, status, artist_name, album_title, release_year, album_type, track_count, credit_count)
    VALUES($1,'pending',$2,$3,$4,$5,$6,$7)
    ON CONFLICT (video_id) DO UPDATE SET
      artist_name=EXCLUDED.artist_name, album_title=EXCLUDED.album_title, release_year=EXCLUDED.release_year,
      album_type=EXCLUDED.album_type, track_count=EXCLUDED.track_count, credit_count=EXCLUDED.credit_count,
      updated_at=now()
    RETURNING id::text`,
  [video.id, parsed?.artist ?? null, parsed?.album ?? null, parsed?.year ?? null,
    parsed ? albumTypeOf(parsed.format) : null, parsed?.trackCount ?? 0, parsed?.creditCount ?? 0]);
  return Number(rows[0]!.id);
}

async function setIntake(id: number, values: Record<string, unknown>): Promise<void> {
  const fields = Object.keys(values);
  if (!fields.length) return;
  const params = fields.map((field, index) => [field, values[field], index + 2] as const);
  const assignments = params.map(([field, , index]) => `${field}=$${index}`).join(", ");
  await getPool().query(`UPDATE ingest.youtube_intake SET ${assignments}, updated_at=now() WHERE id=$1`,
    [id, ...params.map(([, value]) => value)]);
}

async function videoHasPrimaryLink(videoDbId: number): Promise<boolean> {
  const { rowCount } = await getPool().query(
    "SELECT 1 FROM media.video_albums WHERE video_id=$1 AND is_primary_link LIMIT 1", [videoDbId]);
  return (rowCount ?? 0) > 0;
}

/** Disco del artista cuyo título (o alias) coincide con el leído del video. */
async function findAlbumForArtist(artistId: number, albumTitle: string): Promise<{ id: number; title: string } | null> {
  const { rows } = await getPool().query<{ id: string; title: string }>(`
    SELECT a.id::text, a.title FROM public.albums a WHERE a.artist_id=$1
    UNION ALL
    SELECT a.id::text, aa.alias AS title FROM ingest.album_aliases aa JOIN public.albums a ON a.id=aa.album_id
     WHERE a.artist_id=$1 AND aa.alias IS NOT NULL`, [artistId]);
  const key = youtubeLinkKey(albumTitle);
  if (!key) return null;
  const match = rows.find((row) => youtubeLinkKey(row.title) === key);
  return match ? { id: Number(match.id), title: match.title } : null;
}

/** Enlaza un disco que ya existía y cierra la revisión de ingesta. */
async function linkExistingAlbum(video: IntakeVideoRow, intakeId: number, albumId: number, artistId: number): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const sourceId = (await client.query<{ id: string }>(
      "SELECT id::text FROM ingest.sources WHERE slug='youtube-data-api'")).rows[0]?.id ?? null;
    await client.query(`
      INSERT INTO media.video_albums(video_id, album_id, album_kind, is_primary_link, confidence, source_id)
      VALUES($1,$2,'full_album',true,'high',$3)
      ON CONFLICT(video_id, album_id) DO UPDATE SET album_kind='full_album', is_primary_link=true,
        confidence='high', source_id=EXCLUDED.source_id`,
    [video.id, albumId, sourceId]);
    await client.query(`
      UPDATE public.albums SET youtube_url=coalesce(youtube_url,$2), youtube_status=$3::publication_status, updated_at=now()
       WHERE id=$1`, [albumId, canonicalVideoUrl(video.videoId), video.publicationStatus]);
    await client.query(`
      UPDATE ingest.review_queue SET status='approved', updated_at=now(),
             notes=concat(coalesce(notes,''), ' · disco existente enlazado (', $2::text, ')')
       WHERE kind='youtube_match' AND video_id=$1 AND status IN ('open','in_progress')`,
    [video.id, String(albumId)]);
    await client.query(`
      UPDATE ingest.youtube_intake SET status='linked', artist_id=$2, reason=$3, error=null, updated_at=now() WHERE id=$1`,
    [intakeId, artistId, `disco existente ${albumId} enlazado`]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    await setIntake(intakeId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    return false;
  } finally {
    client.release();
  }
}

async function openReviewFor(video: IntakeVideoRow, reason: string, intakeId: number): Promise<number | null> {
  const { rows } = await getPool().query<{ id: string }>(`
    INSERT INTO ingest.review_queue(kind, video_id, priority, payload, notes)
    SELECT 'youtube_match', $1, 3, $2::jsonb, $3
     WHERE NOT EXISTS (SELECT 1 FROM ingest.review_queue
                        WHERE kind='youtube_match' AND video_id=$1 AND payload->>'via'=$4
                          AND status IN ('open','in_progress'))
    RETURNING id::text`,
  [video.id, JSON.stringify({ via: INTAKE_OPERATOR, videoId: video.videoId, title: video.title, reason, intakeId }),
    `Alta asistida por IA: ${reason}`.slice(0, 2000), INTAKE_OPERATOR]);
  return rows[0] ? Number(rows[0].id) : null;
}

// ---------------------------------------------------------------------------
// Pasada de alta
// ---------------------------------------------------------------------------

/**
 * Prepara el alta de un video: resuelve el artista (creándolo si la IA lo
 * decide con confianza) y lanza la propuesta del planificador. No aplica
 * cambios al catálogo salvo el alta del artista cuando corresponde.
 */
export async function runVideoIntake(videoDbId: number, options: { dryRun?: boolean; operator?: string } = {}): Promise<IntakeRunResult> {
  const operator = options.operator ?? INTAKE_OPERATOR;
  const video = await loadIntakeVideo(videoDbId);
  if (!video) throw new Error(`video ${videoDbId} no existe`);
  if (video.publicationStatus !== "published") {
    return { videoDbId, videoId: video.videoId, status: "skipped", artistId: null, artistCreated: false, planId: null, reason: "el video no está publicado" };
  }
  if (await videoHasPrimaryLink(videoDbId)) {
    return { videoDbId, videoId: video.videoId, status: "linked", artistId: null, artistCreated: false, planId: null, reason: "ya tiene disco principal" };
  }
  const parsed = parseIntake(video);
  if (!parsed) {
    // Videoclip, concierto o pieza editorial: el vigilante ya lo clasifica en
    // Audiovisuales. No se abre una revisión por algo que no es un disco.
    return { videoDbId, videoId: video.videoId, status: "skipped", artistId: null, artistCreated: false, planId: null,
      reason: "no es un disco completo (videoclip, concierto o pieza editorial)" };
  }
  const intakeId = await upsertIntake(video, parsed);
  if (parsed.trackCount === 0) {
    const reason = "la descripción no trae lista de pistas; no se crea un disco a ciegas";
    if (!options.dryRun) await setIntake(intakeId, { status: "review", reason });
    return { videoDbId, videoId: video.videoId, status: "review", artistId: null, artistCreated: false, planId: null, reason };
  }

  const directory = await loadArtistDirectory();
  const candidates = artistCandidates(parsed.artist, directory);
  let decision: ArtistDecision;
  try {
    decision = await resolveArtist(parsed, candidates);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!options.dryRun) await setIntake(intakeId, { status: "failed", error: reason });
    return { videoDbId, videoId: video.videoId, status: "failed", artistId: null, artistCreated: false, planId: null, reason };
  }
  if (decision.decision === "review") {
    const reason = `identidad por confirmar: ${decision.reason}`;
    const reviewId = options.dryRun ? null : await openReviewFor(video, reason, intakeId);
    if (!options.dryRun) await setIntake(intakeId, { status: "review", reason, review_id: reviewId });
    return { videoDbId, videoId: video.videoId, status: "review", artistId: null, artistCreated: false, planId: null, reason };
  }

  let artistId = decision.decision === "use" ? decision.artistId : null;
  let artistCreated = false;
  if (decision.decision === "create") {
    if (options.dryRun) {
      return { videoDbId, videoId: video.videoId, status: "pending", artistId: null, artistCreated: false, planId: null,
        reason: `dry-run: se crearía el artista «${decision.name}»` };
    }
    const { result } = await withOperatorRun(
      { name: "youtube-intake-artista", operator, note: `Alta del artista «${decision.name}» desde el video ${video.videoId}`,
        params: { videoId: video.videoId, title: video.title, decision } },
      async (context) => createEntity(context as OperatorContext, "artist", {
        name: decision.name,
        artist_type: decision.artistType ?? "band",
        origin_country: "Venezuela",
        notes: `Alta asistida desde el video ${canonicalVideoUrl(video.videoId)} (${INTAKE_PREFIX}). Motivo: ${decision.reason}`,
      }),
    );
    artistId = result.id;
    artistCreated = true;
  }
  if (!artistId) {
    const reason = "la IA no eligió un artista y no propuso crearlo";
    if (!options.dryRun) await setIntake(intakeId, { status: "review", reason });
    return { videoDbId, videoId: video.videoId, status: "review", artistId: null, artistCreated, planId: null, reason };
  }

  // El disco puede existir ya (lo creó el vigilante, otra pasada o una persona):
  // entonces no se propone un alta nueva, se enlaza el que hay.
  const existingAlbum = await findAlbumForArtist(artistId, parsed.album);
  if (existingAlbum) {
    if (options.dryRun) {
      return { videoDbId, videoId: video.videoId, status: "linked", artistId, artistCreated, planId: null,
        reason: `dry-run: enlazaría el disco existente ${existingAlbum.id} «${existingAlbum.title}»` };
    }
    const linked = await linkExistingAlbum(video, intakeId, existingAlbum.id, artistId);
    return { videoDbId, videoId: video.videoId, status: linked ? "linked" : "failed", artistId, artistCreated, planId: null,
      reason: linked ? `disco existente ${existingAlbum.id} enlazado` : "no se pudo enlazar el disco existente" };
  }

  const instruction = intakeInstruction(video, parsed);
  if (options.dryRun) {
    return { videoDbId, videoId: video.videoId, status: "pending", artistId, artistCreated, planId: null,
      reason: `dry-run: se prepararía la propuesta del disco «${parsed.album}»` };
  }
  const plan = await startPlan("artist", artistId, instruction, operator, videoPlanWork(video, parsed));
  if (!options.dryRun) {
    await setIntake(intakeId, { status: "planning", artist_id: artistId, plan_id: plan.id, reason: null, error: null, attempts: 0 });
    await getPool().query("UPDATE ingest.youtube_intake SET attempts=attempts+1, updated_at=now() WHERE id=$1", [intakeId]);
  }
  return { videoDbId, videoId: video.videoId, status: "planning", artistId, artistCreated, planId: plan.id, reason: null };
}

// ---------------------------------------------------------------------------
// Aprobación de altas seguras (etapa 2)
// ---------------------------------------------------------------------------

/** Operaciones que no pueden destruir ni renombrar nada existente. */
export function isSafeOperation(operation: CatalogOperation): boolean {
  switch (operation.op) {
    case "create_album":
    case "create_entity":
    case "assign_genre":
    case "add_social_link":
    case "add_alias":
      return true;
    case "create_relation":
      return true;
    case "replace_fields":
      return !["name", "title", "realName"].some((field) => field in operation.values);
    default:
      return false;
  }
}

export interface AutoApproveResult { plans: number; accepted: number; skipped: number; linked: number }

/**
 * Acepta en los planes listos solo las operaciones seguras. Las fusiones,
 * retiradas, renombres y cualquier duda quedan para una persona. Cada
 * aceptación aplica el cambio al momento con el mismo ejecutor de la Mesa.
 */
export async function autoApproveReadyIntakes(options: { operator?: string; dryRun?: boolean } = {}): Promise<AutoApproveResult> {
  const operator = options.operator ?? "yt:intake:auto";
  const summary: AutoApproveResult = { plans: 0, accepted: 0, skipped: 0, linked: 0 };
  if (!getEnv().CRV_YT_INTAKE_AUTO) return summary;
  const { rows } = await getPool().query<{ id: string; revision: number }>(`
    SELECT p.id::text, p.revision
      FROM ingest.ai_curation_plans p
      JOIN ingest.youtube_intake yi ON yi.plan_id = p.id OR yi.enrich_plan_id = p.id
     WHERE p.entity_kind='artist' AND p.status='ready' AND p.draft IS NOT NULL
     ORDER BY p.id`);
  for (const row of rows) {
    summary.plans += 1;
    let plan = await getPlan(Number(row.id));
    for (const operation of plan.draft?.operations ?? []) {
      if (plan.decisions?.[operation.key]) continue;
      if (!isSafeOperation(operation)) { summary.skipped += 1; continue; }
      if (options.dryRun) { summary.accepted += 1; continue; }
      plan = await decidePlan(plan.id, plan.revision, operation.key, "accepted", operator);
      summary.accepted += 1;
    }
    if (!options.dryRun && (plan.status === "applied" || plan.status === "reviewed")) {
      // En este proceso (CLI) no está registrado el enganche de la API: se
      // enlaza aquí mismo para que el video no quede sin disco tras el alta.
      await linkVideoFromPlan(plan);
      summary.linked += 1;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Enlace al aplicar la propuesta
// ---------------------------------------------------------------------------

async function reviewIdForPlan(plan: CatalogPlan): Promise<{ intakeId: number; videoDbId: number } | null> {
  const { rows } = await getPool().query<{ id: string; video_id: string }>(
    "SELECT id::text, video_id::text FROM ingest.youtube_intake WHERE plan_id=$1", [plan.id]);
  const row = rows[0];
  return row ? { intakeId: Number(row.id), videoDbId: Number(row.video_id) } : null;
}

/**
 * Enganche posterior a la aplicación de una propuesta: si el plan nació de un
 * video, enlaza el disco creado como principal, cierra la revisión de ingesta y
 * deja el video en `linked`. No crea nada: solo conecta lo que la IA ya creó.
 */
export async function linkVideoFromPlan(plan: CatalogPlan): Promise<boolean> {
  if (plan.entityKind !== "artist") return false;
  const intake = await reviewIdForPlan(plan);
  if (!intake) return false;
  const created = Object.values(plan.result?.created ?? {});
  let albumId = created.find((item) => item.kind === "album")?.id ?? null;
  if (!albumId) {
    const { rows } = await getPool().query<{ id: string }>(`
      SELECT a.id::text FROM public.albums a
        JOIN ingest.youtube_intake yi ON yi.artist_id = a.artist_id
       WHERE yi.id=$1 AND lower(a.title) = lower(coalesce(yi.album_title,''))
       ORDER BY a.id LIMIT 1`, [intake.intakeId]);
    albumId = rows[0] ? Number(rows[0].id) : null;
  }
  if (!albumId) return false;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const video = (await client.query<{ video_id: string; publication_status: string }>(
      "SELECT video_id, publication_status FROM media.youtube_videos WHERE id=$1", [intake.videoDbId])).rows[0];
    if (!video) { await client.query("ROLLBACK"); return false; }
    const sourceId = (await client.query<{ id: string }>(
      "SELECT id::text FROM ingest.sources WHERE slug='youtube-data-api'")).rows[0]?.id ?? null;
    await client.query(`
      INSERT INTO media.video_albums(video_id, album_id, album_kind, is_primary_link, confidence, source_id)
      VALUES($1,$2,'full_album',true,'high',$3)
      ON CONFLICT(video_id, album_id) DO UPDATE SET album_kind='full_album', is_primary_link=true,
        confidence='high', source_id=EXCLUDED.source_id`,
    [intake.videoDbId, albumId, sourceId]);
    await client.query(`
      UPDATE public.albums SET youtube_url=coalesce(youtube_url,$2), youtube_status=$3::publication_status, updated_at=now()
       WHERE id=$1`, [albumId, canonicalVideoUrl(video.video_id), video.publication_status]);
    await client.query(`
      UPDATE ingest.review_queue SET status='approved', notes=concat(coalesce(notes,''), ' · disco creado por la IA (', $2::text, ')'),
             updated_at=now()
       WHERE kind='youtube_match' AND video_id=$1 AND status IN ('open','in_progress')`,
    [intake.videoDbId, String(albumId)]);
    await client.query(`
      UPDATE ingest.youtube_intake SET status='linked', reason=null, error=null, updated_at=now() WHERE id=$1`,
    [intake.intakeId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    log.warn(`No se pudo enlazar el video del plan ${plan.id}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    client.release();
  }
  await startEnrichment(plan, albumId);
  return true;
}

/**
 * Segunda pasada: con el video ya enlazado, la IA investiga fuentes y prepara
 * la ficha completa del artista (biografía, géneros, enlaces, formación). Se
 * guarda en el estado del video para mostrarla en el espacio de YouTube.
 */
async function startEnrichment(plan: CatalogPlan, albumId: number): Promise<void> {
  if (!getEnv().CRV_YT_INTAKE_ENRICH) return;
  try {
    const { rows } = await getPool().query<{ id: string; enrich_plan_id: string | null; video_id: string }>(`
      SELECT yi.id::text, yi.enrich_plan_id::text, v.video_id
        FROM ingest.youtube_intake yi JOIN media.youtube_videos v ON v.id=yi.video_id
       WHERE yi.plan_id=$1`, [plan.id]);
    const row = rows[0];
    if (!row || row.enrich_plan_id) return;
    const instruction = [
      `${ENRICH_PREFIX} · Completa la ficha del artista tras el alta del disco ${albumId} (video ${canonicalVideoUrl(row.video_id)}).`,
      "El disco ya quedó creado y enlazado con la evidencia del video. Investiga fuentes documentadas y prepara biografía, géneros, enlaces oficiales, formación y demás datos de la ficha.",
      "No propongas fusiones, retiradas ni renombres; lo que no esté respaldado va a unresolved.",
    ].join("\n");
    const enrich = await startPlan("artist", plan.entityId, instruction, "yt:intake:enrich");
    await getPool().query("UPDATE ingest.youtube_intake SET enrich_plan_id=$2, updated_at=now() WHERE id=$1",
      [Number(row.id), enrich.id]);
  } catch (error) {
    log.warn(`No se pudo preparar la investigación de la ficha del plan ${plan.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Barrido de videos pendientes
// ---------------------------------------------------------------------------

export interface IntakeSweepResult {
  started: number;
  results: IntakeRunResult[];
  auto: AutoApproveResult;
  dryRun: boolean;
}

/** Videos publicados del canal sin disco principal que aún no tienen plan vivo. */
export async function intakeCandidates(limit: number): Promise<number[]> {
  const { rows } = await getPool().query<{ id: string; title: string; description: string | null }>(`
    SELECT v.id::text, v.title, v.description
      FROM media.youtube_videos v
     WHERE v.channel_id=$1 AND v.publication_status='published'
       AND NOT EXISTS (SELECT 1 FROM media.video_albums va WHERE va.video_id=v.id AND va.is_primary_link)
       AND NOT EXISTS (SELECT 1 FROM ingest.youtube_intake yi
                        WHERE yi.video_id=v.id AND yi.status IN ('planning','linked'))
     ORDER BY v.published_at DESC NULLS LAST, v.id DESC
     LIMIT $2`, [CRV_CHANNEL_ID, Math.max(limit * 6, 30)]);
  // Solo discos completos: los videoclips y conciertos no se dan de alta aquí.
  const discs = rows.filter((row) => parseIntake({ title: row.title, description: row.description }) !== null);
  return discs.slice(0, limit).map((row) => Number(row.id));
}

export async function runIntakeSweep(options: { dryRun?: boolean; limit?: number } = {}): Promise<IntakeSweepResult> {
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? getEnv().CRV_YT_INTAKE_MAX;
  const results: IntakeRunResult[] = [];
  for (const videoDbId of await intakeCandidates(limit)) {
    try {
      results.push(await runVideoIntake(videoDbId, { dryRun }));
    } catch (error) {
      results.push({ videoDbId, videoId: "", status: "failed", artistId: null, artistCreated: false, planId: null,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const auto = dryRun ? { plans: 0, accepted: 0, skipped: 0, linked: 0 } : await autoApproveReadyIntakes();
  return { started: results.filter((item) => item.status === "planning").length, results, auto, dryRun };
}

// ---------------------------------------------------------------------------
// Consulta para el espacio de curaduría
// ---------------------------------------------------------------------------

export interface IntakeListRow {
  videoDbId: number;
  videoId: string;
  title: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  isAlbum: boolean;
  status: IntakeStatus | "sin-analizar";
  artistName: string | null;
  albumTitle: string | null;
  releaseYear: number | null;
  trackCount: number;
  artistId: number | null;
  planId: number | null;
  planStatus: string | null;
  planPhase: string | null;
  planOperations: number;
  planPending: number;
  enrichPlanId: number | null;
  enrichStatus: string | null;
  enrichPending: number;
  reviewId: number | null;
  reviewStatus: string | null;
  reason: string | null;
  error: string | null;
  intakeId: number | null;
  albumId: number | null;
}

export async function listIntakeVideos(options: { status?: string; limit?: number } = {}): Promise<IntakeListRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  const status = options.status && options.status !== "all" ? options.status : null;
  const { rows } = await getPool().query<Record<string, unknown>>(`
    SELECT v.id::text AS video_db_id, v.video_id, v.title, v.published_at::text AS published_at,
           v.thumbnail_url, v.description,
           coalesce(yi.status, CASE WHEN EXISTS (SELECT 1 FROM media.video_albums va WHERE va.video_id=v.id AND va.is_primary_link)
                                    THEN 'linked' ELSE 'sin-analizar' END) AS estado,
           yi.id::text AS intake_id, yi.artist_name, yi.album_title, yi.release_year, yi.track_count,
           yi.artist_id::text, yi.plan_id::text, yi.review_id::text, yi.reason, yi.error,
           p.status AS plan_status, p.phase AS plan_phase,
           coalesce(jsonb_array_length(p.draft->'operations'), 0) AS plan_operations,
           coalesce(jsonb_array_length(p.draft->'operations'), 0) - coalesce((SELECT count(*) FROM jsonb_object_keys(coalesce(p.decisions,'{}'::jsonb))), 0) AS plan_pending,
           yi.enrich_plan_id::text AS enrich_plan_id, p2.status AS enrich_status,
           coalesce(jsonb_array_length(p2.draft->'operations'), 0) - coalesce((SELECT count(*) FROM jsonb_object_keys(coalesce(p2.decisions,'{}'::jsonb))), 0) AS enrich_pending,
           rq.status::text AS review_status,
           (SELECT va.album_id::text FROM media.video_albums va WHERE va.video_id=v.id AND va.is_primary_link LIMIT 1) AS album_id
      FROM media.youtube_videos v
      LEFT JOIN ingest.youtube_intake yi ON yi.video_id = v.id
      LEFT JOIN ingest.ai_curation_plans p ON p.id = yi.plan_id
      LEFT JOIN ingest.ai_curation_plans p2 ON p2.id = yi.enrich_plan_id
      LEFT JOIN ingest.review_queue rq ON rq.id = yi.review_id
     WHERE v.channel_id=$1 AND v.publication_status='published'
       AND ($2::text IS NULL OR coalesce(yi.status, CASE WHEN EXISTS (SELECT 1 FROM media.video_albums va WHERE va.video_id=v.id AND va.is_primary_link)
                                    THEN 'linked' ELSE 'sin-analizar' END) = $2)
     ORDER BY v.published_at DESC NULLS LAST, v.id DESC
     LIMIT $3`, [CRV_CHANNEL_ID, status, limit]);
  const mapped = rows.map((row) => ({
    videoDbId: Number(row["video_db_id"]), videoId: String(row["video_id"]), title: String(row["title"]),
    publishedAt: row["published_at"] ? String(row["published_at"]) : null,
    thumbnailUrl: row["thumbnail_url"] ? String(row["thumbnail_url"]) : null,
    isAlbum: parseIntake({ title: String(row["title"]), description: row["description"] ? String(row["description"]) : null }) !== null,
    status: String(row["estado"]) as IntakeListRow["status"],
    artistName: row["artist_name"] ? String(row["artist_name"]) : null,
    albumTitle: row["album_title"] ? String(row["album_title"]) : null,
    releaseYear: row["release_year"] === null || row["release_year"] === undefined ? null : Number(row["release_year"]),
    trackCount: Number(row["track_count"] ?? 0),
    artistId: row["artist_id"] ? Number(row["artist_id"]) : null,
    planId: row["plan_id"] ? Number(row["plan_id"]) : null,
    planStatus: row["plan_status"] ? String(row["plan_status"]) : null,
    planPhase: row["plan_phase"] ? String(row["plan_phase"]) : null,
    planOperations: Number(row["plan_operations"] ?? 0),
    planPending: Number(row["plan_pending"] ?? 0),
    enrichPlanId: row["enrich_plan_id"] ? Number(row["enrich_plan_id"]) : null,
    enrichStatus: row["enrich_status"] ? String(row["enrich_status"]) : null,
    enrichPending: Math.max(Number(row["enrich_pending"] ?? 0), 0),
    reviewId: row["review_id"] ? Number(row["review_id"]) : null,
    reviewStatus: row["review_status"] ? String(row["review_status"]) : null,
    reason: row["reason"] ? String(row["reason"]) : null,
    error: row["error"] ? String(row["error"]) : null,
    intakeId: row["intake_id"] ? Number(row["intake_id"]) : null,
    albumId: row["album_id"] ? Number(row["album_id"]) : null,
  }));
  // «Sin analizar» es la bandeja de discos: los videoclips y conciertos no se
  // dan de alta aquí y solo aparecen en «Todos».
  return status === "sin-analizar" ? mapped.filter((row) => row.isAlbum) : mapped;
}

export interface IntakeSummary {
  sinAnalizar: number; planning: number; ready: number; review: number; linked: number; failed: number;
  openReviews: number; plansReady: number;
}

export async function intakeSummary(): Promise<IntakeSummary> {
  // Se cuenta video a video para no inflar «sin analizar» con videoclips y
  // conciertos: solo un disco completo espera alta.
  const { rows } = await getPool().query<{ title: string; description: string | null; intake_status: string | null; linked: boolean }>(`
    SELECT v.title, v.description, yi.status AS intake_status,
           EXISTS (SELECT 1 FROM media.video_albums va WHERE va.video_id=v.id AND va.is_primary_link) AS linked
      FROM media.youtube_videos v
      LEFT JOIN ingest.youtube_intake yi ON yi.video_id=v.id
     WHERE v.channel_id=$1 AND v.publication_status='published'`, [CRV_CHANNEL_ID]);
  const summary: IntakeSummary = { sinAnalizar: 0, planning: 0, ready: 0, review: 0, linked: 0, failed: 0, openReviews: 0, plansReady: 0 };
  for (const row of rows) {
    if (row.linked || row.intake_status === "linked") { summary.linked += 1; continue; }
    if (row.intake_status === "planning") { summary.planning += 1; continue; }
    if (row.intake_status === "ready") { summary.ready += 1; continue; }
    if (row.intake_status === "review") { summary.review += 1; continue; }
    if (row.intake_status === "failed") { summary.failed += 1; continue; }
    if (parseIntake({ title: row.title, description: row.description })) summary.sinAnalizar += 1;
  }
  const reviews = await getPool().query<{ total: string }>(
    "SELECT count(*)::text AS total FROM ingest.review_queue WHERE kind='youtube_match' AND status IN ('open','in_progress')");
  const ready = await getPool().query<{ total: string }>(`
    SELECT count(*)::text AS total FROM ingest.ai_curation_plans p
      JOIN ingest.youtube_intake yi ON yi.plan_id=p.id OR yi.enrich_plan_id=p.id
     WHERE p.status='ready' AND p.entity_kind='artist'`);
  summary.openReviews = Number(reviews.rows[0]?.total ?? 0);
  summary.plansReady = Number(ready.rows[0]?.total ?? 0);
  return summary;
}
