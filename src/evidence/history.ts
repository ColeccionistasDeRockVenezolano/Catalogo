import type { OperatorContext } from "../merge/operator.js";
import { OperatorError } from "../merge/operator.js";

/** Preserve what the surviving claim says, without inventing a historical capture or verification. */
export async function inventoryHistoricalClaims(context:OperatorContext,after:number,limit:number) {
  if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>10_000) throw new OperatorError("invalid","cursor o tamaño de lote inválido");
  const selected=(await context.client.query<{id:string}>("SELECT id::text FROM ingest.claims WHERE id>$1 ORDER BY id LIMIT $2 FOR SHARE",[after,limit])).rows;
  const ids=selected.map(row=>Number(row.id));
  if(!ids.length)return {examined:0,inserted:0,unresolved:0,next:after};
  const result=await context.client.query<{n:number}>(`
    WITH source AS (
      SELECT c.*,to_jsonb(c) AS snapshot,coalesce(a.id,p.id,o.id,al.id,t.id) AS target
      FROM ingest.claims c
      LEFT JOIN public.artists a ON c.entity_kind::text='artist' AND a.id=c.artist_id
      LEFT JOIN public.persons p ON c.entity_kind::text='person' AND p.id=c.person_id
      LEFT JOIN public.organizations o ON c.entity_kind::text='organization' AND o.id=c.organization_id
      LEFT JOIN public.albums al ON c.entity_kind::text='album' AND al.id=c.album_id
      LEFT JOIN public.tracks t ON c.entity_kind::text='track' AND t.id=c.track_id
      WHERE c.id=ANY($1::bigint[])
    ), inserted AS (
      INSERT INTO ingest.catalog_facts(fact_key,subject_kind,original_subject_id,relation,value,value_type,scope,documentary_state,created_by,operator,reason,claim_id,run_id)
      SELECT encode(sha256(convert_to('historical-claim:'||id::text,'UTF8')),'hex'),entity_kind::text,target,
        'historical_claim',jsonb_build_object('claim',snapshot,'captureState','unknown','interpretation','surviving historical assertion; no documentary approval inferred'),
        'relation','{}'::jsonb,'unverifiable','system',$2,$3,id,$4
      FROM source WHERE target IS NOT NULL
      ON CONFLICT(fact_key) DO NOTHING RETURNING id
    ) SELECT count(*)::int AS n FROM inserted`,[ids,context.operator,context.note,context.runId]);
  // A later run never rewrites the first snapshot. Its current binding is
  // created only if the original destination still exists.
  await context.client.query(`INSERT INTO ingest.catalog_fact_bindings(fact_id,artist_id,person_id,organization_id,album_id,track_id)
    SELECT f.id,a.id,p.id,o.id,al.id,t.id FROM ingest.catalog_facts f
    LEFT JOIN public.artists a ON f.subject_kind='artist' AND a.id=f.original_subject_id
    LEFT JOIN public.persons p ON f.subject_kind='person' AND p.id=f.original_subject_id
    LEFT JOIN public.organizations o ON f.subject_kind='organization' AND o.id=f.original_subject_id
    LEFT JOIN public.albums al ON f.subject_kind='album' AND al.id=f.original_subject_id
    LEFT JOIN public.tracks t ON f.subject_kind='track' AND t.id=f.original_subject_id
    WHERE f.relation='historical_claim' AND f.claim_id=ANY($1::bigint[]) AND num_nonnulls(a.id,p.id,o.id,al.id,t.id)=1
    ON CONFLICT(fact_id) DO NOTHING`,[ids]);
  const stored=(await context.client.query<{n:number}>("SELECT count(*)::int AS n FROM ingest.catalog_facts WHERE relation='historical_claim' AND claim_id=ANY($1::bigint[])",[ids])).rows[0]!.n;
  return {examined:ids.length,inserted:result.rows[0]!.n,unresolved:ids.length-stored,next:ids.at(-1)!};
}
