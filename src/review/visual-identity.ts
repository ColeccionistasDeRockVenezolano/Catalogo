import { getPool } from "../db/client.js";
import type { ClaimReviewEntity } from "../shared/claim-review.js";
import { ENTITY_SPECS, type ResolvableClaimKind } from "../merge/specs.js";

export async function getReviewEntity(kind: string, id: number): Promise<ClaimReviewEntity | null> {
  const spec = ENTITY_SPECS[kind as ResolvableClaimKind];
  if (!spec) return null;
  const related = kind === "person"
    ? `(SELECT string_agg(DISTINCT a.name || ' · ' || m.role, ' / ') FROM public.artist_members m JOIN public.artists a ON a.id=m.artist_id WHERE m.person_id=e.id)`
    : kind === "album" ? `(SELECT a.name FROM public.artists a WHERE a.id=e.artist_id)`
      : kind === "track" ? `(SELECT a.title FROM public.albums a WHERE a.id=e.album_id)` : "NULL";
  const parentImage = kind === "track" ? `(SELECT a.cover_url FROM public.albums a WHERE a.id=e.album_id)` : "NULL";
  const { rows } = await getPool().query<{ id: string; name: string; image: string | null; context: string | null; album_id: string | null }>(`
    SELECT e.id::text,e.${spec.identityColumn} AS name,
      COALESCE(to_jsonb(e)->>'picture_url',to_jsonb(e)->>'cover_url',${parentImage}) AS image,
      concat_ws(' · ',${related},to_jsonb(e)->>'origin_city',to_jsonb(e)->>'formed_year',to_jsonb(e)->>'nationality',to_jsonb(e)->>'release_year') AS context,
      to_jsonb(e)->>'album_id' AS album_id FROM ${spec.table} e WHERE e.id=$1`,[id]);
  const row = rows[0];
  return row ? { kind,id,name: row.name,imageUrl: row.image,context: row.context,albumId: row.album_id ? Number(row.album_id) : null } : null;
}
export interface ReviewIdentityContext { incoming: ClaimReviewEntity; candidate: ClaimReviewEntity; }
export async function loadReviewIdentityContext(reviewId: number): Promise<ReviewIdentityContext | null> {
  const { rows } = await getPool().query<{
    kind: string; entity_kind: string | null; identity_raw: string | null; candidate_id: string | null;
    person_a_id: string | null; person_b_id: string | null; artist_a_id: string | null; artist_b_id: string | null;
    image_url: string | null; input_context: Record<string,unknown> | null;
  }>(`SELECT q.kind::text,c.entity_kind::text,c.identity_raw,
      er.input_context,er.candidates->0->>'candidateId' AS candidate_id,q.person_a_id::text,q.person_b_id::text,q.artist_a_id::text,q.artist_b_id::text,
      (SELECT COALESCE(sc.normalized_value,sc.raw_value)#>>'{}' FROM ingest.claims sc
        WHERE sc.source_id=c.source_id AND sc.entity_kind=c.entity_kind AND sc.identity_key=c.identity_key
          AND sc.field IN ('picture_url','cover_url','logo_url') AND sc.status NOT IN ('rejected','superseded')
          AND jsonb_typeof(COALESCE(sc.normalized_value,sc.raw_value))='string' ORDER BY sc.id DESC LIMIT 1) AS image_url
    FROM ingest.review_queue q LEFT JOIN ingest.claims c ON c.id=q.claim_a_id
    LEFT JOIN ingest.entity_resolution_decisions er ON er.id=CASE WHEN q.payload->>'resolutionDecisionId' ~ '^[1-9][0-9]*$' THEN (q.payload->>'resolutionDecisionId')::bigint END
    WHERE q.id=$1`,[reviewId]);
  const row = rows[0];if (!row) return null;
  if (row.person_a_id && row.person_b_id) {
    const [incoming,candidate] = await Promise.all([getReviewEntity('person',Number(row.person_a_id)),getReviewEntity('person',Number(row.person_b_id))]);
    return incoming && candidate ? { incoming,candidate } : null;
  }
  if (row.artist_a_id && row.artist_b_id) {
    const [incoming,candidate] = await Promise.all([getReviewEntity('artist',Number(row.artist_a_id)),getReviewEntity('artist',Number(row.artist_b_id))]);
    return incoming && candidate ? { incoming,candidate } : null;
  }
  if (!row.entity_kind || !row.identity_raw || !row.candidate_id || !['album_match','person_match','organization_match','ambiguous_alias','ai_entity_resolution'].includes(row.kind)) return null;
  const candidate = await getReviewEntity(row.entity_kind,Number(row.candidate_id));
  if (!candidate) return null;
  const parts = row.identity_raw.split('::');
  const sourceContext = [row.input_context?.["bands"],row.input_context?.["instruments"],row.input_context?.["roles"],row.input_context?.["albumCredits"]]
    .flatMap(value => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []).slice(0,8).join(' · ');
  return { incoming: { kind: row.entity_kind,id: null,name: parts.at(-1) ?? row.identity_raw,context: sourceContext || parts.slice(0,-1).join(' · ') || 'Aporte de la fuente',imageUrl: row.image_url,albumId: null },candidate };
}
