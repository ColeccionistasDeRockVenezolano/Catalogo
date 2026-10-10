// Investigación persistente de un par: una sola investigación se ve desde ambas
// fichas, incluso si el par no nació en la cola de revisiones.
import type { PersonComparison } from "../review/person-comparison.js";
import { getPool } from "../db/client.js";
import { investigateKnownPersonPair, type VerificationView } from "./person-web-verification.js";
import { withOperatorRun } from "../merge/operator.js";

export function orderedPair(aId: number, bId: number): [number, number] {
  if (!Number.isSafeInteger(aId) || !Number.isSafeInteger(bId) || aId <= 0 || bId <= 0 || aId === bId) {
    throw new Error("Selecciona dos fichas de persona distintas.");
  }
  return aId < bId ? [aId, bId] : [bId, aId];
}

interface VerificationRow {
  comparison: PersonComparison | null;
  id: string; review_id: string | null; person_id: string | null; dossier_hash: string; status: string;
  verdict: VerificationView["verdict"]; rationale: string; evidence: VerificationView["evidence"];
  sources: VerificationView["sources"]; created_at: string; reviewed_by: string | null; review_note: string | null;
}

function view(row: VerificationRow): VerificationView {
  return { comparison: row.comparison, id: Number(row.id), reviewId: row.review_id === null ? null : Number(row.review_id),
    personId: row.person_id === null ? null : Number(row.person_id), dossierHash: row.dossier_hash,
    status: row.status, verdict: row.verdict, rationale: row.rationale, evidence: row.evidence,
    sources: row.sources, createdAt: row.created_at, reviewedBy: row.reviewed_by, reviewNote: row.review_note };
}

/** Incluye la investigación hecha desde la cola, si es la más reciente del par. */
export async function getPersonPairResearch(aId: number, bId: number): Promise<VerificationView | null> {
  const [a, b] = orderedPair(aId, bId);
  const { rows } = await getPool().query<VerificationRow>(`
    SELECT v.id::text, v.review_id::text, v.person_id::text, v.dossier_hash, v.status,
           v.comparison, v.verdict, v.rationale, v.evidence, v.sources, v.created_at::text, v.reviewed_by, v.review_note
      FROM ingest.person_web_verifications v
      LEFT JOIN ingest.review_queue q ON q.id=v.review_id
     WHERE (v.person_a_id=$1 AND v.person_b_id=$2)
        OR (q.person_a_id=$1 AND q.person_b_id=$2)
        OR (q.person_a_id=$2 AND q.person_b_id=$1)
     ORDER BY v.created_at DESC, v.id DESC LIMIT 1`, [a, b]);
  return rows[0] ? view(rows[0]) : null;
}

export interface PersonPairResearchSummary {
  otherId: number; otherName: string; verificationId: number; verdict: VerificationView["verdict"];
  rationale: string; status: string; createdAt: string; declaredDistinct: boolean;
}

export async function isPairDeclaredDistinct(aId: number, bId: number): Promise<boolean> {
  const [a, b] = orderedPair(aId, bId);
  const { rows } = await getPool().query("SELECT 1 FROM ingest.curation_distinct_pairs WHERE kind='person' AND a_id=$1 AND b_id=$2", [a, b]);
  return rows.length > 0;
}

export async function listPersonPairResearch(personId: number): Promise<PersonPairResearchSummary[]> {
  const { rows } = await getPool().query<{ other_id: string; other_name: string; verification_id: string;
    verdict: VerificationView["verdict"]; rationale: string; status: string; created_at: string; declared_distinct: boolean }>(`
    WITH pairs AS (
      SELECT v.id, v.verdict, v.rationale, v.status, v.created_at,
             CASE WHEN v.person_a_id=$1 THEN v.person_b_id ELSE v.person_a_id END AS other_id
        FROM ingest.person_web_verifications v
       WHERE v.person_a_id=$1 OR v.person_b_id=$1
      UNION ALL
      SELECT v.id, v.verdict, v.rationale, v.status, v.created_at,
             CASE WHEN q.person_a_id=$1 THEN q.person_b_id ELSE q.person_a_id END AS other_id
        FROM ingest.person_web_verifications v
        JOIN ingest.review_queue q ON q.id=v.review_id
       WHERE q.person_a_id=$1 OR q.person_b_id=$1
    )
    SELECT DISTINCT ON (pairs.other_id) pairs.other_id::text, p.name AS other_name,
           pairs.id::text AS verification_id, pairs.verdict, pairs.rationale, pairs.status,
           pairs.created_at::text,
           (d.id IS NOT NULL) AS declared_distinct
      FROM pairs JOIN public.persons p ON p.id=pairs.other_id
      LEFT JOIN ingest.curation_distinct_pairs d ON d.kind='person'
        AND d.a_id=LEAST($1::bigint,pairs.other_id) AND d.b_id=GREATEST($1::bigint,pairs.other_id)
     ORDER BY pairs.other_id, pairs.created_at DESC, pairs.id DESC`, [personId]);
  return rows.map((row) => ({ otherId: Number(row.other_id), otherName: row.other_name,
    verificationId: Number(row.verification_id), verdict: row.verdict, rationale: row.rationale,
    status: row.status, createdAt: row.created_at, declaredDistinct: row.declared_distinct }));
}

export async function investigateAndSavePersonPair(aId: number, bId: number): Promise<VerificationView> {
  const [a, b] = orderedPair(aId, bId);
  const { dossierHash, validated, pages, aiRunId, comparison } = await investigateKnownPersonPair(a, b);
  const current = await getPersonPairResearch(a, b);
  if (current?.dossierHash === dossierHash) return current;
  const sources = pages.map(({ url, title, contentHash }) => ({ url, title, contentHash }));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE ingest.person_web_verifications SET status='superseded' WHERE person_a_id=$1 AND person_b_id=$2 AND status='proposed'", [a, b]);
    await client.query(`INSERT INTO ingest.person_web_verifications
      (person_a_id,person_b_id,dossier_hash,status,verdict,rationale,evidence,sources,ai_run_id,comparison)
      VALUES($1,$2,$3,'proposed',$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb)`,
    [a, b, dossierHash, validated.verdict, validated.rationale, JSON.stringify(validated.evidence), JSON.stringify(sources), aiRunId, JSON.stringify(comparison)]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  return (await getPersonPairResearch(a, b))!;
}

export interface ResearchJob { id: number; aId: number; bId: number; status: "queued" | "running" | "done" | "failed";
  error: string | null; verificationId: number | null; requestedAt: string; finishedAt: string | null; }

function job(row: { id: string; person_a_id: string; person_b_id: string; status: ResearchJob["status"];
  error: string | null; verification_id: string | null; requested_at: string; finished_at: string | null }): ResearchJob {
  return { id: Number(row.id), aId: Number(row.person_a_id), bId: Number(row.person_b_id), status: row.status,
    error: row.error, verificationId: row.verification_id === null ? null : Number(row.verification_id),
    requestedAt: row.requested_at, finishedAt: row.finished_at };
}

const JOB_COLUMNS = "id::text, person_a_id::text, person_b_id::text, status, error, verification_id::text, requested_at::text, finished_at::text";

export async function getResearchJob(id: number): Promise<ResearchJob | null> {
  const { rows } = await getPool().query(`SELECT ${JOB_COLUMNS} FROM ingest.person_identity_research_jobs WHERE id=$1`, [id]);
  return rows[0] ? job(rows[0]) : null;
}

export async function getActiveResearchJob(aId: number, bId: number): Promise<ResearchJob | null> {
  const [a, b] = orderedPair(aId, bId);
  const { rows } = await getPool().query(`SELECT ${JOB_COLUMNS} FROM ingest.person_identity_research_jobs
    WHERE person_a_id=$1 AND person_b_id=$2 AND status IN ('queued','running') LIMIT 1`, [a, b]);
  return rows[0] ? job(rows[0]) : null;
}

/** La cola queda utilizable tras reiniciar la API: las tareas interrumpidas se pueden repetir. */
export async function recoverResearchJobs(): Promise<void> {
  await getPool().query(`UPDATE ingest.person_identity_research_jobs
    SET status='failed', error='La API se reinició durante la investigación. Vuelve a intentarlo.', finished_at=now()
    WHERE status IN ('queued','running')`);
}

const running = new Set<number>();

export async function startPersonPairResearch(aId: number, bId: number,
  work: (aId: number, bId: number) => Promise<{ id: number }> = investigateAndSavePersonPair): Promise<ResearchJob> {
  const [a, b] = orderedPair(aId, bId);
  const current = await getPool().query(`SELECT ${JOB_COLUMNS} FROM ingest.person_identity_research_jobs
    WHERE person_a_id=$1 AND person_b_id=$2 AND status IN ('queued','running') LIMIT 1`, [a, b]);
  if (current.rows[0]) return job(current.rows[0]);
  let created;
  try {
    const result = await getPool().query(`INSERT INTO ingest.person_identity_research_jobs(person_a_id,person_b_id,status)
      VALUES($1,$2,'queued') RETURNING ${JOB_COLUMNS}`, [a, b]);
    created = job(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    const result = await getPool().query(`SELECT ${JOB_COLUMNS} FROM ingest.person_identity_research_jobs
      WHERE person_a_id=$1 AND person_b_id=$2 AND status IN ('queued','running') LIMIT 1`, [a, b]);
    if (!result.rows[0]) throw error;
    return job(result.rows[0]);
  }
  // La petición HTTP termina enseguida; el navegador consulta el estado.
  void runResearchJob(created.id, a, b, work);
  return created;
}

async function runResearchJob(id: number, a: number, b: number, work: (aId: number, bId: number) => Promise<{ id: number }>): Promise<void> {
  if (running.has(id)) return;
  running.add(id);
  try {
    await getPool().query("UPDATE ingest.person_identity_research_jobs SET status='running', started_at=now() WHERE id=$1", [id]);
    const result = await work(a, b);
    await getPool().query("UPDATE ingest.person_identity_research_jobs SET status='done', verification_id=$2, finished_at=now() WHERE id=$1", [id, result.id]);
  } catch (error) {
    await getPool().query("UPDATE ingest.person_identity_research_jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1",
      [id, error instanceof Error ? error.message.slice(0, 500) : "No se pudo investigar el par."])
      .catch(() => undefined); // Si la base cayó, el reinicio marcará este trabajo como interrumpido.
  } finally { running.delete(id); }
}

/** Decisión humana explícita, con run y nota; cierra además el candidato abierto. */
export async function declarePersonsDistinct(aId: number, bId: number, operator: string, note: string): Promise<{ runId: number; closedReviews: number }> {
  const [a, b] = orderedPair(aId, bId);
  const { runId, result } = await withOperatorRun({ name: "person:declare-distinct", operator, note,
    params: { personAId: a, personBId: b } }, async ({ client }) => {
    await client.query(`INSERT INTO ingest.curation_distinct_pairs(kind,a_id,b_id,decided_by,note)
      VALUES('person',$1,$2,$3,$4) ON CONFLICT(kind,a_id,b_id) DO UPDATE
      SET decided_by=EXCLUDED.decided_by,note=EXCLUDED.note`, [a, b, operator, note]);
    const closed = await client.query(`UPDATE ingest.review_queue SET status='dismissed',resolved_by='human',resolved_at=now()
      WHERE kind::text='person_duplicate' AND status IN ('open','in_progress')
        AND LEAST(person_a_id,person_b_id)=$1 AND GREATEST(person_a_id,person_b_id)=$2`, [a, b]);
    return { closedReviews: closed.rowCount ?? 0 };
  });
  return { runId, closedReviews: result.closedReviews };
}
