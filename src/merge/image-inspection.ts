// CRV · Plan 20/20, etapa 3: inspección de imágenes candidatas (0090).
//
// Descarga cada candidata pendiente por el cliente de URL públicas (DNS fijado,
// redirecciones validadas una a una), comprueba que el ráster sea legible y
// guarda calidad, uso y huella. Nunca cambia la imagen principal de una ficha:
// solo informa a Curaduría · Portadas y fotos, que no permite elegir una fallida.
import { publishCuratedImage } from "../storage/published-image.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { isDecorativeImageUrl } from "../ambiguity/page-images.js";
import { publicPageFetch } from "../verification/documents/public-url.js";
import { classifyImageUse, fingerprintDistance, inspectImage, type ImageInspection } from "../verification/image-quality.js";
import { mergeVisualReading, needsVisualReading, printedRelease, type VisionClassifier, type VisionResult } from "../verification/image-vision.js";
import { proposeImageCandidate } from "./image-candidates.js";
import type { OperatorContext } from "./operator.js";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 4;

const LOCAL_MEDIA = "/crv/media/";
/** Network failures worth another attempt; a missing domain or a malformed address will not heal. */
const TRANSIENT_NETWORK = /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|aborted/iu;

/** Original bytes of a public image (or of a local catalog copy under /crv/media/), or the reason it could not be obtained. */
export async function downloadImage(
  raw: string,
  fetcher: (url: string) => Promise<Response> = (url) => publicPageFetch(url),
  mediaRoot = path.resolve("web/public/media"),
): Promise<{ bytes: Buffer } | { error: string; transient?: boolean }> {
  if (raw.startsWith(LOCAL_MEDIA)) {
    const file = path.resolve(mediaRoot, decodeURIComponent(raw.slice(LOCAL_MEDIA.length).split(/[?#]/u)[0]!));
    if (!file.startsWith(mediaRoot + path.sep)) return { error: "Ruta local fuera de los medios del catálogo" };
    try {
      return { bytes: await readFile(file) };
    } catch (error) {
      return { error: (error as NodeJS.ErrnoException).code === "ENOENT" ? "La copia local no existe" : `Copia local ilegible: ${(error as Error).message}` };
    }
  }
  let url = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetcher(url);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return { error: `Redirección sin destino (HTTP ${response.status})` };
        url = new URL(location, url).toString();
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        return { error: `HTTP ${response.status}`, transient: response.status === 429 || response.status >= 500 };
      }
      if (/^(text|application\/(json|xhtml))/iu.test(response.headers.get("content-type") ?? "")) {
        await response.body?.cancel();
        return { error: "La dirección devuelve una página, no una imagen" };
      }
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) { await response.body?.cancel(); return { error: "La imagen supera el tamaño máximo de descarga" }; }
      const reader = response.body?.getReader();
      if (!reader) return { error: "Respuesta sin contenido" };
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BYTES) { await reader.cancel(); return { error: "La imagen supera el tamaño máximo de descarga" }; }
        chunks.push(value);
      }
      return { bytes: Buffer.concat(chunks) };
    }
    return { error: "Demasiadas redirecciones" };
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${(error as { cause?: { code?: string } }).cause?.code ?? ""}`.trim() : String(error);
    return { error: `Descarga fallida: ${message}`, transient: TRANSIENT_NETWORK.test(message) };
  }
}

interface CandidateRow { id: string; entity_kind: "album" | "artist"; artist_id: string | null; candidate_url: string; source: string; page_url: string | null; origin: string; width: number | null; height: number | null; image_context: string | null; expected: string[]; other_titles: string[] }
const CANDIDATE_SQL = `
  SELECT c.id::text, c.entity_kind, c.artist_id::text, c.candidate_url, c.source, c.page_url, c.origin, c.width, c.height, c.image_context,
         array_remove(ARRAY[al.title, COALESCE(alar.name, ar.name)], NULL) AS expected,
         ARRAY(SELECT o.title FROM public.albums o WHERE o.artist_id = COALESCE(al.artist_id, c.artist_id) AND o.id IS DISTINCT FROM al.id) AS other_titles
    FROM ingest.image_candidates c
    LEFT JOIN public.albums al ON al.id = c.album_id
    LEFT JOIN public.artists alar ON alar.id = al.artist_id
    LEFT JOIN public.artists ar ON ar.id = c.artist_id`;


/** Inspects open candidates not yet inspected (or the given ids) and records the result in the operator's run. */
export async function inspectImageCandidates(
  context: OperatorContext,
  options: { ids?: number[]; limit?: number; download?: typeof downloadImage; vision?: VisionClassifier } = {},
): Promise<{ inspected: number; failed: number; visual: number }> {
  const { rows } = await context.client.query<CandidateRow>(options.ids?.length
    ? `${CANDIDATE_SQL} WHERE c.id = ANY($1::bigint[]) ORDER BY c.id`
    : `${CANDIDATE_SQL} WHERE c.status = 'open' AND c.inspected_at IS NULL ORDER BY c.id LIMIT $1`,
  [options.ids?.length ? options.ids : options.limit ?? 50]);
  let failed = 0, visual = 0;
  for (const row of rows) {
    const download = await (options.download ?? downloadImage)(row.candidate_url);
    const inspection: ImageInspection = "error" in download
      ? { ok: false, error: download.error, format: null, bytes: 0, width: null, height: null, effectiveWidth: null, upscaled: false, sharpness: null, fingerprint: null, quality: "failed", reasons: [download.error] }
      : await inspectImage(download.bytes);
    if (!inspection.ok) failed++;
    // Rate limits, server errors and timeouts stay unselectable but return to the queue for another attempt.
    const retry = "error" in download && download.transient === true;
    let { use, reasons } = classifyImageUse({
      url: row.candidate_url,
      context: `${row.image_context ?? ""} ${row.source} ${row.origin} ${row.page_url ?? ""}`,
      target: row.entity_kind,
      width: inspection.width ?? row.width,
      height: inspection.height ?? row.height,
      decorative: isDecorativeImageUrl(row.candidate_url),
    });
    // The visual reading decides the use only without documented context, but always checks the printed text.
    let seen: VisionResult | null = null;
    if (options.vision && "bytes" in download && inspection.ok && needsVisualReading(use, reasons)) {
      try {
        seen = await options.vision({ bytes: download.bytes, sourceUrl: row.candidate_url, target: row.entity_kind, expected: row.expected, otherTitles: row.other_titles, context: row.image_context });
        visual++;
        ({ use, reasons } = mergeVisualReading({ use, reasons }, seen, row.entity_kind, row.expected));
      } catch (error) {
        reasons = [...reasons, `Lectura visual no disponible: ${error instanceof Error ? error.message : String(error)}`];
      }
    }
    // A cover among the artist's photos that prints one of their releases is proposed for that record.
    if (row.entity_kind === "artist" && row.artist_id && use === "cover" && seen) {
      const releases = (await context.client.query<{ id: number; title: string; cover_url: string | null }>(
        "SELECT id::int, title, cover_url FROM public.albums WHERE artist_id = $1", [row.artist_id])).rows;
      const release = printedRelease(seen.visibleText, releases, row.expected[0] ?? "");
      if (release) {
        const proposed = await proposeImageCandidate(context.client, { kind: "album", targetId: release.id, currentUrl: release.cover_url, candidateUrl: row.candidate_url,
          source: row.source, pageUrl: row.page_url, origin: "portada entre las fotos del artista", runId: context.runId,
          context: `Portada de «${release.title}» hallada entre las fotos del artista (candidata ${row.id})` });
        reasons = [...reasons, `Es la portada de «${release.title}»: ${proposed === "proposed" ? "se propone para ese disco" : proposed === "already" ? "ya es candidata de ese disco" : "ese disco ya la usa"}`];
      }
    }
    // A failed download has no shape to judge; its own error is the whole explanation.
    await updateInspection(context.client, Number(row.id), inspection, inspection.ok ? use : "unknown", inspection.ok ? [...inspection.reasons, ...reasons] : inspection.reasons, retry);
  }
  return { inspected: rows.length, failed, visual };
}

async function updateInspection(client: PoolClient, id: number, inspection: ImageInspection, use: string, reasons: string[], retry: boolean): Promise<void> {
  await client.query(`
    UPDATE ingest.image_candidates
       SET natural_width = $2, natural_height = $3, effective_width = $4, sharpness = $5, quality = $6,
           image_use = $7, fingerprint = $8, inspection_reasons = $9, inspected_at = CASE WHEN $10 THEN NULL ELSE now() END
     WHERE id = $1`,
  [id, inspection.width, inspection.height, inspection.effectiveWidth, inspection.sharpness, inspection.quality, use, inspection.fingerprint, reasons, retry]);
}

const STORED_EXTENSIONS: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif", heif: "avif" };
/** Same picture as inspected: recompression by a CDN moves a few bits, another image moves dozens. */
const SAME_PICTURE = 6;

/**
 * Stable copy of a chosen candidate: downloads it again, checks it is still the picture that
 * was inspected and keeps the original bytes under media/curated, addressed by content.
 */
export async function storeChosenImage(
  url: string,
  expectedFingerprint: string | null,
  options: { mediaRoot: string; download?: typeof downloadImage; publish?: boolean },
): Promise<{ url: string; sha256: string } | { error: string; changed?: boolean }> {
  const download = await (options.download ?? downloadImage)(url);
  if ("error" in download) return { error: download.error };
  const inspection = await inspectImage(download.bytes);
  if (!inspection.ok) return { error: inspection.error ?? "Imagen ilegible" };
  const extension = STORED_EXTENSIONS[inspection.format ?? ""];
  if (!extension) return { error: `Formato de imagen no admitido para guardar (${inspection.format ?? "desconocido"})` };
  if (expectedFingerprint && inspection.fingerprint && fingerprintDistance(expectedFingerprint, inspection.fingerprint) > SAME_PICTURE)
    return { error: "La imagen de esa dirección cambió desde que se midió", changed: true };
  const sha256 = createHash("sha256").update(download.bytes).digest("hex");
  if (options.publish) return { url: await publishCuratedImage(download.bytes, `${sha256}.${extension}`), sha256 };
  const directory = path.join(options.mediaRoot, "curated");
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, download.bytes, { flag: "wx", mode: 0o644 });
    await rename(temporary, path.join(directory, `${sha256}.${extension}`));
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
  return { url: `/crv/media/curated/${sha256}.${extension}`, sha256 };
}
