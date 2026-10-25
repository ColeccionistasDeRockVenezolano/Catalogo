import { publishedKnowledgeJobCounts } from "./knowledge-publication.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPool } from "../db/client.js";
import { annotationSchema, assignmentBlockers, KNOWLEDGE_VERSION, resourceId } from "./knowledge-contracts.js";
import { hashText } from "./review-protocol.js";
import { ApiError } from "../api/http-errors.js";

export const feedBatchSchema = z.object({
  resourceId, sourceObject: z.string().trim().min(1).max(1000),
  captureHash: z.string().regex(/^[a-f0-9]{64}$/), extractorVersion: z.string().trim().min(1).max(100),
  schemaVersion: z.literal(KNOWLEDGE_VERSION), annotations: z.array(annotationSchema).min(1).max(500),
}).strict().superRefine((b, ctx) => {
  const ids = new Set<string>();
  for (const a of b.annotations) {
    if (a.observation.resourceId !== b.resourceId || a.observation.captureHash !== b.captureHash || a.observation.extractorVersion !== b.extractorVersion) ctx.addIssue({ code: "custom", message: "Afirmación ajena al recurso, captura o extractor del lote" });
    if (ids.has(a.id)) ctx.addIssue({ code: "custom", message: "ID de afirmación repetido" }); ids.add(a.id);
  }
});
export function feedKey(b: z.infer<typeof feedBatchSchema>) {
  return hashText(JSON.stringify([b.resourceId, b.sourceObject, b.captureHash, b.extractorVersion, b.schemaVersion]));
}
export async function enqueueKnowledgeBatch(input: unknown) {
  const batch = feedBatchSchema.parse(input), key = feedKey(batch);
  const client = await getPool().connect();
  try {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout='5s'");
  await client.query("SET LOCAL lock_timeout='500ms'");
  const result = await client.query(`INSERT INTO ingest.search_knowledge_jobs
    (job_key,resource_id,source_object,capture_hash,extractor_version,schema_version,input)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(job_key) DO NOTHING RETURNING id`,
  [key, batch.resourceId, batch.sourceObject, batch.captureHash, batch.extractorVersion, batch.schemaVersion, batch]);
  if (result.rowCount) { await client.query("COMMIT"); return { id: Number(result.rows[0].id), created: true }; }
  const existing = (await client.query("SELECT id,input=$2::jsonb AS identical FROM ingest.search_knowledge_jobs WHERE job_key=$1", [key, batch])).rows[0];
  if (!existing?.identical) throw new ApiError(409, "capture_collision", "La misma captura y versiones tienen otro contenido; versionar la extracción");
  await client.query("COMMIT");
  return { id: Number(existing.id), created: false };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "knowledge_enqueue_failed", "El lote no se pudo encolar; conservar el corte y reintentar");
  } finally { client.release(); }
}

/** One leased, bounded chunk per invocation; no daemon/timer, GPU call or public
 * index write. Expired leases resume at the committed cursor. SQL timeouts protect
 * interactive requests; competing invocations share a global advisory lock. */
export async function runKnowledgeChunk(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Lote entre 1 y 50 unidades");
  const client = await getPool().connect(), token = randomUUID();
  let locked = false;
  let jobId: number | undefined;
  try {
    locked = Boolean((await client.query("SELECT pg_try_advisory_lock(hashtext('crv:knowledge-feed')) AS locked")).rows[0].locked);
    if (!locked) return { status: "busy" as const, processed: 0 };
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='500ms'");
    const job = (await client.query(`SELECT * FROM ingest.search_knowledge_jobs
      WHERE (state='pending' AND next_attempt_at<=now()) OR (state='running' AND lease_until<now())
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!job) { await client.query("COMMIT"); return { status: "idle" as const, processed: 0 }; }
    jobId = Number(job.id);
    await client.query(`UPDATE ingest.search_knowledge_jobs SET state='running',lease_token=$2,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$1`, [jobId, token]);
    await client.query("COMMIT");
    const batch = feedBatchSchema.parse(job.input), start = Number(job.cursor);
    const portion = batch.annotations.slice(start, start + limit);
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'"); await client.query("SET LOCAL lock_timeout='500ms'");
    const held = await client.query("SELECT id FROM ingest.search_knowledge_jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now() FOR UPDATE", [jobId, token]);
    if (!held.rowCount) throw new Error("lease_lost");
    const deadline = Date.now() + 10_000;
    let processed = 0;
    for (const a of portion) {
      if (processed && Date.now() >= deadline) break;
      processed++;
      const unitKey = hashText(JSON.stringify([batch.resourceId, batch.sourceObject, batch.captureHash, batch.extractorVersion, batch.schemaVersion, a.id]));
      if ((await client.query("SELECT id FROM ingest.search_knowledge_units WHERE unit_key=$1", [unitKey])).rowCount) continue;
      const reasons = assignmentBlockers(a);
      const object = a.object;
      let linkedId: number | null = null;
      const tables = { artist: "public.artists", album: "public.albums", track: "public.tracks", genre: "ingest.genres" } as const;
      const table = tables[object.kind as keyof typeof tables];
      if (object.resolution === "resolved") {
        if (table) {
          const row = (await client.query(`SELECT id FROM ${table} WHERE id=$1`, [object.id])).rows[0];
          if (row) linkedId = Number(row.id); else reasons.push("catalog_identity_missing");
        } else reasons.push("version_identity_requires_documented_relation");
      }
      const priorCase = (await client.query("SELECT id FROM ingest.review_queue WHERE payload->>'caseKey'=$1 ORDER BY id LIMIT 1", [`knowledge:${unitKey}`])).rows[0];
      const reviewId = priorCase?.id ?? (await client.query(`INSERT INTO ingest.review_queue
        (kind,priority,artist_a_id,album_id,track_id,payload,notes) VALUES('manual_review',5,$1,$2,$3,$4,$5) RETURNING id`,
      [object.kind === "artist" ? linkedId : null, object.kind === "album" ? linkedId : null, object.kind === "track" ? linkedId : null,
        { type: "search_knowledge", caseKey: `knowledge:${unitKey}`, annotationId: a.id, study: a.study, reasons,
          object, source: a.observation.source, aspect: a.assertion.aspect, observation: a.observation,
          analysis: a.analysis, proposal: a.proposal, comparison: a.comparison, dependencies: a.dependencies },
        "Conocimiento musical: revisar identidad, alcance, soporte y criterio. Resolver el caso no publica una asignación; usar los mecanismos editoriales existentes."])).rows[0].id;
      await client.query("INSERT INTO ingest.search_knowledge_units(job_id,unit_key,annotation,review_id) VALUES($1,$2,$3,$4)", [jobId, unitKey, a, reviewId]);
    }
    const cursor = start + processed, done = cursor === batch.annotations.length;
    await client.query(`UPDATE ingest.search_knowledge_jobs SET cursor=$2,state=$3,lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=now() WHERE id=$1 AND lease_token=$4`, [jobId, cursor, done ? "review" : "pending", token]);
    await client.query("COMMIT");
    return { status: done ? "review" as const : "pending" as const, id: jobId, processed, cursor };
  } catch {
    await client.query("ROLLBACK");
    if (jobId) await client.query(`UPDATE ingest.search_knowledge_jobs SET attempts=attempts+1,
      state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,
      next_attempt_at=now()+make_interval(secs=>least(3600,power(2,attempts+1)::int * 10)),
      error_code='chunk_failed',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2`, [jobId, token]);
    // SQL error details and private text never reach logs or administration.
    throw new ApiError(503, "knowledge_chunk_failed", "El lote se conserva para reintento; revisar el estado de alimentación");
  } finally {
    try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('crv:knowledge-feed'))"); }
    finally { client.release(); }
  }
}

export async function knowledgeFeedStatus() {
  const db = getPool();
  if (!(await db.query("SELECT to_regclass('ingest.search_knowledge_jobs') AS t")).rows[0].t) return { available: false, jobs: [], counts: [], cases: [] };
  const modelReady = Boolean((await db.query("SELECT to_regclass('ingest.search_knowledge_interpretations') AS t")).rows[0].t);
  const [jobs, counts, cases] = await Promise.all([
    db.query(`SELECT j.id,j.resource_id AS "resourceId",j.state,j.cursor,jsonb_array_length(j.input->'annotations') AS total,
      CASE WHEN previous.id IS NULL THEN 'new_source'
        WHEN previous.capture_hash<>j.capture_hash THEN 'changed_capture'
        ELSE 'reprocessed_capture' END AS "inputChange",
      j.attempts,
      (SELECT count(*)::int FROM ingest.search_knowledge_units u WHERE u.job_id=j.id) AS extracted,
      ${modelReady ? "(SELECT count(DISTINCT u.id)::int FROM ingest.search_knowledge_units u JOIN ingest.search_knowledge_interpretations i ON i.unit_id=u.id WHERE u.job_id=j.id)" : "0"} AS interpreted,
      (SELECT count(*)::int FROM ingest.search_knowledge_units u JOIN ingest.review_queue q ON q.id=u.review_id WHERE u.job_id=j.id AND q.status IN ('open','in_progress')) AS pending,
      (SELECT count(*)::int FROM ingest.search_knowledge_units u JOIN ingest.review_queue q ON q.id=u.review_id WHERE u.job_id=j.id AND q.payload->'knowledgeDecision'->>'status'='approved' AND q.status='approved') AS approved,
      (SELECT count(*)::int FROM ingest.search_knowledge_units u JOIN ingest.review_queue q ON q.id=u.review_id WHERE u.job_id=j.id AND q.payload->'knowledgeDecision'->>'status'='rejected') AS rejected,
      (SELECT count(*)::int FROM ingest.search_knowledge_units u JOIN ingest.review_queue q ON q.id=u.review_id WHERE u.job_id=j.id AND q.payload->'knowledgeDecision'->>'status'='withdrawn') AS withdrawn,
      j.error_code AS "errorCode",j.updated_at AS "updatedAt",j.next_attempt_at AS "nextAttemptAt"
      FROM ingest.search_knowledge_jobs j LEFT JOIN LATERAL (
        SELECT p.id,p.capture_hash FROM ingest.search_knowledge_jobs p
        WHERE p.resource_id=j.resource_id AND p.source_object=j.source_object AND p.id<j.id
        ORDER BY p.id DESC LIMIT 1
      ) previous ON true ORDER BY j.id DESC LIMIT 50`),
    db.query(`SELECT q.status,count(*)::int AS count FROM ingest.search_knowledge_units u JOIN ingest.review_queue q ON q.id=u.review_id GROUP BY q.status`),
    db.query(`SELECT q.id,q.status,u.review_id AS "sourceReviewId",u.annotation->>'id' AS "annotationId",u.annotation->'assertion'->>'aspect' AS aspect,
      q.payload->>'type' AS "caseType"
      FROM ingest.review_queue q JOIN ingest.search_knowledge_units u ON q.id=u.review_id OR
        (q.payload->>'type'='search_knowledge_model_conflict' AND q.payload->>'sourceReviewId'=u.review_id::text)
      WHERE q.status IN ('open','in_progress') ORDER BY q.priority,q.id LIMIT 50`),
  ]);
  const published = await publishedKnowledgeJobCounts(jobs.rows.map(j => Number(j.id)));
  return { available: true, jobs: jobs.rows.map(j => ({...j, published: published.get(Number(j.id)) ?? 0})) as Array<{id:number;resourceId:string;inputChange:"new_source"|"changed_capture"|"reprocessed_capture";state:string;cursor:number;total:number;attempts:number;extracted:number;interpreted:number;pending:number;approved:number;rejected:number;withdrawn:number;published:number;errorCode:string|null;updatedAt:string;nextAttemptAt:string}>,
    counts: counts.rows as Array<{status:string;count:number}>, cases: cases.rows as Array<{id:number;status:string;annotationId:string;aspect:string;sourceReviewId:number;caseType:string}> };
}

/** Explicit retry of a terminal failure; evidence/review decisions stay intact. */
export async function retryKnowledgeJob(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID de lote inválido");
  const r = await getPool().query(`UPDATE ingest.search_knowledge_jobs SET state='pending',attempts=0,
    next_attempt_at=now(),error_code=NULL,updated_at=now() WHERE id=$1 AND state='failed' RETURNING id`,[id]);
  if (!r.rowCount) throw new ApiError(409,"knowledge_job_not_failed","Solo se reintenta un lote fallido; los demás conservan su estado");
  return { id, status:"pending" as const };
}
