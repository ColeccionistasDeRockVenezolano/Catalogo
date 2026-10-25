/** Retira los seis discos ficticios que fusionaban dos columnas de un PDF. */
import{readFileSync,appendFileSync}from'node:fs';import path from'node:path';
import{withOperatorRun}from'../src/merge/operator.js';import{removeEntity}from'../src/merge/removals.js';import{closeDb}from'../src/db/client.js';
const data=process.env['HERMES_DEEP_DATA'],report=process.env['HERMES_DEEP_REPORT'];if(!data||!report)throw new Error('Faltan rutas');const apply=process.argv.includes('--apply');
const bad=JSON.parse(readFileSync(path.join(data,'venezuelademo-columnas-rotas.json'),'utf8'))as{slug:string;nativeAlbums:{id:string;artist_id:string;title:string}[]}[];
try{
 const run=await withOperatorRun({name:'hermes-deep:vd-column-repair',operator:'codex (encargo de Brian)',note:'El PDF tiene dos discos en columnas distintas. Retirar únicamente títulos compuestos creados por la importación integral; conservar originales, evidencia e historial y reconstruir las referencias separadas.',params:{campaign:'hermes-cierre-profundo-2026-10-24'}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);const results=[];
  for(const r of bad)for(const a of r.nativeAlbums){
   const current=(await ctx.client.query<{title:string;artist_id:string}>('SELECT title,artist_id::text FROM public.albums WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
   if(!current){results.push({key:'vd-invalid:'+a.id,albumId:Number(a.id),reused:true});continue;}
   if(current.title!==a.title||current.artist_id!==a.artist_id)throw new Error('Cambió el disco señalado');
   if(!(await ctx.client.query("SELECT 1 FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE j.table_name='public.albums' AND j.op='I' AND j.row_pk->>'id'=$1 AND r.params->>'campaign'='hermes-integral-2026-10-24'",[a.id])).rowCount)throw new Error('El disco no fue creado por esta importación');
   const removed=await removeEntity(ctx.client,'album',Number(a.id),{note:ctx.note,runId:ctx.runId});
   await ctx.client.query(`UPDATE media.artist_documents SET metadata=metadata||$2::jsonb WHERE metadata->>'albumId'=$1 AND metadata->>'campaign'='hermes-integral-2026-10-24'`,[a.id,JSON.stringify({editorialHidden:true,withdrawnAlbumId:Number(a.id),withdrawalReason:'Dos columnas de discografía convertidas en un título compuesto; conservar evidencia y usar el derivado v3.'})]);
   results.push({key:'vd-invalid:'+a.id,albumId:Number(a.id),slug:r.slug,removed:true,historyPreserved:Boolean(removed?.parentAuditId),claimsRetained:removed?.claimsRejected.length??0});
  }
  return results;
 },{rollbackOnly:!apply});
 appendFileSync(path.join(report,'vdwithdraw-'+(apply?'applied':'probe')+'.jsonl'),JSON.stringify({runId:run.runId,applied:apply,results:run.result})+'\n');console.log(JSON.stringify({runId:run.runId,applied:apply,removed:run.result.filter(r=>r.removed).length}));
}finally{await closeDb();}
