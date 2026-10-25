import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { getPool } from "../db/client.js";
import { ApiError, toApiError } from "../api/http-errors.js";
import type { ImageJob, ImageTask } from "../shared/image-curation-jobs.js";
import { moduleLogger } from "../logger/index.js";
import { decideImage } from "./image-decisions.js";
import { downloadImage, inspectImageCandidates, storeChosenImage } from "./image-inspection.js";
import { withOperatorRun, type OperatorContext } from "./operator.js";

const log = moduleLogger("image-curation-jobs");
const LOCK = "crv:image-curation-queue";
const columns = "id, request_id, task, entity_kind, entity_id, entity_name, job_type, operator, status, attempts, error, conflict, result, run_id, created_at, updated_at, lease_owner, prepared";
interface JobRow {
  id: string; request_id: string; task: ImageTask; entity_kind: "album" | "artist"; entity_id: string; entity_name: string;
  job_type: "decision" | "inspection"; operator: string; status: ImageJob["status"]; attempts: number;
  error: string | null; conflict: boolean; result: string | null; run_id: string | null;
  created_at: Date; updated_at: Date; lease_owner: string | null; prepared: { url: string; sha256: string } | null;
}
function present(row: JobRow): ImageJob {
  return { id: Number(row.id), requestId: row.request_id, type: row.job_type,
    groups: [{ kind: row.entity_kind, entityId: Number(row.entity_id), name: row.entity_name }],
    candidateId: row.task.type === "decision" ? row.task.candidateId : null, status: row.status,
    error: row.error, conflict: row.conflict, result: row.result, runId: row.run_id === null ? null : Number(row.run_id),
    attempts: row.attempts, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
async function locked<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK]);
    const result = await work(client);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function enqueueImageTasks(tasks: ImageTask[], operator: string): Promise<ImageJob[]> {
  return locked(async client => {
    const accepted: ImageJob[] = [];
    for (const task of tasks) {
      const existing = (await client.query<JobRow>(`SELECT ${columns} FROM ingest.image_curation_jobs WHERE request_id=$1`, [task.requestId])).rows[0];
      if (existing) {
        if (existing.operator !== operator || !isDeepStrictEqual(existing.task, task)) throw new ApiError(409, "request_reused", "La solicitud ya existe con otra decisión. Vuelve a revisar la ficha.");
        accepted.push(present(existing)); continue;
      }
      const active = await client.query("SELECT id FROM ingest.image_curation_jobs WHERE entity_kind=$1 AND entity_id=$2 AND job_type=$3 AND status IN ('queued','running')", [task.kind, task.entityId, task.type]);
      if (active.rowCount) throw new ApiError(409, "image_job_active", "Esta ficha ya tiene una operación de ese tipo en la cola del servidor. Actualiza la actividad para consultarla.");
      const table = task.kind === "album" ? "public.albums" : "public.artists";
      const name = task.kind === "album" ? "title" : "name";
      const entity = (await client.query<{ name: string }>(`SELECT ${name} AS name FROM ${table} WHERE id=$1`, [task.entityId])).rows[0];
      if (!entity) throw new ApiError(404, "not_found", "La ficha ya no existe.");
      const column = task.kind === "album" ? "album_id" : "artist_id";
      const candidates = (await client.query<{ id: string; quality: string | null }>(`SELECT id, quality FROM ingest.image_candidates WHERE entity_kind=$1 AND ${column}=$2 AND status='open'`, [task.kind, task.entityId])).rows;
      if (!candidates.length) throw new ApiError(409, "not_open", "Esta ficha ya no tiene candidatas pendientes.");
      if (task.type === "decision" && task.candidateId !== null) {
        const chosen = candidates.find(candidate => Number(candidate.id) === task.candidateId);
        if (!chosen) throw new ApiError(409, "not_open", "La imagen elegida ya no es candidata de esta ficha.");
        if (chosen.quality === "failed") throw new ApiError(422, "invalid_image", "La candidata no se pudo descargar. Vuelve a medir su calidad antes de elegirla.");
      }
      if (task.type === "inspection" && task.candidateIds.some(id => !candidates.some(candidate => Number(candidate.id) === id))) throw new ApiError(409, "not_open", "Las candidatas de la ficha cambiaron. Revisa la página antes de medirlas.");
      await client.query("UPDATE ingest.image_curation_jobs SET dismissed_at=now(),updated_at=now() WHERE entity_kind=$1 AND entity_id=$2 AND job_type=$3 AND status='error'", [task.kind, task.entityId, task.type]);
      const row = (await client.query<JobRow>(`INSERT INTO ingest.image_curation_jobs(request_id, task, entity_kind, entity_id, entity_name, job_type, operator) VALUES($1,$2::jsonb,$3,$4,$5,$6,$7) RETURNING ${columns}`,
        [task.requestId, JSON.stringify(task), task.kind, task.entityId, entity.name, task.type, operator])).rows[0]!;
      accepted.push(present(row));
    }
    return accepted;
  });
}
export async function listImageJobs(): Promise<ImageJob[]> {
  const { rows } = await getPool().query<JobRow>(`SELECT ${columns} FROM ingest.image_curation_jobs WHERE dismissed_at IS NULL AND status<>'done'
    UNION ALL (SELECT ${columns} FROM ingest.image_curation_jobs WHERE dismissed_at IS NULL AND status='done' ORDER BY id DESC LIMIT 50) ORDER BY id DESC`);
  return rows.map(present);
}
export async function retryImageJob(id: number): Promise<ImageJob> {
  return locked(async client => {
    const old = (await client.query<JobRow>(`SELECT ${columns} FROM ingest.image_curation_jobs WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!old) throw new ApiError(404, "not_found", "La tarea no existe.");
    if (old.status !== "error" || old.conflict) throw new ApiError(409, "review_required", "Revisa la ficha antes de enviar otra decisión.");
    const competing = await client.query("SELECT id FROM ingest.image_curation_jobs WHERE entity_kind=$1 AND entity_id=$2 AND job_type=$3 AND status IN ('queued','running')", [old.entity_kind, old.entity_id, old.job_type]);
    if (competing.rowCount) throw new ApiError(409, "image_job_active", "La ficha ya tiene una tarea pendiente.");
    const row = (await client.query<JobRow>(`UPDATE ingest.image_curation_jobs SET status='queued',error=NULL,error_code=NULL,conflict=false,dismissed_at=NULL,finished_at=NULL,updated_at=now() WHERE id=$1 RETURNING ${columns}`, [id])).rows[0]!;
    return present(row);
  });
}
export async function dismissImageJob(id: number): Promise<void> {
  const result = await getPool().query("UPDATE ingest.image_curation_jobs SET dismissed_at=now(),updated_at=now() WHERE id=$1 AND status='error' RETURNING id", [id]);
  if (!result.rowCount) throw new ApiError(409, "not_failed", "Solo se pueden retirar de la actividad las tareas fallidas.");
}
class ImageLeaseLost extends Error {}
export interface ImageWorkerOptions { mediaRoot?: string; download?: typeof downloadImage; pollMs?: number; leaseSeconds?: number }

/** Tres permisos globales en PostgreSQL; cada cambio y su resultado se confirman juntos. */
export class ImageCurationWorker {
  private stopped = true;
  private pumping = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly pending = new Set<Promise<void>>();
  private readonly leaseSeconds: number;
  constructor(private readonly options: ImageWorkerOptions = {}) { this.leaseSeconds = options.leaseSeconds ?? 120; }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.tick(); }, this.options.pollMs ?? 1000);
    this.timer.unref(); void this.tick();
  }
  async stop(): Promise<void> { this.stopped = true; clearInterval(this.timer); await Promise.allSettled([...this.pending]); }
  async tick(): Promise<void> {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      while (!this.stopped && this.pending.size < 3) {
        const row = await this.claim();
        if (!row) break;
        const work = this.process(row).catch(error => { log.error({ err: error, jobId: row.id }, "fallo del trabajador de imágenes"); }).finally(() => { this.pending.delete(work); if (!this.stopped) void this.tick(); });
        this.pending.add(work);
      }
    } catch (error) { log.error({ err: error }, "no se pudo consultar la cola de imágenes"); }
    finally { this.pumping = false; }
  }
  private async claim(): Promise<JobRow | undefined> {
    return locked(async client => {
      const active = (await client.query<{ count: string }>("SELECT count(*) FROM ingest.image_curation_jobs WHERE status='running' AND lease_expires_at>now()")).rows[0]!;
      if (Number(active.count) >= 3) return undefined;
      return (await client.query<JobRow>(`UPDATE ingest.image_curation_jobs SET status='running', lease_owner=$1,lease_expires_at=now()+($2*interval '1 second'),attempts=attempts+1,updated_at=now()
        WHERE id=(SELECT j.id FROM ingest.image_curation_jobs j
          WHERE (j.status='queued' OR (j.status='running' AND j.lease_expires_at<now()))
            AND NOT EXISTS (SELECT 1 FROM ingest.image_curation_jobs other WHERE other.id<>j.id AND other.entity_kind=j.entity_kind AND other.entity_id=j.entity_id AND other.status='running' AND other.lease_expires_at>now())
          ORDER BY CASE j.job_type WHEN 'decision' THEN 0 ELSE 1 END,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
        RETURNING ${columns}`, [randomUUID(), this.leaseSeconds])).rows[0];
    });
  }
  private async process(row: JobRow): Promise<void> {
    const heartbeat = setInterval(() => {
      void getPool().query("UPDATE ingest.image_curation_jobs SET lease_expires_at=now()+($3*interval '1 second') WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now()", [row.id, row.lease_owner, this.leaseSeconds]).catch(error => { log.error({ err: error, jobId: row.id }, "no se pudo renovar la tarea de imágenes"); });
    }, Math.max(250, this.leaseSeconds * 1000 / 4));
    heartbeat.unref();
    const complete = async (context: OperatorContext, result: string) => {
      const owned = await context.client.query(`UPDATE ingest.image_curation_jobs SET status='done',result=$3,run_id=$4,error=NULL,conflict=false,finished_at=now(),updated_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now() RETURNING id`, [row.id, row.lease_owner, result, context.runId]);
      if (!owned.rowCount) throw new ImageLeaseLost("La tarea cambió de trabajador; se revierte este intento.");
    };
    try {
      const task = row.task;
      if (task.type === "inspection") {
        await withOperatorRun({ name: "image_inspection", operator: row.operator, note: task.note ?? "Curaduría: inspección en segundo plano de imágenes candidatas", params: { imageJobId: Number(row.id) } }, async context => {
          // Una decisión anterior pudo cerrar estas candidatas mientras esperaban en cola.
          const open = (await context.client.query<{ id: string }>("SELECT id FROM ingest.image_candidates WHERE id=ANY($1::bigint[]) AND status='open'", [task.candidateIds])).rows.map(candidate => Number(candidate.id));
          const result = open.length ? await inspectImageCandidates(context, { ids: open, ...(this.options.download ? { download: this.options.download } : {}) }) : { inspected: 0, failed: 0, visual: 0 };
          await complete(context, `${result.inspected} imágenes medidas${result.failed ? `; ${result.failed} no se pudieron descargar` : ""}.`);
        });
      } else {
        let prepared = row.prepared;
        if (task.candidateId !== null && !prepared) {
          const candidate = (await getPool().query<{ candidate_url: string; fingerprint: string | null }>("SELECT candidate_url,fingerprint FROM ingest.image_candidates WHERE id=$1 AND status='open'", [task.candidateId])).rows[0];
          if (candidate) {
            const stored = await storeChosenImage(candidate.candidate_url, candidate.fingerprint, { mediaRoot: this.options.mediaRoot ?? path.resolve("web/public/media"), ...(this.options.download ? { download: this.options.download } : {}), publish: this.options.mediaRoot === undefined });
            if ("error" in stored) throw new ApiError(stored.changed ? 409 : 502, stored.changed ? "image_changed" : "image_unavailable", `${stored.error}. La ficha no cambió.`);
            prepared = stored;
            const saved = await getPool().query("UPDATE ingest.image_curation_jobs SET prepared=$3::jsonb WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now() RETURNING id", [row.id, row.lease_owner, JSON.stringify(prepared)]);
            if (!saved.rowCount) throw new ImageLeaseLost();
          }
        } else if (prepared) {
          const copy = await downloadImage(prepared.url, undefined, this.options.mediaRoot ?? path.resolve("web/public/media"));
          if (!("bytes" in copy) || createHash("sha256").update(copy.bytes).digest("hex") !== prepared.sha256) throw new ApiError(502, "stored_image_unavailable", "La copia guardada no está disponible. Revisa el almacén antes de reintentar.");
        }
        await decideImage({ kind: task.kind, id: task.entityId, candidateId: task.candidateId, operator: row.operator, ...(task.note ? { note: task.note } : {}) }, {
          ...(this.options.mediaRoot ? { mediaRoot: this.options.mediaRoot } : {}), ...(this.options.download ? { download: this.options.download } : {}), ...(prepared ? { prepared } : {}), publish: this.options.mediaRoot === undefined,
          complete: async context => complete(context, task.candidateId === null ? "Se conservó la imagen actual." : "Imagen guardada."),
        });
      }
    } catch (error) {
      if (!(error instanceof ImageLeaseLost)) {
        const expected = toApiError(error);
        if (!expected) log.error({ err: error, jobId: row.id }, "no se pudo procesar la imagen");
        await getPool().query(`UPDATE ingest.image_curation_jobs SET status='error',error=$3,error_code=$4,conflict=$5,finished_at=now(),updated_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2 AND status='running'`, [row.id, row.lease_owner, expected?.message.slice(0,1000) ?? "No se pudo procesar la imagen. Puedes volver a intentarlo.", expected?.code ?? "internal_error", expected ? expected.statusCode >= 400 && expected.statusCode < 500 : false]);
      }
    } finally { clearInterval(heartbeat); }
  }
}
