import type { OperatorContext } from "../merge/operator.js";
import { OperatorError } from "../merge/operator.js";

/** Solo una decisión editorial explícita levanta una exclusión. Conserva la
 * decisión anterior completa y sus claves, además del diario del run. */
export async function admitArtist(ctx:OperatorContext,artistId:number,reason:string,evidence:unknown[]) {
  if(!reason.trim()||!evidence.length)throw new OperatorError("invalid","La admisión requiere motivo y evidencia");
  await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('crv:editorial-scope'))");
  const artist=(await ctx.client.query("SELECT id,name FROM public.artists WHERE id=$1 FOR UPDATE",[artistId])).rows[0];
  if(!artist)throw new OperatorError("not_found","Artista inexistente");
  const previous=(await ctx.client.query(`SELECT to_jsonb(p)||jsonb_build_object(
    'names',(SELECT jsonb_agg(n) FROM ingest.artist_editorial_names n WHERE n.artist_id=p.artist_id),
    'persons',(SELECT jsonb_agg(n) FROM ingest.artist_editorial_persons n WHERE n.artist_id=p.artist_id),
    'identifiers',(SELECT jsonb_agg(n) FROM ingest.artist_editorial_identifiers n WHERE n.artist_id=p.artist_id)) AS snapshot
    FROM ingest.artist_editorial_policy p WHERE artist_id=$1 FOR UPDATE`,[artistId])).rows[0];
  await ctx.client.query(`INSERT INTO ingest.artist_editorial_admissions(artist_id,reason,evidence,previous_exclusion,decided_by,run_id)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(artist_id) DO NOTHING`,[artistId,reason,JSON.stringify(evidence),previous?JSON.stringify(previous.snapshot):null,ctx.operator,ctx.runId]);
  for(const table of ["artist_editorial_names","artist_editorial_persons","artist_editorial_identifiers","artist_editorial_policy"])
    await ctx.client.query(`DELETE FROM ingest.${table} WHERE artist_id=$1`,[artistId]);
  return {artistId,name:String(artist.name),reinstated:Boolean(previous)};
}
