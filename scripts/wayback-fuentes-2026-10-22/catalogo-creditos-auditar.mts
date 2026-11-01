import {writeFileSync} from 'node:fs';import {closeDb} from '../../src/db/client.js';
import {withOperatorRun,deleteEntity,deleteRelation} from '../../src/merge/operator.js';
import {WAYBACK_ARCHIVE_TAG as TAG} from '../../src/shared/artist-documents.js';
const out=process.env['WAYBACK_OUT']??`${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const badIds=[42289,42290,42291,42292,42293,42297,42298,42299,42302,42306,42315,42320,42321,42327,42328,42331,42334,42336,42338,42342,42343,42344,42347,42351,42358,42360,42361,42362,42369,42374,42376,42377,42337,42371];
const result=await withOperatorRun({name:'wayback:credit-integrity',operator:'codex',note:'Retirar fragmentos de créditos compuestos que no son nombres de una persona. Texto íntegro conservado en documentos de publicaciones; no resolver identidades por inferencia.',params:{campaign:TAG}},async ctx=>{
const changes:any[]=[];
for(const id of badIds){
 const person=(await ctx.client.query(`SELECT p.id,p.name FROM public.persons p WHERE p.id=$1 AND EXISTS(SELECT 1 FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE r.params->>'campaign'=$2 AND j.table_name='public.persons' AND j.op='I' AND j.row_pk=jsonb_build_object('id',p.id))`,[id,TAG])).rows[0];if(!person)continue;
 const credits:any[]=[];
 for(const [table,kind]of [['album_credits','album_credit'],['track_credits','track_credit']] as const){
  const rows=(await ctx.client.query(`SELECT c.* FROM public.${table} c WHERE c.person_id=$1`,[id])).rows;
  for(const row of rows){const own=(await ctx.client.query(`SELECT 1 FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE r.params->>'campaign'=$1 AND j.table_name=$2 AND j.op='I' AND j.row_pk=jsonb_build_object('id',$3::bigint)`,[TAG,'public.'+table,row.id])).rowCount;if(!own)throw new Error('Dependencia ajena a campaña '+id);await deleteRelation(ctx,kind,Number(row.id));credits.push({kind,...row});}
 }
 await deleteEntity(ctx,'person',id);changes.push({person,credits,reason:'Crédito compuesto o nombre de estudio: conservar literal para revisión en Otros.'});
}return changes;
});writeFileSync(out+'/auditoria-creditos.json',JSON.stringify(result,null,2));console.log({runId:result.runId,withdrawnMalformedIdentities:result.result.length});await closeDb();
