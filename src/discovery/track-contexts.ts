import type { PoolClient } from "pg";
import { getPool } from "../db/client.js";
import { OperatorError } from "../merge/operator.js";

// Shared by serving, evaluation and coverage. Proposals never enter this query.
export const EFFECTIVE_ASSIGNMENTS = `SELECT a.* FROM ingest.track_context_assignments a
  JOIN ingest.catalog_tracks t ON t.id=a.track_id JOIN ingest.track_context_labels l ON l.id=a.label_id
  JOIN ingest.claim_evidence e ON e.id=a.evidence_id JOIN ingest.claims c ON c.id=e.claim_id
  WHERE a.state='approved' AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())
    AND c.track_id=t.id AND c.entity_kind='track' AND c.field='discovery_context:'||l.slug
    AND c.status NOT IN ('rejected','superseded','conflict') AND length(trim(e.excerpt))>0 AND length(trim(e.url))>0
    AND ((l.kind IN ('context','mood') AND a.method_version='context-editorial-v1' AND a.method_data='{}'::jsonb) OR
      (l.kind='energy' AND a.method_version='perceived-energy-v1' AND ingest.track_context_energy_label(a.method_data)=l.slug))
    AND NOT EXISTS (SELECT 1 FROM ingest.track_context_assignments rival
      WHERE rival.track_id=a.track_id AND rival.label_id=a.label_id AND rival.state IN ('rejected','withdrawn')
        AND rival.valid_from<=now() AND (rival.valid_until IS NULL OR rival.valid_until>now()))
    AND NOT EXISTS (SELECT 1 FROM ingest.track_context_assignments rival
      JOIN ingest.track_context_labels other ON other.id=rival.label_id
      WHERE l.kind='energy' AND other.kind='energy' AND rival.track_id=a.track_id AND rival.label_id<>a.label_id
        AND rival.state='approved' AND rival.valid_from<=now() AND (rival.valid_until IS NULL OR rival.valid_until>now()))`;
export async function trackContextsReady(client: PoolClient | ReturnType<typeof getPool> = getPool()) {
  return Boolean((await client.query("SELECT to_regclass('ingest.track_context_assignments') AS t")).rows[0]?.t);
}
export async function trackContexts(trackId: number, client: PoolClient | ReturnType<typeof getPool> = getPool()) {
  const track = (await client.query(`SELECT t.id::float8 AS id,t.title,t.album_id::float8 AS "albumId",t.disc_number AS "discNumber",
    t.track_number AS "trackNumber",al.title AS "albumTitle",al.artist_id::float8 AS "artistId",ar.name AS "artistName"
    FROM ingest.catalog_tracks t JOIN ingest.catalog_albums al ON al.id=t.album_id JOIN ingest.catalog_artists ar ON ar.id=al.artist_id WHERE t.id=$1`,[trackId])).rows[0];
  if (!track) throw new OperatorError("not_found", `Pista ${trackId} inexistente`);
  // A confirmed parent genre remains a fact at the parent level, not at track level.
  const genres = (await client.query(`SELECT g.id::float8 AS id,g.name,ag.confidence,'album' AS "originalLevel",ag.album_id::float8 AS "entityId",
      'confirmed' AS status,false AS "verifiedForTrack",ag.source_kind AS "sourceKind",ag.decision_rule AS "decisionRule"
      FROM ingest.album_genres ag JOIN ingest.genres g ON g.id=ag.genre_id
      WHERE ag.album_id=$1 AND ag.status='confirmed'
    UNION ALL SELECT g.id::float8,g.name,ag.confidence,'artist',ag.artist_id::float8,'confirmed',false,ag.source_kind,ag.decision_rule
      FROM ingest.artist_genres ag JOIN ingest.genres g ON g.id=ag.genre_id WHERE ag.artist_id=$2 AND ag.status='confirmed'
    ORDER BY "originalLevel",id`,[track.albumId,track.artistId])).rows;
  const enabled = await trackContextsReady(client);
  if (!enabled) return { enabled, track, assignments: [], genreReferences: genres };
  const assignments = (await client.query(`WITH effective AS (${EFFECTIVE_ASSIGNMENTS})
    SELECT a.id::float8 AS id,l.slug,l.kind,l.name,l.definition,l.criterion,l.ontology_version AS "ontologyVersion",
      a.confidence,a.reviewer,a.reason,a.reviewed_at AS "reviewedAt",a.valid_from AS "validFrom",a.valid_until AS "validUntil",
      a.method_version AS "methodVersion",a.method_data AS "methodData",a.evidence_id::float8 AS "evidenceId",
      e.url,e.excerpt,e.captured_at AS "capturedAt",c.id::float8 AS "claimId",c.source_id::float8 AS "sourceId",
      p.origin AS "proposalOrigin",p.model_name AS "modelName",p.model_version AS "modelVersion",p.generated_at AS "generatedAt"
    FROM effective a JOIN ingest.track_context_labels l ON l.id=a.label_id
      JOIN ingest.claim_evidence e ON e.id=a.evidence_id JOIN ingest.claims c ON c.id=e.claim_id
      LEFT JOIN ingest.track_context_proposals p ON p.id=a.proposal_id
    WHERE a.track_id=$1 ORDER BY l.kind,l.slug,a.id`,[trackId])).rows;
  return { enabled, track, assignments, genreReferences: genres };
}

export async function contextReview(trackId: number) {
  const current = await trackContexts(trackId);
  if (!current.enabled) return { ...current, proposals: [], decisions: [], evaluations: [] };
  const client = getPool();
  const proposals = (await client.query("SELECT p.*,l.slug FROM ingest.track_context_proposals p JOIN ingest.track_context_labels l ON l.id=p.label_id WHERE track_id=$1 ORDER BY p.id",[trackId])).rows;
  const decisions = (await client.query("SELECT a.*,l.slug FROM ingest.track_context_assignments a JOIN ingest.track_context_labels l ON l.id=a.label_id WHERE track_id=$1 ORDER BY a.id",[trackId])).rows;
  const evaluations = (await client.query(`SELECT e.*, e.assignment_snapshot=to_jsonb(a) AS current FROM ingest.track_context_evaluations e
    JOIN ingest.track_context_assignments a ON a.id=e.assignment_id WHERE a.track_id=$1 ORDER BY e.id`,[trackId])).rows;
  return { ...current, proposals, decisions, evaluations };
}
export async function contextOntology() {
  if (!await trackContextsReady()) return { enabled: false, labels: [] };
  return { enabled: true, labels: (await getPool().query("SELECT * FROM ingest.track_context_labels ORDER BY kind,slug")).rows };
}
export interface ContextCoverageOptions { limit: number; offset: number; albumId?: number | undefined }
export async function contextCoverage(options: ContextCoverageOptions) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await measureCoverage(client, options);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
async function measureCoverage(client: PoolClient, { limit, offset, albumId }: ContextCoverageOptions) {
  if (!await trackContextsReady(client)) return { enabled: false, unit: "track-edition", summary: null, tracks: [], labels: [] };
  const cte = `WITH eligible AS (${EFFECTIVE_ASSIGNMENTS}), scoped AS (SELECT * FROM ingest.catalog_tracks WHERE ($1::bigint IS NULL OR album_id=$1)),
    usable AS (SELECT a.* FROM eligible a JOIN scoped t ON t.id=a.track_id),
    assessments AS (SELECT e.*,a.track_id,a.label_id FROM ingest.track_context_evaluations e JOIN usable a ON a.id=e.assignment_id
      WHERE e.assignment_snapshot=to_jsonb(a)),
    judged AS (SELECT assignment_id,track_id,label_id,
      CASE WHEN count(DISTINCT verdict)>1 THEN 'uncertain' ELSE min(verdict) END AS verdict FROM assessments GROUP BY assignment_id,track_id,label_id)`;
  const summary = (await client.query(`${cte} SELECT
    (SELECT count(*)::int FROM scoped) AS "totalTracks",
    (SELECT count(DISTINCT track_id)::int FROM usable) AS "coveredTracks",
    (SELECT count(*)::int FROM usable) AS "approvedAssignments",
    (SELECT count(*)::int FROM judged) AS "evaluatedAssignments",
    (SELECT count(*)::int FROM judged WHERE verdict='relevant') AS relevant,
    (SELECT count(*)::int FROM judged WHERE verdict='irrelevant') AS irrelevant,
    (SELECT count(*)::int FROM judged WHERE verdict='uncertain') AS uncertain,
    (SELECT count(*)::int FROM ingest.track_context_evaluations e JOIN ingest.track_context_assignments a ON a.id=e.assignment_id
      JOIN scoped t ON t.id=a.track_id WHERE e.assignment_snapshot<>to_jsonb(a)) AS "staleEvaluations"`,[albumId ?? null])).rows[0];
  const tracks = (await client.query(`${cte} SELECT t.id::float8 AS id,t.title,t.album_id::float8 AS "albumId",
    t.disc_number AS "discNumber",t.track_number AS "trackNumber",
    (SELECT count(*)::int FROM usable u WHERE u.track_id=t.id) AS "approvedAssignments",
    (SELECT count(*)::int FROM judged j WHERE j.track_id=t.id) AS "evaluatedAssignments",
    (SELECT count(*)::int FROM judged j WHERE j.track_id=t.id AND verdict='relevant') AS relevant,
    (SELECT count(*)::int FROM judged j WHERE j.track_id=t.id AND verdict='irrelevant') AS irrelevant,
    (SELECT count(*)::int FROM judged j WHERE j.track_id=t.id AND verdict='uncertain') AS uncertain
    FROM scoped t ORDER BY t.id LIMIT $2 OFFSET $3`,[albumId ?? null,limit,offset])).rows;
  const labels = (await client.query(`${cte} SELECT l.slug,l.kind,
    (SELECT count(DISTINCT track_id)::int FROM usable WHERE label_id=l.id) AS "coveredTracks",
    (SELECT count(*)::int FROM judged WHERE label_id=l.id AND verdict='relevant') AS relevant,
    (SELECT count(*)::int FROM judged WHERE label_id=l.id AND verdict='irrelevant') AS irrelevant,
    (SELECT count(*)::int FROM judged WHERE label_id=l.id AND verdict='uncertain') AS uncertain
    FROM ingest.track_context_labels l ORDER BY l.kind,l.slug`,[albumId ?? null])).rows;
  const pertinent = (r: {relevant:number; irrelevant:number}) => r.relevant+r.irrelevant ? r.relevant/(r.relevant+r.irrelevant) : null;
  return { enabled: true, unit: "track-edition", measuredAt: new Date().toISOString(), limit, offset, albumId: albumId ?? null,
    summary: { ...summary, coverage: summary.totalTracks ? summary.coveredTracks/summary.totalTracks : null, pertinence: pertinent(summary) },
    tracks: tracks.map(t => ({ ...t, pertinence: pertinent(t) })), labels: labels.map(l => ({ ...l, pertinence: pertinent(l) })) };
}
