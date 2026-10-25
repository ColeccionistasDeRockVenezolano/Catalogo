import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { OperatorError, withOperatorRun } from "../merge/operator.js";
import { relatedArtists, similarArtists } from "../api/repositories/artist-neighbors.js";
import { publicGenresFor } from "../genres/public.js";
import { resolveRedirect } from "../merge/redirects.js";
import { EFFECTIVE_ASSIGNMENTS, trackContextsReady, trackContexts } from "./track-contexts.js";
import { recommendationRequestSchema, RECOMMENDATION_VERSION, feedbackSchema, versionBatchSchema, type RecommendationIntent } from "./recommendation-contract.js";
import { interpretRecommendation, type Interpretation } from "./recommendation-interpreter.js";

export interface Candidate { id: number; artistId: number; versionGroup: string | null }
export function diversify<T extends Candidate>(rows: T[], limit: number, maxPerArtist: number): T[] {
  const selected: T[] = [], tracks = new Set<number>(), versions = new Set<string>(), counts = new Map<number,number>();
  // Multiple passes let every artist contribute before any artist repeats.
  for (let round=0; round<maxPerArtist && selected.length<limit; round++) {
    for (const row of rows) {
      if (selected.length === limit) break;
      if (tracks.has(row.id) || (row.versionGroup && versions.has(row.versionGroup)) || (counts.get(row.artistId) ?? 0)>round) continue;
      selected.push(row); tracks.add(row.id); if (row.versionGroup) versions.add(row.versionGroup);
      counts.set(row.artistId,(counts.get(row.artistId) ?? 0)+1);
    }
  }
  return selected;
}
export async function recommendationsReady(client: PoolClient | ReturnType<typeof getPool> = getPool()) {
  return await trackContextsReady(client) && Boolean((await client.query("SELECT to_regclass('ingest.recommendation_requests') AS t")).rows[0]?.t);
}
const VERSION_GROUPS = `SELECT v.track_id,min(v.group_key) AS group_key FROM ingest.recommendation_versions v
  JOIN ingest.claim_evidence e ON e.id=v.evidence_id JOIN ingest.claims c ON c.id=e.claim_id
  WHERE v.state='approved' AND c.track_id=v.track_id AND c.entity_kind='track' AND c.field='discovery_recording_identity'
    AND c.raw_value=to_jsonb(v.group_key) AND c.status NOT IN ('rejected','superseded','conflict')
    AND length(trim(e.url))>0 AND length(trim(e.excerpt))>0
    AND NOT EXISTS (SELECT 1 FROM ingest.recommendation_versions rival WHERE rival.track_id=v.track_id AND rival.state<>'approved')
  GROUP BY v.track_id HAVING count(DISTINCT v.group_key)=1`;
// Absence of a tag is unknown, not proof of a negative constraint.
const NEGATIVE_LABELS = `SELECT DISTINCT a.track_id,l.slug FROM ingest.track_context_assignments a
  JOIN ingest.track_context_labels l ON l.id=a.label_id JOIN ingest.claim_evidence e ON e.id=a.evidence_id JOIN ingest.claims c ON c.id=e.claim_id
  WHERE a.state='rejected' AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())
    AND c.track_id=a.track_id AND c.entity_kind='track' AND c.field='discovery_context:'||l.slug
    AND c.status NOT IN ('rejected','superseded','conflict') AND length(trim(e.url))>0 AND length(trim(e.excerpt))>0
    AND NOT EXISTS (SELECT 1 FROM ingest.track_context_assignments yes WHERE yes.track_id=a.track_id AND yes.label_id=a.label_id
      AND yes.state='approved' AND yes.valid_from<=now() AND (yes.valid_until IS NULL OR yes.valid_until>now()))`;
async function neighborScope(intent: RecommendationIntent) {
  if (!intent.seedArtistId) return null;
  const related = await relatedArtists(intent.seedArtistId);
  const genres = await publicGenresFor("artist",[intent.seedArtistId]);
  const {similar} = await similarArtists(intent.seedArtistId,genres.get(intent.seedArtistId)?.primaryGenre ?? null,related.map(x=>x.id));
  return new Map<number, Record<string,unknown>>([...related.map(x=>[x.id,{kind:"related",seedArtistId:intent.seedArtistId,rule:x.rule,sharedMemberNames:x.sharedMemberNames,relations:x.relations,bridges:x.bridges}] as const),
    ...similar.map(x=>[x.id,{kind:"similar",seedArtistId:intent.seedArtistId,rule:x.rule,evidence:x.evidence}] as const)]);
}
export async function recommend(input: unknown, actor: string, persist = false, interpreter = interpretRecommendation) {
  const request = recommendationRequestSchema.parse(input);
  const enabled = getEnv().CRV_RECOMMENDATIONS_ENABLED && await recommendationsReady();
  const interpretation: Interpretation = !enabled ? {intent:null,status:"unavailable",model:null,version:RECOMMENDATION_VERSION}
    : request.intent ? {intent:request.intent,status:"interpreted",model:null,version:RECOMMENDATION_VERSION} : await interpreter(request.text!);
  if (interpretation.intent?.seedArtistId) interpretation.intent = {...interpretation.intent,
    seedArtistId:(await resolveRedirect("artist",interpretation.intent.seedArtistId))?.id ?? interpretation.intent.seedArtistId};
  const neighbors = interpretation.intent ? await neighborScope(interpretation.intent) : null;
  const run = async (client: PoolClient) => {
    let intent = interpretation.intent;
    const feedbackExclusions: number[] = [];
    if (enabled && request.useFeedbackFrom.length) {
      const requests = (await client.query("SELECT id FROM ingest.recommendation_requests WHERE id=ANY($1::uuid[]) AND actor=$2",[request.useFeedbackFrom,actor])).rows;
      if (requests.length !== new Set(request.useFeedbackFrom).size) throw new OperatorError("invalid","Feedback solo de solicitudes propias existentes");
      feedbackExclusions.push(...(await client.query(`SELECT track_id::float8 AS id FROM ingest.recommendation_feedback
        WHERE request_id=ANY($1::uuid[]) AND reviewer=$2 AND track_id IS NOT NULL
        GROUP BY track_id HAVING bool_and(verdict='irrelevant')`,[request.useFeedbackFrom,actor])).rows.map(x=>x.id));
      if (intent) intent = {...intent,excludeTrackIds:[...new Set([...intent.excludeTrackIds,...feedbackExclusions])]};
    }
    if (intent) {
      const canonical=async(kind:"artist"|"album"|"track",ids:number[])=> {
        const resolved:number[]=[];
        for(const id of ids) resolved.push((await resolveRedirect(kind,id,client))?.id ?? id);
        return [...new Set(resolved)];
      };
      intent={...intent,artistIds:await canonical("artist",intent.artistIds),excludeArtistIds:await canonical("artist",intent.excludeArtistIds),
        albumIds:await canonical("album",intent.albumIds),excludeTrackIds:await canonical("track",intent.excludeTrackIds)};
    }
    const candidates = intent ? (await client.query<Candidate>(`WITH effective AS (${EFFECTIVE_ASSIGNMENTS}),
      positive AS (SELECT DISTINCT a.track_id,l.slug FROM effective a JOIN ingest.track_context_labels l ON l.id=a.label_id),
      negative AS (${NEGATIVE_LABELS}), versions AS (${VERSION_GROUPS})
      SELECT t.id::float8 AS id,al.artist_id::float8 AS "artistId",v.group_key AS "versionGroup"
      FROM ingest.catalog_tracks t JOIN ingest.catalog_albums al ON al.id=t.album_id JOIN ingest.catalog_artists ar ON ar.id=al.artist_id
        LEFT JOIN versions v ON v.track_id=t.id
      WHERE EXISTS (SELECT 1 FROM effective a WHERE a.track_id=t.id)
        AND lower(trim(ar.name)) NOT IN ('various artists','varios artistas')
        AND NOT EXISTS (SELECT 1 FROM unnest($1::text[]) label WHERE NOT EXISTS (SELECT 1 FROM positive p WHERE p.track_id=t.id AND p.slug=label))
        AND NOT EXISTS (SELECT 1 FROM unnest($2::text[]) label WHERE NOT EXISTS (SELECT 1 FROM negative n WHERE n.track_id=t.id AND n.slug=label))
        AND (cardinality($3::bigint[])=0 OR al.artist_id=ANY($3::bigint[])) AND NOT al.artist_id=ANY($4::bigint[])
        AND NOT t.id=ANY($5::bigint[])
        AND (v.group_key IS NULL OR NOT EXISTS (SELECT 1 FROM versions old WHERE old.group_key=v.group_key AND old.track_id=ANY($5::bigint[])))
        AND (cardinality($6::bigint[])=0 OR t.album_id=ANY($6::bigint[]))
        AND ($7::int IS NULL OR al.release_year>=$7) AND ($8::int IS NULL OR al.release_year<=$8)
        AND ($9::bigint[] IS NULL OR al.artist_id=ANY($9::bigint[]))
      ORDER BY t.id`,[intent.requiredLabels,intent.excludedLabels,intent.artistIds,intent.excludeArtistIds,intent.excludeTrackIds,
        intent.albumIds,intent.yearFrom,intent.yearUntil,neighbors ? [...neighbors.keys()] : null])).rows : [];
    const selected = diversify(candidates,request.limit,request.maxPerArtist);
    const results = [];
    for (const row of selected) {
      const details = await trackContexts(row.id,client);
      const excludedLabelEvidence = intent?.excludedLabels.length ? (await client.query(`WITH negative AS (${NEGATIVE_LABELS})
        SELECT a.id::float8 AS "assignmentId",l.slug,a.reason,a.reviewer,a.reviewed_at AS "reviewedAt",e.id::float8 AS "evidenceId",e.url,e.excerpt,c.source_id::float8 AS "sourceId"
        FROM ingest.track_context_assignments a JOIN ingest.track_context_labels l ON l.id=a.label_id
          JOIN ingest.claim_evidence e ON e.id=a.evidence_id JOIN ingest.claims c ON c.id=e.claim_id
        WHERE a.track_id=$1 AND a.state='rejected' AND l.slug=ANY($2::text[]) AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())
          AND EXISTS(SELECT 1 FROM negative n WHERE n.track_id=a.track_id AND n.slug=l.slug)
          AND c.track_id=a.track_id AND c.entity_kind='track' AND c.field='discovery_context:'||l.slug
          AND c.status NOT IN ('rejected','superseded','conflict') AND length(trim(e.url))>0 AND length(trim(e.excerpt))>0
        ORDER BY l.slug,a.id`,[row.id,intent.excludedLabels])).rows : [];
      results.push({ ...details.track, versionGroup: row.versionGroup, reasons: details.assignments,
        excludedLabelEvidence, genreReferences: details.genreReferences, relation: neighbors?.get(row.artistId) ?? null });
    }
    const status = !enabled ? "disabled" : interpretation.status !== "interpreted" ? "abstained"
      : !results.length ? "insufficient_coverage" : results.length < request.limit ? "partial" : "ok";
    const messages = { disabled:"Recomendación desactivada o migración pendiente.", abstained:"No pude representar la solicitud con suficiente certeza. Utiliza restricciones estructuradas o reformula por contexto, ánimo o energía.",
      insufficient_coverage:"No hay pistas verificadas que cumplan todas las restricciones.", partial:"La cobertura verificada no alcanza la cantidad solicitada con esta diversidad.", ok:"Selección basada en decisiones revisadas del catálogo." };
    const response = { requestId: persist && enabled ? randomUUID() : null, version:RECOMMENDATION_VERSION, status, message:messages[status],
      interpretation, effectiveIntent:intent, feedbackExclusions, requested:request.limit, maxPerArtist:request.maxPerArtist, candidateCount:candidates.length,
      results, diversity:results.length ? new Set(results.map(x=>x.artistId)).size/results.length : null,
      versionPolicy:"Solo equivalencias revisadas; títulos iguales no demuestran identidad.", measuredAt:new Date().toISOString() };
    if (response.requestId) await client.query("INSERT INTO ingest.recommendation_requests(id,actor,intent,interpretation,response) VALUES($1,$2,$3,$4,$5)",
      [response.requestId,actor,intent,interpretation,response]);
    return response;
  };
  if (persist && enabled) return (await withOperatorRun({name:"discovery:recommend",operator:actor,note:"Solicitud explícita de recomendación"},({client})=>run(client),{serializable:true})).result;
  const client = await getPool().connect();
  try { await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const result=await run(client); await client.query("COMMIT"); return result; }
  catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function recordRecommendationFeedback(input: unknown, reviewer: string) {
  const feedback = feedbackSchema.parse(input);
  if (!await recommendationsReady()) throw new OperatorError("invalid","Migración de recomendaciones pendiente");
  return (await withOperatorRun({name:"discovery:recommendation-feedback",operator:reviewer,note:feedback.reason},async ({client})=> {
    const stored = (await client.query("SELECT response FROM ingest.recommendation_requests WHERE id=$1 FOR SHARE",[feedback.requestId])).rows[0];
    if (!stored) throw new OperatorError("not_found","Solicitud inexistente");
    if (feedback.trackId !== null && !stored.response.results.some((r: {id:number})=>r.id===feedback.trackId)) throw new OperatorError("invalid","Pista no entregada en esta solicitud");
    const existing = (await client.query("SELECT * FROM ingest.recommendation_feedback WHERE request_id=$1 AND reviewer=$2 AND feedback_key=$3 FOR UPDATE",[feedback.requestId,reviewer,feedback.key])).rows[0];
    if (existing) {
      if (Number(existing.track_id ?? 0)!==(feedback.trackId ?? 0) || existing.verdict!==feedback.verdict || existing.reason!==feedback.reason) throw new OperatorError("invalid","Feedback inmutable: utilizar una clave nueva");
      return {id:Number(existing.id),inserted:false};
    }
    const row = (await client.query(`INSERT INTO ingest.recommendation_feedback(request_id,feedback_key,track_id,verdict,reviewer,reason)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[feedback.requestId,feedback.key,feedback.trackId,feedback.verdict,reviewer,feedback.reason])).rows[0];
    return {id:Number(row.id),inserted:true};
  },{serializable:true})).result;
}
export async function importRecommendationVersions(input: unknown, apply = false) {
  const batch = versionBatchSchema.parse(input);
  if (new Set(batch.versions.map(x=>x.key)).size !== batch.versions.length) throw new OperatorError("invalid","Clave repetida");
  const op=await withOperatorRun({name:"discovery:recommendation-versions",operator:batch.reviewer,note:batch.note},async ({client})=> {
    for (const row of batch.versions) {
      const valid = (await client.query(`SELECT t.id FROM ingest.catalog_tracks t JOIN ingest.claims c ON c.track_id=t.id JOIN ingest.claim_evidence e ON e.claim_id=c.id
        WHERE t.id=$1 AND t.title=$2 AND t.album_id=$3 AND e.id=$4 AND c.entity_kind='track' AND c.field='discovery_recording_identity'
          AND c.raw_value=to_jsonb($5::text) AND ($6::text<>'approved' OR (c.status NOT IN ('rejected','superseded','conflict') AND length(trim(e.url))>0 AND length(trim(e.excerpt))>0))
        FOR SHARE OF t,c,e`,[row.trackId,row.expectedTitle,row.expectedAlbumId,row.evidenceId,row.group,row.state])).rows[0];
      if (!valid) throw new OperatorError("invalid",`${row.key}: identidad o evidencia de equivalencia inválida`);
      const previous = (await client.query("SELECT * FROM ingest.recommendation_versions WHERE import_key=$1 FOR UPDATE",[row.key])).rows[0];
      if (previous && (Number(previous.track_id)!==row.trackId || previous.group_key!==row.group)) throw new OperatorError("invalid","Identidad de clave inmutable");
      await client.query(`INSERT INTO ingest.recommendation_versions(import_key,group_key,track_id,evidence_id,state,reviewer,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(import_key) DO UPDATE SET evidence_id=EXCLUDED.evidence_id,state=EXCLUDED.state,
        reviewer=EXCLUDED.reviewer,reason=EXCLUDED.reason,reviewed_at=now()
        WHERE (recommendation_versions.evidence_id,recommendation_versions.state,recommendation_versions.reviewer,recommendation_versions.reason)
          IS DISTINCT FROM (EXCLUDED.evidence_id,EXCLUDED.state,EXCLUDED.reviewer,EXCLUDED.reason)`,[row.key,row.group,row.trackId,row.evidenceId,row.state,batch.reviewer,row.reason]);
    }
    return {count:batch.versions.length};
  },{rollbackOnly:!apply,serializable:true});
  return {applied:apply,runId:apply ? op.runId : null,...op.result};
}
export async function recommendationFeedbackReport() {
  if (!await recommendationsReady()) return {enabled:false,requests:0,feedback:[]};
  return {enabled:true,requests:Number((await getPool().query("SELECT count(*) AS n FROM ingest.recommendation_requests")).rows[0].n),
    feedback:(await getPool().query(`SELECT request_id,track_id, count(*)::int AS reviews,
      CASE WHEN count(DISTINCT verdict)>1 THEN 'uncertain' ELSE min(verdict) END AS verdict
      FROM ingest.recommendation_feedback GROUP BY request_id,track_id ORDER BY request_id,track_id`)).rows};
}
