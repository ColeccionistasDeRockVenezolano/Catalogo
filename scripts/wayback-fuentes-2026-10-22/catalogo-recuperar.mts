/** Recupera respuestas conservadas cuya única invalidez era un hito sin año, sin nueva llamada. */
import {readFileSync,appendFileSync,existsSync} from 'node:fs';import {join} from 'node:path';
import {getPool,closeDb} from '../../src/db/client.js';
const O=process.env['WAYBACK_OUT']??`${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const parse=(n:string)=>existsSync(join(O,n))?readFileSync(join(O,n),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
const done=new Set(parse('sintesis-artistas.jsonl').map(r=>r.key));const cases=new Map(parse('expedientes-artistas.jsonl').map(r=>[r.key,r]));
const saved=(await getPool().query(`SELECT id,model,prompt_hash,raw_response,input_summary,status,error_message FROM ingest.ai_runs WHERE schema_version=$1 ORDER BY id DESC`,['wayback-catalogo.v1'])).rows;let recovered=0;
for(const row of saved){try{
 const r=JSON.parse(row.raw_response??'null');if(!r||done.has(r.key)||!cases.has(r.key))continue;
 const c=cases.get(r.key);if(row.status==='rejected'&&!/^\[/.test(row.error_message??''))continue;
 if(!['same','new','conflict','insufficient'].includes(r.identity)||typeof r.biography!=='string')continue;
 if(r.artistId!==null&&!c.candidates.some((a:any)=>a.id===r.artistId))continue;
 r.biography=r.biography.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu,'').replace(/(?:https?:\/\/|www\.)\S+/giu,'').trim();
 if(r.biography.length<30)continue;
 r.events=(r.events??[]).filter((e:any)=>Number.isInteger(e.year)&&e.year>=1900&&e.year<=2026&&String(e.quote).includes(String(e.year))&&typeof e.title==='string');
 r.members=(r.members??[]).filter((m:any)=>typeof m.name==='string'&&typeof m.quote==='string');
 r.conflicts=r.conflicts??[];r.releases=r.releases??[];
 appendFileSync(join(O,'sintesis-artistas.jsonl'),JSON.stringify({...r,model:row.model,promptHash:row.prompt_hash,recoveredAiRun:Number(row.id),normalization:'Retira hitos sin año y datos de contacto; conserva el recibo original de IA sin alterarlo.'})+'\n');done.add(r.key);recovered++;
}catch{/* Respuesta no recuperable: queda pendiente de reintento. */}}
console.log({recovered,total:done.size,pending:cases.size-done.size});await closeDb();
