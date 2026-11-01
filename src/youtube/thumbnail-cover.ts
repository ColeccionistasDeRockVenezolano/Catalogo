// CRV · Portada y sello desde la miniatura del canal (Brian, 2026-10-31).
//
// Las miniaturas del canal siguen una plantilla de 1280×720: la portada del
// disco en un recuadro fijo a la izquierda sobre un fondo desenfocado y, a la
// derecha, tres líneas de texto (disco, banda y sello). Hermes recortó así las
// 653 miniaturas de Desktop/PORTADAS (scripts/thumbnails-covers.py, 2026-10-23);
// este módulo hace lo mismo para cada video del canal, con la miniatura de
// mayor calidad que publica YouTube (maxresdefault, 1280×720):
//
//  * PORTADA: si el disco no tiene, el recorte pasa a ser su portada (staging
//    SSD → almacén); si tiene otra imagen distinta, entra como candidata en
//    Curaduría · Portadas y fotos. Una miniatura «a sangre» (sin recuadro) no
//    se recorta.
//  * SELLO: la línea del sello se lee con tesseract y solo se asigna si el disco
//    no tiene sello y la lectura es limpia (≥ 80 %). Se busca por nombre o alias
//    normalizados; entre duplicados manda el nombre idéntico o el más usado. Un
//    sello sin ficha se da de alta solo con lectura ≥ 90 %. «Independent» es
//    autoedición: no es un sello.
//
// Tracklist, minutos, créditos y año ya los consume el vigilante (channel-watch);
// tipo y géneros, album-completion. Cada disco tocado queda en su propio run.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { getPool } from "../db/client.js";
import { moduleLogger } from "../logger/index.js";
import { OperatorError, createEntity, updateEntity, withOperatorRun } from "../merge/operator.js";
import { proposeImageCandidate } from "../merge/image-candidates.js";
import { downloadImage } from "../merge/image-inspection.js";
import { syncCoreAlbumLabel } from "../catalog/album-labels.js";
import { publishCuratedImage } from "../storage/published-image.js";
import { fingerprintDistance, inspectImage } from "../verification/image-quality.js";
import { CRV_CHANNEL_ID } from "./home-channel.js";

/** tesseract leyendo la imagen por la entrada estándar; devuelve su TSV. */
function tesseract(image: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tesseract", ["stdin", "stdout", "-l", "spa", "--psm", "7", "tsv"], { timeout: 30_000 });
    let out = "", err = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`tesseract salió con ${code}: ${err.trim()}`))));
    child.stdin.end(image);
  });
}
const log = moduleLogger("youtube:thumbnail");

export const THUMBNAIL_OPERATOR = "yt:miniatura";
const TEMPLATE_W = 1280, TEMPLATE_H = 720;
/** Recuadro de la portada (scripts/thumbnails-covers.py): x=63 es antialias, el arte empieza en 64. */
const BOX = { x0: 64, y0: 71, x1: 553, y1: 561 };
const X_TEXT = 590;
const LABEL_BAND = { y0: 378, y1: 440 };
/** Nitidez del fondo frente a la de la portada por debajo de la cual hay plantilla. */
const TEMPLATE_RATIO = 0.2;
/** Huellas a esta distancia o menos son la misma imagen (groupVariants): recorte y copia guardada difieren en escala y compresión. */
const SAME_PICTURE = 10;
/** Por debajo, tesseract mezcla el sello con el fondo (calibrado sobre 62 miniaturas de Hermes). */
const LABEL_MIN_CONFIDENCE = 80;
/** Un sello sin ficha se da de alta solo con una lectura muy limpia. */
const LABEL_CREATE_CONFIDENCE = 90;
const RETRY_DAYS = 30;
const SWEEP_MAX = 20;
const SELF_RELEASED = new Set(["independent", "independiente", "independiente digital", "autoedicion", "self released", "selfreleased"]);

// ---------------------------------------------------------------------------
// Imagen (puro)
// ---------------------------------------------------------------------------

/** Nitidez media (|laplaciano|) de un rectángulo de la imagen en grises. */
function sharpness(grey: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0, count = 0;
  for (let y = Math.max(1, y0); y < y1 - 1; y++) {
    for (let x = Math.max(1, x0); x < x1 - 1; x++) {
      const at = y * width + x;
      sum += Math.abs(4 * grey[at]! - grey[at - 1]! - grey[at + 1]! - grey[at - width]! - grey[at + width]!);
      count++;
    }
  }
  return sum / count;
}

/**
 * La plantilla pone la portada nítida sobre un fondo desenfocado; una miniatura
 * «a sangre» es nítida en toda su superficie. Se mide el fondo en las franjas
 * que nunca llevan texto (arriba, abajo, el margen izquierdo y bajo el texto).
 * Calibrado con las 616 miniaturas que Hermes clasificó: proporción < 0,2
 * reconoce 568 de 582 plantillas y ninguna de las 34 a sangre.
 */
export function templateRatio(grey: Uint8Array, width: number): number {
  const background = (sharpness(grey, width, 0, 0, TEMPLATE_W, 60) + sharpness(grey, width, 0, 575, TEMPLATE_W, TEMPLATE_H)
    + sharpness(grey, width, 0, 0, 55, TEMPLATE_H) + sharpness(grey, width, 600, 460, TEMPLATE_W, TEMPLATE_H)) / 4;
  return background / (sharpness(grey, width, BOX.x0 + 6, BOX.y0 + 9, BOX.x1 - 8, BOX.y1 - 11) + 0.01);
}

export interface ThumbnailCover { cover: Buffer; ratio: number }

/** Recorte de la portada si la miniatura sigue la plantilla; el motivo si es otra cosa o va a sangre. */
export async function cropTemplateCover(bytes: Buffer): Promise<ThumbnailCover | { reason: string }> {
  const image = sharp(bytes, { failOn: "error" });
  const meta = await image.metadata();
  if (meta.width !== TEMPLATE_W || meta.height !== TEMPLATE_H) return { reason: `la miniatura mide ${meta.width}×${meta.height}, no 1280×720` };
  const ratio = templateRatio(await image.clone().greyscale().raw().toBuffer(), TEMPLATE_W);
  if (ratio >= TEMPLATE_RATIO) return { reason: `miniatura sin recuadro de portada (a sangre; fondo/portada ${ratio.toFixed(2)})` };
  const cover = await image.clone()
    .extract({ left: BOX.x0, top: BOX.y0, width: BOX.x1 - BOX.x0, height: BOX.y1 - BOX.y0 })
    .png({ compressionLevel: 9 }).toBuffer();
  return { cover, ratio };
}

/** Línea del sello: tesseract sobre la franja ampliada ×3 (texto claro sobre fondo oscuro). */
export async function readThumbnailLabel(bytes: Buffer): Promise<{ text: string; confidence: number } | null> {
  const band = await sharp(bytes)
    .extract({ left: X_TEXT, top: LABEL_BAND.y0, width: TEMPLATE_W - X_TEXT, height: LABEL_BAND.y1 - LABEL_BAND.y0 })
    .resize({ width: (TEMPLATE_W - X_TEXT) * 3, kernel: "cubic" }).greyscale().negate().normalise().png().toBuffer();
  let stdout: string;
  try {
    stdout = await tesseract(band);
  } catch (error) {
    log.warn({ error: String(error) }, "tesseract no pudo leer el sello");
    return null;
  }
  const words: string[] = [], confidences: number[] = [];
  for (const line of stdout.split("\n").slice(1)) {
    const fields = line.split("\t");
    if (fields.length < 12 || fields[0] !== "5" || !fields[11]!.trim()) continue;
    words.push(fields[11]!.trim());
    confidences.push(Number(fields[10]));
  }
  const text = words.join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.)]+$/gu, "").trim();
  if (text.length < 2) return null;
  return { text, confidence: Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) };
}

export function labelKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

interface Target { albumId: number; title: string; coverUrl: string | null; labelId: number | null; videoId: string }

async function targets(videoIds: string[] | undefined, limit: number): Promise<Target[]> {
  const { rows } = await getPool().query<{ album_id: string; title: string; cover_url: string | null; label_id: string | null; video_id: string }>(`
    SELECT * FROM (
      SELECT DISTINCT ON (al.id) al.id::text AS album_id, al.title, NULLIF(al.cover_url, '') AS cover_url, al.label_id::text, v.video_id
        FROM media.video_albums va
        JOIN media.youtube_videos v ON v.id = va.video_id
        JOIN public.albums al ON al.id = va.album_id
       WHERE va.is_primary_link AND v.channel_id = $1
         AND v.publication_status NOT IN ('unpublished', 'copyright_blocked')
         AND ($2::text[] IS NOT NULL AND v.video_id = ANY($2::text[])
              OR $2::text[] IS NULL AND (NULLIF(al.cover_url, '') IS NULL OR al.label_id IS NULL)
                 AND NOT EXISTS (SELECT 1 FROM ingest.scrape_runs r WHERE r.params->>'operator' = $3
                        AND r.params->>'albumId' = al.id::text AND r.started_at > now() - make_interval(days => $4)))
       ORDER BY al.id, v.published_at DESC NULLS LAST) t
     ORDER BY (cover_url IS NULL) DESC, album_id::int DESC
     LIMIT $5`, [CRV_CHANNEL_ID, videoIds?.length ? videoIds : null, THUMBNAIL_OPERATOR, RETRY_DAYS, limit]);
  return rows.map((row) => ({ albumId: Number(row.album_id), title: row.title, coverUrl: row.cover_url, labelId: row.label_id ? Number(row.label_id) : null, videoId: row.video_id }));
}

/**
 * Ficha del sello por nombre o alias normalizados. Si hay duplicados pendientes de
 * fusión manda la de nombre idéntico y, si no, la más usada por discos.
 */
async function organizationByName(name: string): Promise<{ id: number; name: string } | null> {
  const key = labelKey(name);
  const { rows } = await getPool().query<{ id: string; name: string; key: string; albums: number }>(`
    WITH candidates AS (
      SELECT o.id, o.name, o.name AS key FROM public.organizations o WHERE o.organization_type = 'record_label'
      UNION ALL
      SELECT o.id, o.name, x.alias FROM ingest.organization_aliases x JOIN public.organizations o ON o.id = x.organization_id
    )
    SELECT c.id::text, c.name, c.key, COALESCE(u.albums, 0) AS albums
      FROM candidates c
      LEFT JOIN (SELECT label_id, count(*)::int AS albums FROM public.albums WHERE label_id IS NOT NULL GROUP BY label_id) u ON u.label_id = c.id`);
  const found = rows.filter((row) => labelKey(row.key) === key)
    .sort((a, b) => Number(b.name === name) - Number(a.name === name) || b.albums - a.albums || Number(a.id) - Number(b.id));
  return found[0] ? { id: Number(found[0].id), name: found[0].name } : null;
}

export interface ThumbnailOutcome {
  albumId: number; title: string; videoId: string;
  cover: "asignada" | "candidata" | "igual a la actual" | "ya propuesta" | string;
  label: string | null;
  runId?: number;
  error?: string;
}

export async function completeThumbnailCovers(options: { videoIds?: string[]; limit?: number; dryRun?: boolean } = {}): Promise<ThumbnailOutcome[]> {
  const outcomes: ThumbnailOutcome[] = [];
  for (const target of await targets(options.videoIds, options.limit ?? SWEEP_MAX)) {
    const outcome: ThumbnailOutcome = { albumId: target.albumId, title: target.title, videoId: target.videoId, cover: "", label: null };
    try {
      await completeOne(target, outcome, Boolean(options.dryRun));
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
      log.warn({ albumId: target.albumId, error: outcome.error }, "No se pudo leer la miniatura del disco.");
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

async function completeOne(target: Target, outcome: ThumbnailOutcome, dryRun: boolean): Promise<void> {
  const thumbnailUrl = `https://i.ytimg.com/vi/${target.videoId}/maxresdefault.jpg`;
  const download = await downloadImage(thumbnailUrl);
  if ("error" in download) { outcome.cover = `sin miniatura maxres (${download.error})`; return; }
  const crop = await cropTemplateCover(download.bytes);
  const label = "reason" in crop ? null : await readThumbnailLabel(download.bytes);

  // Portada: qué haría
  let coverPlan: { kind: "assign" | "candidate"; bytes: Buffer; sha256: string; inspection: Awaited<ReturnType<typeof inspectImage>> } | null = null;
  if ("reason" in crop) outcome.cover = crop.reason;
  else {
    const inspection = await inspectImage(crop.cover);
    const sha256 = createHash("sha256").update(crop.cover).digest("hex");
    if (!inspection.ok) outcome.cover = `recorte ilegible: ${inspection.error}`;
    else if (!target.coverUrl) coverPlan = { kind: "assign", bytes: crop.cover, sha256, inspection };
    else {
      const current = await downloadImage(target.coverUrl);
      const currentPrint = "error" in current ? null : (await inspectImage(current.bytes)).fingerprint;
      if (currentPrint && inspection.fingerprint && fingerprintDistance(currentPrint, inspection.fingerprint) <= SAME_PICTURE) outcome.cover = "igual a la actual";
      else coverPlan = { kind: "candidate", bytes: crop.cover, sha256, inspection };
    }
  }

  // Sello: qué haría
  let labelPlan: { id: number; name: string } | { create: string } | null = null;
  if (label) {
    if (label.confidence < LABEL_MIN_CONFIDENCE) outcome.label = `«${label.text}» (${label.confidence} %): lectura dudosa, no se usa`;
    else if (SELF_RELEASED.has(labelKey(label.text))) outcome.label = `«${label.text}»: autoedición, sin sello`;
    else if (target.labelId !== null) outcome.label = `«${label.text}»: el disco ya tiene sello`;
    else {
      const known = await organizationByName(label.text);
      if (known) { labelPlan = known; outcome.label = `«${label.text}» → ${known.name} (${known.id})`; }
      else if (label.confidence >= LABEL_CREATE_CONFIDENCE) { labelPlan = { create: label.text }; outcome.label = `«${label.text}» (${label.confidence} %): sello nuevo`; }
      else outcome.label = `«${label.text}» (${label.confidence} %): sin ficha y lectura no tan limpia, no se crea`;
    }
  } else if (!("reason" in crop)) outcome.label = "sello ilegible";

  if (coverPlan) outcome.cover = coverPlan.kind === "assign" ? "asignada" : "candidata";
  if (dryRun) return;
  // Un run por disco revisado, aunque no cambie nada: marca el intento para la espera de 30 días.
  const { runId } = await withOperatorRun({
    name: "disco-del-canal-miniatura", operator: THUMBNAIL_OPERATOR,
    note: `Portada y sello desde la miniatura del video ${target.videoId} (plantilla del canal; Brian, 2026-10-31)`,
    params: { albumId: target.albumId, videoId: target.videoId, thumbnailUrl, cover: outcome.cover, label: label?.text ?? null, labelConfidence: label?.confidence ?? null },
  }, async (context) => {
    if (coverPlan) {
      const url = await publishCuratedImage(coverPlan.bytes, `${coverPlan.sha256}.png`);
      if (coverPlan.kind === "assign") {
        const locked = (await context.client.query<{ cover_url: string | null }>("SELECT NULLIF(cover_url, '') AS cover_url FROM public.albums WHERE id=$1 FOR UPDATE", [target.albumId])).rows[0];
        if (locked?.cover_url) coverPlan = { ...coverPlan, kind: "candidate" };
        else await updateEntity(context, "album", target.albumId, { cover_url: url });
      }
      if (coverPlan.kind === "candidate") {
        const { inspection } = coverPlan;
        const result = await proposeImageCandidate(context.client, {
          kind: "album", targetId: target.albumId, currentUrl: target.coverUrl, candidateUrl: url, source: "Canal de YouTube",
          pageUrl: `https://www.youtube.com/watch?v=${target.videoId}`, origin: THUMBNAIL_OPERATOR, runId: context.runId,
          ...(inspection.width === null ? {} : { width: inspection.width }), ...(inspection.height === null ? {} : { height: inspection.height }),
          context: `Portada recortada de la miniatura del video ${target.videoId} (plantilla del canal)`,
        });
        outcome.cover = result === "proposed" ? "candidata" : "ya propuesta";
        if (result === "proposed") await context.client.query(`UPDATE ingest.image_candidates SET
            stored_url=$3, stored_sha256=$4, natural_width=$5, natural_height=$6, effective_width=$7,
            sharpness=$8, quality=$9, image_use='cover', fingerprint=$10, inspection_reasons=$11, inspected_at=now()
          WHERE album_id=$1 AND candidate_url=$2`,
        [target.albumId, url, url, coverPlan.sha256, inspection.width, inspection.height, inspection.effectiveWidth,
          inspection.sharpness, inspection.quality, inspection.fingerprint, inspection.reasons]);
      } else outcome.cover = "asignada";
    }
    if (labelPlan) {
      const locked = (await context.client.query<{ label_id: string | null }>("SELECT label_id::text FROM public.albums WHERE id=$1 FOR UPDATE", [target.albumId])).rows[0];
      let labelId: number | null = "create" in labelPlan ? null : labelPlan.id;
      if (!locked?.label_id && "create" in labelPlan) {
        // Otra pasada pudo crearlo entre la lectura y este run; un nombre parecido a otra ficha va a revisión sin tumbar la portada.
        labelId = (await organizationByName(labelPlan.create))?.id ?? null;
        if (labelId === null) {
          await context.client.query("SAVEPOINT sello_nuevo");
          try {
            labelId = (await createEntity(context, "organization", {
              name: labelPlan.create, organization_type: "record_label",
              notes: `Alta desde la miniatura del video ${target.videoId} del canal (lectura ${label?.confidence ?? "?"} %)`,
            })).id;
            await context.client.query("RELEASE SAVEPOINT sello_nuevo");
          } catch (error) {
            if (!(error instanceof OperatorError)) throw error;
            await context.client.query("ROLLBACK TO SAVEPOINT sello_nuevo");
            outcome.label = `«${labelPlan.create}»: no se crea (${error.message})`;
          }
        }
      }
      if (!locked?.label_id && labelId !== null) {
        await updateEntity(context, "album", target.albumId, { label_id: labelId });
        await syncCoreAlbumLabel(context, target.albumId, labelId);
      }
    }
  });
  outcome.runId = runId;
}
