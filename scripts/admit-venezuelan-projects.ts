import { readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { admitArtist } from "../src/catalog/editorial-admissions.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { closeDb,getPool } from "../src/db/client.js";

const directory=process.argv[2];
if(!directory||!path.resolve(directory).startsWith(path.join(process.env["HOME"]!,"crv-staging","reports")+path.sep))throw new Error("Usar el staging del informe");
const decision=JSON.parse(await readFile("docs/decisions/2026-10-21-editorial-admissions.json","utf8")) as {
  rule:string;admissions:Array<{id:number;name:string;reason:string;evidence:string[]}>;
};
try{
  const result=await withOperatorRun({name:"editorial:admit-venezuelan-projects",operator:"Brian (ejecución Codex)",note:decision.rule,params:{instruction:"proyectos de venezolanos tambien son venezolanos",decisionFile:"docs/decisions/2026-10-21-editorial-admissions.json"}},async ctx=>{
    const results=[];
    for(const item of decision.admissions){
      const current=(await ctx.client.query("SELECT name FROM public.artists WHERE id=$1",[item.id])).rows[0];
      if(current?.name!==item.name)throw new Error(`Identidad distinta: ${item.id}`);
      results.push(await admitArtist(ctx,item.id,item.reason,item.evidence));
    }
    return results;
  },{serializable:true});
  const counts=(await getPool().query(`SELECT
    (SELECT count(*) FROM ingest.artist_editorial_policy)::int retired,
    (SELECT count(*) FROM ingest.artist_editorial_admissions)::int admitted,
    (SELECT count(*) FROM ingest.catalog_artists)::int public_artists,
    (SELECT count(*) FROM ingest.catalog_albums)::int public_albums,
    (SELECT count(DISTINCT person_id) FROM ingest.artist_editorial_persons)::int protected_persons,
    (SELECT count(*) FROM ingest.ephemerides WHERE status='verified')::int published_events,
    (SELECT count(*) FROM ingest.ephemerides WHERE status='pending')::int pending_events`)).rows[0];
  await writeFile(path.join(directory,"admissions-applied.json"),JSON.stringify({...result,counts},null,2));
  console.log(JSON.stringify({runId:result.runId,reinstated:result.result.filter(row=>row.reinstated).length,counts}));
}finally{await closeDb();}
