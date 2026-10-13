// CRV · Fusión de discos (PLAN_CURADURIA E6.5).
//
// Dos discos del mismo artista o recopilatorios equivalentes pueden fusionarse
// con previsualización y hash determinista:
//   1. Empareja pistas por (disco, número) y por título normalizado.
//   2. Las pistas emparejadas se fusionan (créditos y enlaces de YouTube incluidos).
//   3. Las pistas sueltas del disco que desaparece se mueven al disco que queda,
//      reubicando su número si colisiona con una pista existente.
//   4. Los créditos del disco y los formatos equivalentes se unifican.
//   5. Los enlaces de medios (media.video_albums, media.media_links) se repuntan.
//   6. El disco se fusiona mediante `mergeInto('album')`, dejando rastro en
//      `merge_audit` con `version: 2`, compatible con `undoMergeRun`.
//
// Modo `append` (2026-10-11, discos partidos en varias fichas: Lado A/B, CD 1/2,
// DVD, volúmenes): no se empareja ninguna pista. Los discos del que desaparece
// pasan como discos siguientes del que queda (disc_number + desplazamiento),
// con sus nombres de `album_discs`. Emparejar por posición pegaría la pista 1
// del Lado B a la pista 1 del Lado A.
//
// Desde la página (2026-10-13) la previsualización trae una sugerencia: si las
// listas no coinciden y un título es parte del otro («Lado B», «CD 2»,
// «B-Sides: X», «X (Demos)»), propone `append`, qué ficha queda y el nombre de
// cada disco. La fusión nombra el disco único de cada ficha y, si se pide,
// retitula la página («Live in Paris - Lado A» → «Live in Paris»). El video
// del canal del que se suma es el de SU disco: nunca llega a la ficha.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getEnv } from "../config/env.js";
import { PRESERVE_SPECS } from "./preserve.js";
import { mergeInto, MERGE_EMPTY_VALUES } from "../review/duplicates.js";
import { nameKey } from "../curation/lexicon.js";
import { mergeEquivalentCreditsOnParent } from "./equivalent-relations.js";
import { OperatorError, updateEntity, type OperatorContext } from "./operator.js";
import { resolveRedirect } from "./redirects.js";
import { albumPart, firstPartLabel, partAgainst } from "./album-parts.js";
import { createAlias, promotePrimaryAlias } from "../api/repositories/aliases.js";

export const MERGE_ALBUM_FIELDS = [
  "release_year", "album_type", "genre", "label_id", "cover_url", "description",
  "youtube_url", "youtube_status", "instagram_url", "instagram_status",
  "wordpress_url", "wordpress_status", "notes",
] as const;

export type AlbumMergeField = (typeof MERGE_ALBUM_FIELDS)[number];

export interface AlbumTrackSummary {
  id: number;
  discNumber: number;
  trackNumber: number;
  title: string;
  durationSeconds: number | null;
  creditCount: number;
}

export interface AlbumMergeSide {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  labelId: number | null;
  labelName: string | null;
  fields: Record<string, unknown>;
  aliases: string[];
  tracks: AlbumTrackSummary[];
  /** Discos de la ficha con su nombre (`album_discs`) y si tienen video propio. */
  discs: Array<{ discNumber: number; title: string | null; trackCount: number; hasVideo: boolean }>;
  counts: { tracks: number; albumCredits: number; formats: number; mediaLinks: number; claims: number };
}

export interface TrackMatch {
  keepTrackId: number;
  dropTrackId: number;
  keepTitle: string;
  dropTitle: string;
  discNumber: number;
  keepTrackNumber: number;
  dropTrackNumber: number;
  matchType: "position_and_title" | "title" | "position";
}

export type AlbumMergeMode = "match" | "append";

/** Cómo juntaría el motor estas dos fichas (orientación incluida). */
export interface AlbumMergeSuggestion {
  mode: AlbumMergeMode;
  keepId: number;
  /** Título de la página sin la parte («Live in Paris»); null lo deja como está. */
  title: string | null;
  keepDiscTitle: string | null;
  dropDiscTitle: string | null;
  reason: string;
}

export interface AlbumMergePreview {
  keep: AlbumMergeSide;
  drop: AlbumMergeSide;
  mode: AlbumMergeMode;
  /** Solo en `append`: lo que se suma al disc_number de las pistas que llegan. */
  discOffset: number;
  recommendedKeepId: number;
  matchedTracks: TrackMatch[];
  unmatchedDropTracks: AlbumTrackSummary[];
  suggestion: AlbumMergeSuggestion;
  fieldConflicts: Array<{ field: AlbumMergeField; keepValue: unknown; dropValue: unknown }>;
  fieldsFilledFromDrop: AlbumMergeField[];
  sharedCredits: Array<{ id: number; role: string; creditType: string; targetName: string }>;
  formatsToAdd: Array<{ id: number; format: string }>;
  warnings: string[];
  previewHash: string;
}

export interface AlbumMergeRequest {
  keepId: number;
  dropId: number;
  previewHash: string;
  fieldChoices?: Partial<Record<AlbumMergeField, "keep" | "drop">> | undefined;
  keepDropNameAsAlias?: boolean | undefined;
  mode?: AlbumMergeMode | undefined;
  /** Solo en `append`: nombre del disco único de cada ficha («Lado A», «B-Sides»). */
  keepDiscTitle?: string | null | undefined;
  dropDiscTitle?: string | null | undefined;
  /** Nuevo título de la página; el viejo queda como alias. */
  title?: string | null | undefined;
}

export interface AlbumMergeResult {
  keepId: number;
  dropId: number;
  auditId: number;
  tracksMerged: number;
  tracksMoved: number;
  creditsMerged: number;
  formatsMerged: number;
  fieldsCorrected: AlbumMergeField[];
  runId?: number;
}

function present(field: string, value: unknown): boolean {
  const empty = MERGE_EMPTY_VALUES[`albums.${field}`];
  if (empty === undefined) return value !== null && value !== undefined;
  if (typeof empty === "boolean") return value === !empty;
  return value !== null && value !== undefined && value !== empty;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadAlbumSide(queryable: Pick<PoolClient, "query">, id: number, lock: boolean): Promise<AlbumMergeSide | null> {
  const { rows } = await queryable.query<{
    row: Record<string, unknown> | null;
    artist_name: string;
    label_name: string | null;
  }>(`
    SELECT to_jsonb(a) AS row, ar.name AS artist_name, org.name AS label_name
      FROM public.albums a
      JOIN public.artists ar ON ar.id = a.artist_id
      LEFT JOIN public.organizations org ON org.id = a.label_id
     WHERE a.id = $1${lock ? " FOR UPDATE OF a" : ""}`, [id]);
  const data = rows[0];
  if (!data || !data.row) return null;
  const row = data.row;

  const fields = Object.fromEntries(MERGE_ALBUM_FIELDS.map((field) => [field, row[field] ?? null]));

  const aliases = (await queryable.query<{ alias: string }>(
    "SELECT alias FROM ingest.album_aliases WHERE album_id=$1 ORDER BY alias", [id]
  )).rows.map((r) => r.alias);

  const tracks = (await queryable.query<{
    id: string; disc_number: number; track_number: number; title: string; duration_seconds: number | null; credit_count: string;
  }>(`
    SELECT t.id::text, t.disc_number, t.track_number, t.title, t.duration_seconds,
           (SELECT count(*) FROM public.track_credits tc WHERE tc.track_id = t.id)::text AS credit_count
      FROM public.tracks t
     WHERE t.album_id = $1
     ORDER BY t.disc_number, t.track_number, t.id`, [id])).rows.map((t) => ({
    id: Number(t.id),
    discNumber: t.disc_number,
    trackNumber: t.track_number,
    title: t.title,
    durationSeconds: t.duration_seconds,
    creditCount: Number(t.credit_count),
  }));

  const named = new Map((await queryable.query<{ disc_number: number; title: string }>(
    "SELECT disc_number, title FROM public.album_discs WHERE album_id=$1", [id])).rows.map((r) => [r.disc_number, r.title]));
  const withVideo = new Set((await queryable.query<{ disc_number: number }>(
    "SELECT disc_number FROM public.album_disc_links WHERE album_id=$1 AND platform='youtube'", [id])).rows.map((r) => r.disc_number));
  const discNumbers = [...new Set([...tracks.map((t) => t.discNumber), ...named.keys()])].sort((a, b) => a - b);
  const discs = discNumbers.map((discNumber) => ({
    discNumber,
    title: named.get(discNumber) ?? null,
    trackCount: tracks.filter((t) => t.discNumber === discNumber).length,
    hasVideo: withVideo.has(discNumber),
  }));

  const countsQuery = await queryable.query<{ album_credits: string; formats: string; media_links: string; claims: string }>(`
    SELECT (SELECT count(*) FROM public.album_credits WHERE album_id=$1)::text AS album_credits,
           (SELECT count(*) FROM public.album_formats WHERE album_id=$1)::text AS formats,
           (SELECT count(*) FROM media.video_albums WHERE album_id=$1)::text AS media_links,
           (SELECT count(*) FROM ingest.claims WHERE album_id=$1)::text AS claims`, [id]);
  const c = countsQuery.rows[0]!;

  return {
    id,
    title: String(row["title"]),
    artistId: Number(row["artist_id"]),
    artistName: data.artist_name,
    labelId: row["label_id"] ? Number(row["label_id"]) : null,
    labelName: data.label_name,
    fields,
    aliases,
    tracks,
    discs,
    counts: {
      tracks: tracks.length,
      albumCredits: Number(c.album_credits),
      formats: Number(c.formats),
      mediaLinks: Number(c.media_links),
      claims: Number(c.claims),
    },
  };
}

async function albumSideOrThrow(queryable: Pick<PoolClient, "query">, id: number, lock: boolean): Promise<AlbumMergeSide> {
  const side = await loadAlbumSide(queryable, id, lock);
  if (side) return side;
  const moved = await resolveRedirect("album", id, queryable);
  throw new OperatorError("not_found", `álbum ${id} inexistente`, { entity: "album", id, ...(moved ? { movedTo: moved } : {}) });
}

function matchTracks(keepTracks: AlbumTrackSummary[], dropTracks: AlbumTrackSummary[]): {
  matched: TrackMatch[];
  unmatched: AlbumTrackSummary[];
} {
  const matched: TrackMatch[] = [];
  const usedKeep = new Set<number>();
  const unmatched: AlbumTrackSummary[] = [];

  // Paso 1: misma posición y título idéntico/normalizado
  for (const drop of dropTracks) {
    const exact = keepTracks.find((k) => !usedKeep.has(k.id)
      && k.discNumber === drop.discNumber
      && k.trackNumber === drop.trackNumber
      && nameKey(k.title) === nameKey(drop.title));
    if (exact) {
      usedKeep.add(exact.id);
      matched.push({
        keepTrackId: exact.id,
        dropTrackId: drop.id,
        keepTitle: exact.title,
        dropTitle: drop.title,
        discNumber: exact.discNumber,
        keepTrackNumber: exact.trackNumber,
        dropTrackNumber: drop.trackNumber,
        matchType: "position_and_title",
      });
    }
  }

  // Paso 2: mismo título normalizado aunque la posición varíe
  for (const drop of dropTracks) {
    if (matched.some((m) => m.dropTrackId === drop.id)) continue;
    const sameTitle = keepTracks.find((k) => !usedKeep.has(k.id)
      && nameKey(k.title) === nameKey(drop.title));
    if (sameTitle) {
      usedKeep.add(sameTitle.id);
      matched.push({
        keepTrackId: sameTitle.id,
        dropTrackId: drop.id,
        keepTitle: sameTitle.title,
        dropTitle: drop.title,
        discNumber: sameTitle.discNumber,
        keepTrackNumber: sameTitle.trackNumber,
        dropTrackNumber: drop.trackNumber,
        matchType: "title",
      });
    }
  }

  // Paso 3: misma posición (si no hay colisión de títulos contradictorios)
  for (const drop of dropTracks) {
    if (matched.some((m) => m.dropTrackId === drop.id)) continue;
    const samePos = keepTracks.find((k) => !usedKeep.has(k.id)
      && k.discNumber === drop.discNumber
      && k.trackNumber === drop.trackNumber);
    if (samePos) {
      usedKeep.add(samePos.id);
      matched.push({
        keepTrackId: samePos.id,
        dropTrackId: drop.id,
        keepTitle: samePos.title,
        dropTitle: drop.title,
        discNumber: samePos.discNumber,
        keepTrackNumber: samePos.trackNumber,
        dropTrackNumber: drop.trackNumber,
        matchType: "position",
      });
    } else {
      unmatched.push(drop);
    }
  }

  return { matched, unmatched };
}

/**
 * La misma lista (el 60 % de la más corta empareja por título) es el mismo
 * disco: `match`, salvo que una ficha sea material extra de la otra (B-Sides,
 * demos). Si no, y un título es parte del otro, se suma como disco siguiente;
 * queda la primera parte («Lado A», el álbum de sus «B-Sides»).
 */
export function suggestJoin(
  keep: AlbumMergeSide, drop: AlbumMergeSide, matched: TrackMatch[], recommendedKeepId: number,
): AlbumMergeSuggestion {
  const keepPart = partAgainst(keep.title, drop.title);
  const dropPart = partAgainst(drop.title, keep.title);
  // B-Sides, demos, sessions: repiten títulos, pero son otras grabaciones.
  const extra = keepPart?.kind === "extra" || dropPart?.kind === "extra";
  const byTitle = matched.filter((match) => match.matchType !== "position").length;
  const smaller = Math.min(keep.tracks.length, drop.tracks.length);
  if (!extra && smaller > 0 && byTitle / smaller >= 0.6) {
    return { mode: "match", keepId: recommendedKeepId, title: null, keepDiscTitle: null, dropDiscTitle: null,
      reason: `${byTitle} de ${smaller} pistas coinciden por título: es el mismo disco.` };
  }
  if (!keepPart && !dropPart) {
    return { mode: "match", keepId: recommendedKeepId, title: null, keepDiscTitle: null, dropDiscTitle: null,
      reason: "Ningún título indica que una ficha sea parte de la otra." };
  }
  // Queda la parte de menor orden; la ficha sin parte es el disco principal.
  const rank = (part: typeof keepPart): number => part ? part.order ?? 99 : 0;
  const keepFirst = rank(keepPart) <= rank(dropPart);
  const [first, second, firstPart, secondPart] = keepFirst
    ? [keep, drop, keepPart, dropPart] as const
    : [drop, keep, dropPart, keepPart] as const;
  const dropDiscTitle = secondPart?.label ?? null;
  const keepDiscTitle = firstPart?.label ?? (dropDiscTitle ? firstPartLabel(dropDiscTitle) : null);
  // «Live in Paris - Lado A» → «Live in Paris»; «X (CD Reissue)» no se retitula.
  const own = albumPart(first.title);
  return {
    mode: "append",
    keepId: first.id,
    title: own && own.kind !== "edicion" && own.base !== first.title ? own.base : null,
    keepDiscTitle: first.discs.length <= 1 && !first.discs[0]?.title ? keepDiscTitle : null,
    dropDiscTitle: second.discs.length <= 1 ? dropDiscTitle : null,
    reason: `«${second.title}» es ${dropDiscTitle ? `«${dropDiscTitle}» de` : "otra parte de"} «${first.title}»: se suma como disco siguiente.`,
  };
}

/** Nombra el disco de una ficha que tiene uno solo. */
async function nameSingleDisc(context: OperatorContext, albumId: number, title: string, note: string): Promise<void> {
  const discs = (await context.client.query<{ disc_number: number }>(`
    SELECT disc_number FROM public.tracks WHERE album_id=$1
     UNION SELECT disc_number FROM public.album_discs WHERE album_id=$1`, [albumId])).rows.map((r) => r.disc_number);
  if (discs.length > 1) return;
  await context.client.query(`
    INSERT INTO public.album_discs(album_id, disc_number, title, notes) VALUES ($1,$2,$3,$4)
    ON CONFLICT (album_id, disc_number) DO UPDATE SET title=EXCLUDED.title`,
  [albumId, discs[0] ?? 1, title, note]);
}

export async function previewAlbumMerge(
  queryable: Pick<PoolClient, "query">, keepId: number, dropId: number,
  options: { lock?: boolean; mode?: AlbumMergeMode } = {},
): Promise<AlbumMergePreview> {
  if (keepId === dropId) throw new OperatorError("invalid", "no se puede fusionar un disco consigo mismo", { entity: "album", id: keepId });
  const lock = options.lock ?? false;
  const mode = options.mode ?? "match";
  const keep = await albumSideOrThrow(queryable, keepId, lock);
  const drop = await albumSideOrThrow(queryable, dropId, lock);

  const fieldConflicts: AlbumMergePreview["fieldConflicts"] = [];
  const fieldsFilledFromDrop: AlbumMergeField[] = [];
  // Con la proyección encendida, los géneros se trasladan fila a fila en la
  // fusión y `albums.genre` se recalcula: no es un campo que elegir.
  const genresProjected = getEnv().GENRES_PROJECTION_ENABLED;
  for (const field of MERGE_ALBUM_FIELDS) {
    if (field === "genre" && genresProjected) continue;
    // En `append` el video del que se suma pasa a su disco (album_disc_links).
    if (mode === "append" && (field === "youtube_url" || field === "youtube_status")) continue;
    const keepPresent = present(field, keep.fields[field]);
    const dropPresent = present(field, drop.fields[field]);
    if (!keepPresent && dropPresent) {
      fieldsFilledFromDrop.push(field);
    } else if (keepPresent && dropPresent && !sameValue(keep.fields[field], drop.fields[field])) {
      fieldConflicts.push({ field, keepValue: keep.fields[field], dropValue: drop.fields[field] });
    }
  }

  const matching = matchTracks(keep.tracks, drop.tracks);
  const { matched: matchedTracks, unmatched: unmatchedDropTracks } = mode === "append"
    ? { matched: [], unmatched: drop.tracks }
    : matching;
  const discOffset = mode === "append"
    ? Math.max(0, ...keep.tracks.map((t) => t.discNumber), ...(await queryable.query<{ disc_number: number }>(
      "SELECT disc_number FROM public.album_discs WHERE album_id=$1", [keepId])).rows.map((r) => r.disc_number))
    : 0;

  const warnings: string[] = [];
  if (keep.artistId !== drop.artistId) {
    warnings.push(`Artistas distintos: «${keep.artistName}» (${keep.artistId}) contra «${drop.artistName}» (${drop.artistId}).`);
  }
  if (keep.fields["release_year"] && drop.fields["release_year"] && keep.fields["release_year"] !== drop.fields["release_year"]) {
    warnings.push(`Años de publicación distintos (${keep.fields["release_year"]} vs ${drop.fields["release_year"]}).`);
  }
  if (mode === "match" && keep.tracks.length !== drop.tracks.length) {
    warnings.push(`Distinto número de pistas: ${keep.tracks.length} en el disco que queda, ${drop.tracks.length} en el que desaparece.`);
  }

  // Créditos compartidos
  const sharedCredits = (await queryable.query<{
    id: string; role: string; credit_type: string; target_name: string;
  }>(`
    SELECT c.id::text, c.role, c.credit_type::text,
           COALESCE(p.name, ar.name, org.name, '?') AS target_name
      FROM public.album_credits c
      LEFT JOIN public.persons p ON p.id = c.person_id
      LEFT JOIN public.artists ar ON ar.id = c.artist_id
      LEFT JOIN public.organizations org ON org.id = c.organization_id
     WHERE c.album_id = $1
     ORDER BY c.credit_type, c.role`, [dropId])).rows.map((c) => ({
    id: Number(c.id),
    role: c.role,
    creditType: c.credit_type,
    targetName: c.target_name,
  }));

  // Formatos que se incorporarán
  const formatsToAdd = (await queryable.query<{ id: string; format: string }>(`
    SELECT f.id::text, f.format
      FROM public.album_formats f
     WHERE f.album_id = $1
       AND NOT EXISTS (SELECT 1 FROM public.album_formats kf WHERE kf.album_id = $2 AND kf.format = f.format)
     ORDER BY f.id`, [dropId, keepId])).rows.map((f) => ({ id: Number(f.id), format: f.format }));

  // Criterio de recomendación: más pistas o más referencias
  const keepScore = keep.tracks.length * 10 + keep.counts.albumCredits + keep.counts.mediaLinks;
  const dropScore = drop.tracks.length * 10 + drop.counts.albumCredits + drop.counts.mediaLinks;
  const recommendedKeepId = keepScore >= dropScore ? keep.id : drop.id;
  const suggestion = suggestJoin(keep, drop, matching.matched, recommendedKeepId);

  const previewHash = createHash("sha256").update(JSON.stringify([
    "album", mode, discOffset,
    keep.id, keep.title, keep.fields, keep.tracks.map((t) => [t.discNumber, t.trackNumber, t.title]),
    drop.id, drop.title, drop.fields, drop.tracks.map((t) => [t.discNumber, t.trackNumber, t.title]),
    matchedTracks.map((m) => [m.keepTrackId, m.dropTrackId, m.matchType]),
  ])).digest("hex");

  return {
    keep,
    drop,
    mode,
    discOffset,
    recommendedKeepId,
    matchedTracks,
    unmatchedDropTracks,
    suggestion,
    fieldConflicts,
    fieldsFilledFromDrop,
    sharedCredits,
    formatsToAdd,
    warnings,
    previewHash,
  };
}

export async function mergeAlbums(context: OperatorContext, request: AlbumMergeRequest): Promise<AlbumMergeResult> {
  const { keepId, dropId } = request;
  await context.client.query("SELECT pg_advisory_xact_lock(hashtext('merge:duplicates'))");

  const preview = await previewAlbumMerge(context.client, keepId, dropId, { lock: true, mode: request.mode ?? "match" });
  if (preview.previewHash !== request.previewHash) {
    throw new OperatorError("stale_preview", "el disco cambió desde la previsualización", {
      entity: "album", keepId, dropId, previewHash: preview.previewHash,
    });
  }

  // 0. Nombres de disco (solo `append`): van antes de mover los discos.
  if (preview.mode === "append") {
    const note = `Fusión de discos (run ${context.runId})`;
    if (request.keepDiscTitle?.trim()) await nameSingleDisc(context, keepId, request.keepDiscTitle.trim(), note);
    if (request.dropDiscTitle?.trim()) await nameSingleDisc(context, dropId, request.dropDiscTitle.trim(), note);
  }

  // 1. Correcciones de campo elegidas de drop
  // Sin elección nada se pierde (preserve.ts): la reseña se une y queda
  // marcada para reescribir; el dato corto del duplicado va a las notas.
  // Elegir un lado de la reseña es descartar el otro a propósito; elegir el
  // dato corto del duplicado manda el de la que queda a las notas.
  const fieldsCorrected: AlbumMergeField[] = [];
  const resolved: string[] = [];
  const replaced: Array<{ field: string; value: unknown }> = [];
  for (const conflict of preview.fieldConflicts) {
    const choice = request.fieldChoices?.[conflict.field];
    if (choice === undefined) continue;
    if (conflict.field === "description" || conflict.field === "notes") resolved.push(conflict.field);
    if (choice !== "drop") continue;
    await updateEntity(context, "album", keepId, { [conflict.field]: conflict.dropValue });
    fieldsCorrected.push(conflict.field);
    if (conflict.field in PRESERVE_SPECS.album.note) {
      replaced.push({ field: conflict.field, value: conflict.keepValue });
      resolved.push(conflict.field);
    }
  }

  // 2. Fusión física de pistas emparejadas
  let tracksMerged = 0;
  for (const match of preview.matchedTracks) {
    if (match.keepTrackId === match.dropTrackId) continue;
    await mergeInto(context.client, "track", match.keepTrackId, match.dropTrackId, context.note, context.runId, { alias: false });
    await mergeEquivalentCreditsOnParent(context.client, { kind: "track", id: match.keepTrackId }, context.note, context.runId);
    tracksMerged += 1;
  }

  // 3. Pistas no emparejadas: mover al álbum destino evitando colisiones en tracks_position_uk
  let tracksMoved = 0;
  if (preview.mode === "append") {
    // Discos enteros: pasan detrás de los del que queda, con sus nombres y
    // sus enlaces de escucha.
    await context.client.query(
      "UPDATE public.album_discs SET album_id=$1, disc_number=disc_number+$3 WHERE album_id=$2",
      [keepId, dropId, preview.discOffset]);
    await context.client.query(
      "UPDATE public.album_disc_links SET album_id=$1, disc_number=disc_number+$3 WHERE album_id=$2",
      [keepId, dropId, preview.discOffset]);
    // El enlace del álbum que desaparece (su «Vol. 2» en Spotify) es el de su
    // primer disco: `streaming_links` admite uno por plataforma y mergeInto lo
    // descartaría al chocar con el del que queda. El que repite la URL del
    // que queda no aporta nada y sí se descarta.
    await context.client.query(`
      WITH first AS (
        SELECT $3::int + COALESCE((SELECT min(disc_number) FROM public.tracks WHERE album_id=$2), 1) AS disc
      ), moved AS (
        DELETE FROM public.streaming_links s
         WHERE s.album_id=$2
           AND NOT EXISTS (SELECT 1 FROM public.streaming_links k WHERE k.album_id=$1 AND k.platform=s.platform AND k.url=s.url)
           AND NOT EXISTS (SELECT 1 FROM public.album_disc_links d, first
                            WHERE d.album_id=$1 AND d.disc_number=first.disc AND d.platform=s.platform)
        RETURNING s.*
      )
      INSERT INTO public.album_disc_links(album_id,disc_number,platform,url,external_id,method,source,verified,notes)
      SELECT $1, first.disc, m.platform, m.url, m.external_id, m.method, m.source, m.verified, m.notes FROM moved m, first`,
    [keepId, dropId, preview.discOffset]);
    // Su video del canal (albums.youtube_url) también es el de ese disco; en
    // la columna del que queda chocaría y solo llegaría a las notas.
    await context.client.query(`
      INSERT INTO public.album_disc_links(album_id,disc_number,platform,url,method,source,verified,notes)
      SELECT $1, $3::int + COALESCE((SELECT min(disc_number) FROM public.tracks WHERE album_id=$2), 1),
             'youtube', d.youtube_url, 'exact', 'album-merge', true, 'Video del canal del disco sumado'
        FROM public.albums d, public.albums k
       WHERE d.id=$2 AND k.id=$1 AND d.youtube_url IS NOT NULL AND d.youtube_url IS DISTINCT FROM k.youtube_url
      ON CONFLICT (album_id, disc_number, platform) DO NOTHING`,
    [keepId, dropId, preview.discOffset]);
    // Ya está en su disco: ni rellena el video de la ficha (el disco 1 sonaría
    // con el del Lado B) ni acaba en las notas.
    await context.client.query(
      "UPDATE public.albums SET youtube_url=NULL, youtube_status='unknown' WHERE id=$1 AND youtube_url IS NOT NULL", [dropId]);
    tracksMoved = (await context.client.query(
      "UPDATE public.tracks SET album_id=$1, disc_number=disc_number+$3 WHERE album_id=$2",
      [keepId, dropId, preview.discOffset])).rowCount ?? 0;
  }
  for (const track of preview.mode === "append" ? [] : preview.unmatchedDropTracks) {
    const existing = (await context.client.query<{ max_track: number | null }>(`
      SELECT max(track_number) AS max_track FROM public.tracks WHERE album_id=$1 AND disc_number=$2`,
    [keepId, track.discNumber])).rows[0];
    const maxTrack = existing?.max_track ?? 0;
    // Si la posición colisiona con una existente en keep, asignar max + 1
    const collides = (await context.client.query("SELECT 1 FROM public.tracks WHERE album_id=$1 AND disc_number=$2 AND track_number=$3",
      [keepId, track.discNumber, track.trackNumber])).rowCount;
    const finalNumber = collides ? maxTrack + 1 : track.trackNumber;

    await context.client.query(
      "UPDATE public.tracks SET album_id=$1, track_number=$2 WHERE id=$3",
      [keepId, finalNumber, track.id],
    );
    tracksMoved += 1;
  }

  // 4. Formatos: los que no colisionan se pasan; los duplicados se consolidan
  let formatsMerged = 0;
  for (const fmt of preview.formatsToAdd) {
    await context.client.query("UPDATE public.album_formats SET album_id=$1 WHERE id=$2", [keepId, fmt.id]);
    formatsMerged += 1;
  }

  // 5. Enlaces de medios: video_albums y media_links. Un álbum tiene a lo sumo
  // un video principal (video_albums_one_primary_per_album_uk): si el que
  // queda ya lo tiene, el del que desaparece llega como secundario.
  await context.client.query(`
    UPDATE media.video_albums SET is_primary_link=false
     WHERE album_id=$2 AND is_primary_link
       AND EXISTS (SELECT 1 FROM media.video_albums k WHERE k.album_id=$1 AND k.is_primary_link)`, [keepId, dropId]);
  await context.client.query(`
    DELETE FROM media.video_albums d
     WHERE d.album_id=$2 AND EXISTS (SELECT 1 FROM media.video_albums k WHERE k.album_id=$1 AND k.video_id=d.video_id)`, [keepId, dropId]);
  await context.client.query("UPDATE media.video_albums SET album_id=$1 WHERE album_id=$2", [keepId, dropId]);
  await context.client.query("UPDATE media.media_links SET album_id=$1 WHERE album_id=$2", [keepId, dropId]);

  // 6. Fusión final del disco vía mergeInto; aquí llegan los créditos de drop.
  const merged = await mergeInto(
    context.client, "album", keepId, dropId, context.note, context.runId,
    { alias: request.keepDropNameAsAlias ?? false, preserve: { resolved, replaced } },
  );

  // 6b. Título de la página sin la parte; el viejo queda como alias.
  const newTitle = request.title?.trim();
  if (newTitle && newTitle !== preview.keep.title) {
    const known = await context.client.query("SELECT 1 FROM ingest.album_aliases WHERE album_id=$1 AND alias=$2", [keepId, preview.keep.title]);
    if (!known.rowCount) await createAlias(context, "album", keepId, { alias: preview.keep.title, aliasType: "alternate_title", isPrimary: false });
    await updateEntity(context, "album", keepId, { title: newTitle });
    await promotePrimaryAlias(context, "album", keepId, newTitle, "alternate_title");
  }

  // 7. Solo ahora pueden compararse los créditos de ambos discos. Hacerlo
  // antes de mergeInto dejaba duplicados cuando cada ficha tenía el mismo rol.
  const creditsMerged = await mergeEquivalentCreditsOnParent(
    context.client, { kind: "album", id: keepId }, context.note, context.runId,
  );


  return {
    keepId,
    dropId,
    auditId: merged.auditId,
    tracksMerged,
    tracksMoved,
    creditsMerged,
    formatsMerged,
    fieldsCorrected,
    runId: context.runId,
  };
}
