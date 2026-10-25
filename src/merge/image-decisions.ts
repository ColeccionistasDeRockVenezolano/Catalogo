// Decisiones de imagen compartidas por la API síncrona y el trabajador persistente.
import path from "node:path";
import { getPool } from "../db/client.js";
import { OperatorError, updateEntity, withOperatorRun, type OperatorContext } from "./operator.js";
import { storeChosenImage, type downloadImage } from "./image-inspection.js";
import { ApiError } from "../api/http-errors.js";
export type ImageKind = "album" | "artist";
const FIELD = { album: "cover_url", artist: "picture_url" } as const;
const ID_COLUMN = { album: "album_id", artist: "artist_id" } as const;
export interface ImageDecisionOptions {
  mediaRoot?: string;
  download?: typeof downloadImage;
  publish?: boolean;
  prepared?: { url: string; sha256: string };
  complete?: (context: OperatorContext, result: { chosenUrl: string | null }) => Promise<void>;
}
export async function decideImage(input: { kind: ImageKind; id: number; candidateId: number | null; operator: string; note?: string }, options: ImageDecisionOptions = {}) {
  const { kind, id, candidateId } = input;
  const label = kind === "album" ? "portada" : "foto de artista";
  const note = input.note ?? (candidateId === null
    ? `Curaduría: se deja la ${label} actual y se descartan las candidatas`
    : `Curaduría: ${label} elegida a ojo entre las candidatas`);
  // The stable copy is downloaded before the run opens: no network inside the transaction.
  let stored: { url: string; sha256: string } | null = options.prepared ?? null;
  if (candidateId !== null && !stored) {
    const candidate = (await getPool().query<{ candidate_url: string; fingerprint: string | null }>(`
      SELECT candidate_url, fingerprint FROM ingest.image_candidates
       WHERE id = $1 AND entity_kind = $2 AND ${ID_COLUMN[kind]} = $3 AND status = 'open' AND quality IS DISTINCT FROM 'failed'`, [candidateId, kind, id])).rows[0];
    if (candidate) {
      const copy = await storeChosenImage(candidate.candidate_url, candidate.fingerprint, { ...(options.publish ? { publish: true } : {}), mediaRoot: options.mediaRoot ?? path.resolve("web/public/media"), ...(options.download ? { download: options.download } : {}) });
      if ("error" in copy) {
        throw copy.changed
          ? new ApiError(409, "image_changed", `${copy.error}. Vuelve a medir su calidad antes de elegirla.`)
          : new ApiError(502, "image_unavailable", `No se pudo guardar una copia estable de la imagen: ${copy.error}. La ficha no cambió.`);
      }
      stored = copy;
    }
  }
  const { runId, result } = await withOperatorRun({
    name: "image_choice", operator: input.operator, note, params: { kind, id, candidateId, storedUrl: stored?.url ?? null },
  }, async (context) => {
    const column = ID_COLUMN[kind];
    const open = await context.client.query<{ id: string; candidate_url: string; current_url: string | null; quality: string | null }>(`
      SELECT id::text, candidate_url, current_url, quality FROM ingest.image_candidates
       WHERE entity_kind = $1 AND ${column} = $2 AND status = 'open' FOR UPDATE`, [kind, id]);
    if (open.rows.length === 0) throw new OperatorError("not_open", "Esta ficha ya no tiene imágenes candidatas pendientes.", { kind, id });
    let chosenUrl: string | null = null;
    if (candidateId !== null) {
      const chosen = open.rows.find((row) => Number(row.id) === candidateId);
      if (!chosen) throw new OperatorError("not_found", "La imagen elegida no es una candidata pendiente de esta ficha.", { kind, id, candidateId });
      if (chosen.quality === "failed") throw new OperatorError("invalid", "Esa imagen no se pudo descargar o está dañada; no puede quedar como imagen de la ficha.", { kind, id, candidateId });
      const table = kind === "album" ? "public.albums" : "public.artists";
      const live = await context.client.query<{ url: string | null }>(`SELECT ${FIELD[kind]} AS url FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!live.rows[0]) throw new OperatorError("not_found", "La ficha ya no existe.", { kind, id });
      if (live.rows[0].url !== chosen.current_url) {
        throw new OperatorError("stale_preview", `La ${label} de esta ficha cambió desde que se propusieron las candidatas; revísala en su ficha.`, { kind, id });
      }
      if (!stored) throw new OperatorError("stale_preview", "La candidata cambió mientras se guardaba su copia; vuelve a intentarlo.", { kind, id, candidateId });
      await updateEntity(context, kind, id, { [FIELD[kind]]: stored.url });
      await context.client.query("UPDATE ingest.image_candidates SET stored_url = $2, stored_sha256 = $3 WHERE id = $1", [candidateId, stored.url, stored.sha256]);
      chosenUrl = stored.url;
    }
    await context.client.query(`
      UPDATE ingest.image_candidates
         SET status = CASE WHEN id = $3 THEN 'chosen' ELSE 'rejected' END,
             decided_by = $4, decided_at = now(), decision_run_id = $5
       WHERE entity_kind = $1 AND ${column} = $2 AND status = 'open'`,
    [kind, id, candidateId ?? 0, context.operator, context.runId]);
    await options.complete?.(context, { chosenUrl });
    return { chosenUrl };
  });
  return { runId, kind, entityId: id, chosenUrl: result.chosenUrl };
}
