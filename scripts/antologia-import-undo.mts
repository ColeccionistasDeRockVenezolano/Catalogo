/** Revert only this campaign's first import attempt using the strict journal. */
import {appendFileSync,readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {withOperatorRun} from '../src/merge/operator.js';
import {undoRun} from '../src/merge/run-undo.js';

const OUT=process.env['CRV_ANTOLOGIA_OUT']??'';
if(!OUT.startsWith(path.join(process.env['HOME']!,'crv-staging/reports/'))||realpathSync(OUT)!==OUT)throw new Error('Use existing SSD staging');
const apply=process.argv.includes('--apply');
const limit=Number(process.env['CRV_ANTOLOGIA_LIMIT']??'0');
const receipts=readFileSync(path.join(OUT,'import-applied.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l) as {runId:number;result:{artistCreated?:boolean;url:string}});
// Publications that reused a newly created artist go first, so their parent
// cannot be removed while another campaign publication still depends on it.
const targets=process.env['CRV_ANTOLOGIA_UNDO_URLS']?.split(',');
const ordered=receipts.filter(r=>!targets||targets.includes(r.result.url)).sort((a,b)=>Number(!!a.result.artistCreated)-Number(!!b.result.artistCreated)||b.runId-a.runId);
try{
 for(const r of limit?ordered.slice(0,limit):ordered){
  const result=await withOperatorRun({name:'antologia-altas-2026-11-10:revert-attempt-1',operator:'Codex por encargo de Brian',note:'Rehacer únicamente el lote de esta campaña: corregir la lectura de intérpretes sin etiqueta antes de importar. El catálogo anterior y la evidencia se conservan.',params:{campaign:'antologia-altas-2026-11-10',phase:'revert-attempt-1',sourceUrl:r.result.url}},async ctx=>{
   await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
   const original=(await ctx.client.query<{params:Record<string,unknown>}>('SELECT params FROM ingest.scrape_runs WHERE id=$1',[r.runId])).rows[0];
   if(original?.params['campaign']!=='antologia-altas-2026-11-10'||original.params['phase']!=='import')throw new Error('Refusing to undo another campaign');
   if((await ctx.client.query('SELECT 1 FROM ingest.run_undos WHERE run_id=$1',[r.runId])).rowCount)return {previouslyUndone:r.runId};
   return undoRun(ctx,r.runId);
  },{rollbackOnly:!apply});
  appendFileSync(path.join(OUT,`undo-${apply?'applied':'probe'}.jsonl`),JSON.stringify(result)+'\n');
  console.log(JSON.stringify({undone:r.runId,undoRun:result.runId,dryRun:!apply}));
 }
}finally{await closeDb();}
