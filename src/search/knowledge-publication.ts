import type { PoolClient } from "pg";
import { z } from "zod";
import { getPool } from "../db/client.js";
import { OperatorError, withOperatorRun } from "../merge/operator.js";
import { annotationSchema, assignmentBlockers, type KnowledgeAnnotation } from "./knowledge-contracts.js";
import { hashText } from "./review-protocol.js";
import { sanitizeSearchText } from "./privacy.js";

const note = z.string().trim().min(1).max(1500);
export const knowledgeDecisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), unitKey: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["approved", "rejected", "withdrawn"]), reason: note,
  criterion: z.object({ version: note, basis: z.enum(["attributed_description", "documented_fact", "authorized_listening"]), justification: note }).strict().nullable(),
  publicQuote: z.string().trim().min(1).max(500).nullable(),
}).strict();
export type KnowledgeDecision = z.infer<typeof knowledgeDecisionSchema> & {
  revision: number; actor: string; decidedAt: string; runId: number; annotationHash: string;
};
export const annotationDigest = (value: unknown) => hashText(JSON.stringify(annotationSchema.parse(value)));

/** No evidence/decision cache. Revocation, queue undo and changed identity are
 * consulted on every read; old semantic results cannot revive a withdrawn item. */
export const PUBLISHED_KNOWLEDGE_CANDIDATES = `SELECT u.id,u.job_id,u.unit_key,u.annotation,u.review_id,q.status,q.resolved_by,
  q.artist_a_id,q.album_id,q.track_id,q.payload->'knowledgeDecision' AS decision,
  r.params AS decision_run_params
  FROM ingest.search_knowledge_units u JOIN ingest.review_queue q ON q.id=u.review_id
  JOIN ingest.scrape_runs r ON r.id=CASE WHEN q.payload->'knowledgeDecision'->>'runId' ~ '^[0-9]+$'
    THEN (q.payload->'knowledgeDecision'->>'runId')::bigint END
  WHERE q.status='approved' AND q.resolved_by='human'
    AND q.payload->'knowledgeDecision'->>'status'='approved'`;

function publicCitationAllowed(a: KnowledgeAnnotation, quote: string): boolean {
  const source = new URL(a.observation.source);
  return ["https:", "http:"].includes(source.protocol) && !source.username && !source.password
    && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|172\.(1[6-9]|2\d|3[01])\.)/iu.test(source.hostname)
    && !/\.(local|internal)$/iu.test(source.hostname)
    && ![...source.searchParams.keys()].some(k => /token|secret|password|api.?key/iu.test(k))
    && a.observation.quote.includes(quote) && sanitizeSearchText(quote) === quote
    && (!a.assertion.listeningCondition || quote.includes(a.assertion.listeningCondition))
    && [a.assertion.aspect,a.assertion.value,a.object.name,...(a.comparison ? [a.comparison.reference.name] : [])].every(value => sanitizeSearchText(value) === value);
}
async function currentIdentity(client: Pick<PoolClient, "query">, a: KnowledgeAnnotation, row: Record<string, unknown>) {
  const targets = { artist: ["ingest.catalog_artists", "name", "artist_a_id"], album: ["ingest.catalog_albums", "title", "album_id"], track: ["ingest.catalog_tracks", "title", "track_id"] } as const;
  const target = targets[a.object.kind as keyof typeof targets];
  if (!target || Number(row[target[2]]) !== a.object.id) return false;
  const current = (await client.query(`SELECT ${target[1]} AS label FROM ${target[0]} WHERE id=$1`, [a.object.id])).rows[0];
  return current?.label === a.object.name;
}

async function liveSourceIdentity(client: Pick<PoolClient, "query">, a: KnowledgeAnnotation) {
  if (a.comparison?.reference.resolution === "resolved") {
    const reference = a.comparison.reference;
    const targets = {artist:["ingest.catalog_artists","name"],album:["ingest.catalog_albums","title"],track:["ingest.catalog_tracks","title"],genre:["ingest.genres","name"]} as const;
    const target = targets[reference.kind as keyof typeof targets];
    if (!target || (await client.query(`SELECT ${target[1]} AS label FROM ${target[0]} WHERE id=$1`,[reference.id])).rows[0]?.label !== reference.name) return false;
  }
  for (const evidence of a.object.identityEvidence) {
    const match = evidence.match(/ingest\.claims:(\d+)/u);
    if (match) {
      const claim = (await client.query("SELECT artist_id,album_id,track_id FROM ingest.claims WHERE id=$1 AND status='accepted'", [match[1]])).rows[0];
      if (!claim) return false;
      const parent = a.object.kind === "track" ? (await client.query("SELECT album_id FROM ingest.catalog_tracks WHERE id=$1", [a.object.id])).rows[0]?.album_id : null;
      if (!(a.object.kind === "artist" && Number(claim.artist_id) === a.object.id)
        && !(a.object.kind === "album" && Number(claim.album_id) === a.object.id)
        && !(a.object.kind === "track" && (Number(claim.track_id) === a.object.id || (parent && Number(claim.album_id) === Number(parent))))) return false;
    }
  }
  if (!["R11", "R12", "R13", "R14", "R15"].includes(a.observation.resourceId)) return true;
  const artist = a.object.kind === "artist" ? a.object.id : (await client.query(
    a.object.kind === "track" ? "SELECT al.artist_id AS id FROM ingest.catalog_tracks t JOIN ingest.catalog_albums al ON al.id=t.album_id WHERE t.id=$1" : "SELECT artist_id AS id FROM ingest.catalog_albums WHERE id=$1", [a.object.id])).rows[0]?.id;
  const verification = (await client.query("SELECT lastfm_url FROM ingest.lastfm_artist_verifications WHERE artist_id=$1", [artist])).rows[0];
  if (!verification) return false;
  const profile = (raw: string) => {
    try {
      const url = new URL(raw);
      if (!/^(?:www\.)?last\.fm$/iu.test(url.hostname)) return null;
      const slug = url.pathname.match(/^\/(?:[a-z]{2}\/)?music\/([^/]+)/iu)?.[1];
      return slug ? decodeURIComponent(slug.replace(/\+/gu," ")).toLowerCase() : null;
    } catch { return null; }
  };
  const sourceProfile = profile(a.observation.source);
  return sourceProfile !== null && sourceProfile === profile(verification.lastfm_url);
}

export async function decideKnowledge(reviewId: number, input: unknown, actor: string) {
  const decision = knowledgeDecisionSchema.parse(input);
  if (!actor.trim()) throw new OperatorError("invalid", "Operador obligatorio");
  return withOperatorRun({ name: "search:knowledge:decision", operator: actor, note: decision.reason, params: { reviewId } }, async ctx => {
    const row = (await ctx.client.query(`SELECT u.unit_key,u.annotation,q.* FROM ingest.search_knowledge_units u
      JOIN ingest.review_queue q ON q.id=u.review_id WHERE q.id=$1 FOR UPDATE OF q`, [reviewId])).rows[0];
    if (!row || row.payload?.type !== "search_knowledge") throw new OperatorError("not_found", "Afirmación de conocimiento inexistente");
    const previous = row.payload.knowledgeDecision as KnowledgeDecision | undefined;
    if ((previous?.revision ?? 0) !== decision.expectedRevision || row.unit_key !== decision.unitKey) throw new OperatorError("stale_preview", "La afirmación o su decisión cambió; volver a revisar");
    const a = annotationSchema.parse(row.annotation);
    if (decision.status === "approved") {
      const blockers = assignmentBlockers(a).filter(reason => reason !== "editorial_decision_required");
      if (blockers.length || !decision.criterion || !decision.publicQuote || !publicCitationAllowed(a, decision.publicQuote)
        || !await currentIdentity(ctx.client, a, row)) throw new OperatorError("needs_review", "Identidad, alcance, soporte, criterio o cita pública requieren revisión", { blockers });
      // A generic knowledge definition or tag weight cannot become activity evidence.
      if (a.proposal?.axis === "activity" && (decision.criterion.basis !== "authorized_listening" || a.assertion.coverage !== "complete")) throw new OperatorError("needs_review", "La actividad requiere revisión de escucha específica, además del testimonio");
      if (a.proposal?.axis === "energy") throw new OperatorError("needs_review", "La energía se aprueba mediante perceived-energy-v1 y las asignaciones de contextos existentes");
      if (decision.criterion.basis === "documented_fact" && ["R04","R05"].includes(a.observation.resourceId)) throw new OperatorError("needs_review", "Una reseña se publica como atribución; acreditar un hecho exige evidencia documental adecuada");
      if (a.assertion.type === "taste") throw new OperatorError("needs_review", "Una valoración no acredita un atributo musical");
      if (a.comparison?.aspect === "other") throw new OperatorError("needs_review", "Precisar el aspecto de la comparación antes de publicarla");
      if (!await liveSourceIdentity(ctx.client, a)) throw new OperatorError("needs_review", "El vínculo documental o la identidad de fuente ya no están vigentes");
    }
    const saved: KnowledgeDecision = { ...decision, revision: (previous?.revision ?? 0) + 1, actor, decidedAt: new Date().toISOString(), runId: ctx.runId, annotationHash: annotationDigest(a) };
    const payload = { ...row.payload, knowledgeDecision: saved, knowledgeHistory: [...(row.payload.knowledgeHistory ?? []), ...(previous ? [previous] : [])] };
    await ctx.client.query(`UPDATE ingest.review_queue SET payload=$2,status=$3,resolved_by='human',
      resolution_note=$4,resolved_at=now(),updated_at=now() WHERE id=$1`, [reviewId, payload, decision.status === "approved" ? "approved" : "dismissed", `${actor}: ${decision.reason}`]);
    await ctx.client.query(`UPDATE ingest.review_queue SET status='dismissed',resolved_by='human',resolved_at=now(),updated_at=now(),resolution_note=$2
      WHERE payload->>'type'='search_knowledge_model_conflict' AND payload->>'sourceReviewId'=$1 AND status IN ('open','in_progress')`,
    [String(reviewId), `${actor}: contradicción revisada mediante decisión ${saved.revision}. ${decision.reason}`]);
    return { reviewId, revision: saved.revision, status: saved.status };
  });
}

async function readablePublications(rows: Array<{[key:string]: unknown; annotation: unknown; decision: KnowledgeDecision; decision_run_params: {action?:string;operator?:string}; unit_key:string; id:string;job_id:string}>) {
  const db = getPool();
  const result = [];
  for (const row of rows) {
    const parsed = annotationSchema.safeParse(row.annotation);
    const decision = row.decision as KnowledgeDecision;
    if (!parsed.success || !knowledgeDecisionSchema.safeParse(decision ? Object.fromEntries(Object.entries(decision).filter(([key]) => ["expectedRevision", "unitKey", "status", "reason", "criterion", "publicQuote"].includes(key))) : null).success) continue;
    const a = parsed.data;
    const kind = a.object.kind; const id = a.object.id;
    if (decision.annotationHash !== annotationDigest(a) || decision.unitKey !== row.unit_key || !decision.criterion || !decision.publicQuote
      || row.decision_run_params?.action !== "search:knowledge:decision" || row.decision_run_params?.operator !== decision.actor
      || assignmentBlockers(a).some(reason => reason !== "editorial_decision_required") || !publicCitationAllowed(a, decision.publicQuote)
      || !await currentIdentity(db, a, row) || !await liveSourceIdentity(db, a)
      || a.proposal?.axis === "energy" || (a.proposal?.axis === "activity" && (decision.criterion.basis !== "authorized_listening" || a.assertion.coverage !== "complete"))
      || (decision.criterion.basis === "documented_fact" && ["R04","R05"].includes(a.observation.resourceId))
      || a.assertion.type === "taste" || a.comparison?.aspect === "other") continue;
    result.push({ jobId: Number(row.job_id), id: Number(row.id), object: { kind, id, name: a.object.name, version: a.object.version, segment: a.object.segment },
      assertion: { ...a.assertion }, proposal: a.proposal && { axis: a.proposal.axis, facet: a.proposal.facet, value: a.proposal.value },
      citation: { source: a.observation.source, quote: decision.publicQuote, capturedAt: a.observation.capturedAt, capturedAtOriginal: a.observation.capturedAtOriginal },
      comparison: a.comparison ? { reference: { kind: a.comparison.reference.kind, id: a.comparison.reference.id, name: a.comparison.reference.name }, aspect: a.comparison.aspect, direction: a.comparison.direction, polarity: a.comparison.polarity } : null,
      criterion: { version: decision.criterion.version, basis: decision.criterion.basis }, revision: decision.revision });
  }
  return result;
}
export async function publishedKnowledge(kind: "artist" | "album" | "track", id: number) {
  const db = getPool();
  if (!(await db.query("SELECT to_regclass('ingest.search_knowledge_units') AS t")).rows[0].t) return [];
  const rows = (await db.query(`${PUBLISHED_KNOWLEDGE_CANDIDATES}
    AND u.annotation->'object'->>'kind'=$1 AND u.annotation->'object'->>'id'=$2 ORDER BY u.id LIMIT 100`, [kind, String(id)])).rows;
  return (await readablePublications(rows)).map(({ jobId: _job, ...publication }) => publication);
}
export async function publishedKnowledgeJobCounts(jobIds: number[]) {
  if (!jobIds.length) return new Map<number, number>();
  const rows = (await getPool().query(`${PUBLISHED_KNOWLEDGE_CANDIDATES} AND u.job_id=ANY($1::bigint[]) ORDER BY u.id`, [jobIds])).rows;
  const counts = new Map<number, number>();
  for (const row of await readablePublications(rows)) counts.set(row.jobId, (counts.get(row.jobId) ?? 0) + 1);
  return counts;
}

export async function knowledgeReviewDetail(reviewId: number) {
  const row = (await getPool().query(`SELECT u.unit_key,u.annotation,q.payload->'knowledgeDecision' AS decision,q.id,q.status,q.artist_a_id,q.album_id,q.track_id
    FROM ingest.search_knowledge_units u JOIN ingest.review_queue q ON q.id=u.review_id WHERE q.id=$1`, [reviewId])).rows[0];
  if (!row) throw new OperatorError("not_found", "Afirmación de conocimiento inexistente");
  const a = annotationSchema.parse(row.annotation);
  const modelReady = Boolean((await getPool().query("SELECT to_regclass('ingest.search_knowledge_interpretations') AS t")).rows[0].t);
  const interpretations = modelReady ? (await getPool().query(`SELECT i.model,i.model_revision AS "modelRevision",i.question_version AS "questionVersion",i.decisions
    FROM ingest.search_knowledge_interpretations i JOIN ingest.search_knowledge_units u ON u.id=i.unit_id WHERE u.review_id=$1 ORDER BY i.id DESC LIMIT 10`, [reviewId])).rows : [];
  return { interpretations: interpretations as Array<{model:string;modelRevision:string;questionVersion:string;decisions:Record<string,{choice:string;probabilities:Record<string,number>}>}>, reviewId: Number(row.id), unitKey: row.unit_key as string, revision: Number(row.decision?.revision ?? 0), status: row.status as string,
    object: { kind: a.object.kind, id: a.object.id, name: a.object.name, version: a.object.version },
    assertion: a.assertion, observation: { source: publicCitationAllowed(a, a.observation.quote) ? a.observation.source : null, quote: sanitizeSearchText(a.observation.quote), locator: a.observation.locator },
    analysis: { interpretation: sanitizeSearchText(a.analysis.interpretation), alternative: sanitizeSearchText(a.analysis.alternative), uncertainty: sanitizeSearchText(a.analysis.uncertainty) },
    proposal: a.proposal, comparison: a.comparison && { aspect: a.comparison.aspect, direction: a.comparison.direction, referenceName: a.comparison.reference.name },
    blockers: [...assignmentBlockers(a).filter(reason => reason !== "editorial_decision_required" || !row.decision),
      ...(!await currentIdentity(getPool(), a, row) ? ["catalog_identity_changed"] : []),
      ...(!await liveSourceIdentity(getPool(), a) ? ["source_identity_withdrawn"] : []),
      ...(a.comparison?.aspect === "other" ? ["comparison_aspect_required"] : []),
      ...(a.proposal?.axis === "energy" ? ["existing_energy_controls_required"] : [])], decision: row.decision as KnowledgeDecision | null };
}

export type KnowledgeReviewDetail = Awaited<ReturnType<typeof knowledgeReviewDetail>>;
