/** La plantilla de cinco integrantes documenta una banda, no un solista. No fusiona. */
import{readFileSync,appendFileSync}from'node:fs';import path from'node:path';
import{withOperatorRun}from'../src/merge/operator.js';import{rememberEvidenceFragment,recordFact,applyFact}from'../src/evidence/inventory.js';import{closeDb}from'../src/db/client.js';
const report=process.env['HERMES_DEEP_REPORT'];if(!report)throw new Error('Falta informe');const apply=process.argv.includes('--apply');
const captures=readFileSync('data/research/hermes-importacion-integral-2026-10-24/captures.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as{key:string;text:string});const key='mp3com:206/biotech1.html';const quote='members: Alexander "PATA" Moreno (vocals)Alifran Inojosa (Guitars)Juan Luis (Bass)Alejandro "Mani" (Drums)Ferlin Fernandez (latin percussions)';
if(!captures.find(c=>c.key===key)?.text.includes(quote))throw new Error('Cita no literal');
try{
 const run=await withOperatorRun({name:'hermes-deep:biotech-type',operator:'codex (encargo de Brian)',note:'El perfil primario BIOTECH enumera cinco integrantes con voz, guitarra, bajo, batería y percusión. Corregir exclusivamente el tipo solo_artist a band. La relación con Bio Tech #7649 sigue sin confirmación independiente y no se fusiona.',params:{campaign:'hermes-cierre-profundo-2026-10-24'}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  const artist=(await ctx.client.query<{name:string;artist_type:string}>('SELECT name,artist_type FROM public.artists WHERE id=7652 FOR UPDATE')).rows[0];
  if(artist?.name!=='BIOTECH'||!['solo_artist','band'].includes(artist.artist_type))throw new Error('Cambió el sujeto revisado');
  if(artist.artist_type==='band')return[{key,artistId:7652,reused:true}];
  const document=(await ctx.client.query<{id:string}>("SELECT id::text FROM ingest.evidence_documents WHERE extraction_metadata->>'sourceRecordKey'=$1 ORDER BY id LIMIT 1",[key])).rows[0];if(!document)throw new Error('Falta documento conservado');
  const fragmentId=await rememberEvidenceFragment(ctx.client,Number(document.id),quote);
  const f=await recordFact(ctx,{kind:'artist',entityId:7652,field:'artist_type',value:'band',valueType:'scalar',state:'pending',evidence:[{fragmentId,role:'supports'}]},'system');await applyFact(ctx,f.factId,{editorial:true});
  return[{key,artistId:7652,factId:f.factId,corrected:true}];
 },{rollbackOnly:!apply});
 appendFileSync(path.join(report,'biotechtype-'+(apply?'applied':'probe')+'.jsonl'),JSON.stringify({runId:run.runId,applied:apply,results:run.result})+'\n');console.log(JSON.stringify({runId:run.runId,applied:apply,results:run.result}));
}finally{await closeDb();}
