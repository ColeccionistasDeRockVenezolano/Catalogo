import type { OperatorContext } from "../merge/operator.js";
import { getPool } from "../db/client.js";

export interface EphemerisInput {
  key:string; title:string; description:string; date:string|null; year:number; dateNote:string|null;
  place:string; subject:string; originalArtistId:number|null; status:"verified"|"pending"|"contradicted";
  sources:Array<{title:string;url:string}>;
}
/** Escritura editorial, independiente de artistas y con diario en el mismo run. */
export async function saveEphemeris(ctx:OperatorContext,input:EphemerisInput) {
  const result=await ctx.client.query<{id:number}>(`INSERT INTO ingest.ephemerides
    (event_key,title,description,event_date,event_year,date_note,place,subject_name,original_artist_id,status,sources,run_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT(event_key) DO UPDATE SET title=excluded.title,description=excluded.description,event_date=excluded.event_date,
    event_year=excluded.event_year,date_note=excluded.date_note,place=excluded.place,subject_name=excluded.subject_name,
    original_artist_id=excluded.original_artist_id,status=excluded.status,sources=excluded.sources,run_id=excluded.run_id,updated_at=now()
    RETURNING id::int`,[input.key,input.title,input.description,input.date,input.year,input.dateNote,input.place,input.subject,
    input.originalArtistId,input.status,JSON.stringify(input.sources),ctx.runId,ctx.operator]);
  return result.rows[0]!;
}
export async function editorialEphemerides() {
  return (await getPool().query("SELECT * FROM ingest.ephemerides ORDER BY updated_at DESC,id DESC")).rows;
}
