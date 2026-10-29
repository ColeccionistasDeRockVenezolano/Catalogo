import {writeFileSync,readFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
import {createDeepSeekGateway} from '../../src/ai/gateway.js';
import {rewriteTexts} from '../../src/merge/text-rewrite.js';
import {withOperatorRun,updateEntity} from '../../src/merge/operator.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw new Error('WAYBACK_OUT obligatorio');
const ids=[101,2794,4586];
const proposals=process.argv.includes('--apply-reviewed')?[]:await Promise.all(ids.map(async id=>{
 const a=(await getPool().query('SELECT name,biography FROM public.artists WHERE id=$1',[id])).rows[0];
 const result=await rewriteTexts(createDeepSeekGateway(),{kind:'artist',name:a.name,sources:[{label:a.name,text:a.biography}]});return {id,name:a.name,previous:a.biography,...result};
}));
if(proposals.length)writeFileSync(out+'/biografias-fusionadas.json',JSON.stringify(proposals,null,2));
if(process.argv.includes('--apply-reviewed')){
 const reviewed=JSON.parse(readFileSync(out+'/biografias-fusionadas-aprobadas.json','utf8'));
 for(const p of reviewed)await withOperatorRun({name:'wayback-restantes:biography-merge',operator:'codex',note:'Revisión de conservación de hechos después de fusionar identidades contrastadas. Se retira repetición sin eliminar datos.',params:{campaign:'archivo-wayback-2026-10-22',supplement:'wayback-restantes-2026-10-23',artistId:p.id,promptHash:p.promptHash}},async ctx=>{
  const current=(await ctx.client.query('SELECT biography FROM public.artists WHERE id=$1 FOR UPDATE',[p.id])).rows[0];
  if(current.biography!==p.previous)throw new Error('Biografía cambió durante revisión');
  await updateEntity(ctx,'artist',p.id,{biography:p.text});
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  await ctx.client.query("UPDATE ingest.text_rewrites SET status='done',resolved_run_id=$2,resolved_at=now() WHERE entity_kind='artist' AND entity_id=$1 AND status='pending'",[p.id,ctx.runId]);
 });
}
console.log(proposals.map(p=>({id:p.id,previousChars:p.previous.length,resultChars:p.text.length})));
await closeDb();
