// Recupera citas literales cuando solo variaron espacios o puntuación de la transcripción.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const baseDir='reports/webs-oficiales-2026-10-18/revision-990';
const dir=process.argv.includes('--scrapling')?`${baseDir}/scrapling/evaluacion`:baseDir;
const fold=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
function literal(q:string,text:string):string|null{
 if(text.includes(q))return q;
 const wanted=[...q.matchAll(/[\p{L}\p{N}]+/gu)].map(m=>fold(m[0]));
 const tokens=[...text.matchAll(/[\p{L}\p{N}]+/gu)];
 if(wanted.length<4)return null;
 for(let i=0;i+wanted.length<=tokens.length;i++){
  if(wanted.every((w,j)=>w===fold(tokens[i+j]![0])))return text.slice(tokens[i]!.index,tokens[i+wanted.length-1]!.index+tokens[i+wanted.length-1]![0].length);
 }return null;
}
const changes=[];
try{
 for(const f of readdirSync(`${dir}/casos`).filter(f=>f.endsWith('.json'))){
  const path=`${dir}/casos/${f}`,d=JSON.parse(readFileSync(path,'utf8'));
  if(d.status!=='uncertain'||!d.reason?.includes('citas literales')||!d.aiRunId)continue;
  const row=(await getPool().query('select output_summary from ingest.ai_runs where id=$1 and status=\'validated\'',[d.aiRunId])).rows[0];const original=row?.output_summary;
  if(!original||!['matched','different_artist','unrelated','inactive_domain'].includes(original.status))continue;
  const text=(d.pages??[]).map((p:{url:string;content:string})=>`URL: ${p.url}\n${p.content}`).join('\n\n');
  const evidence:Array<{quote:string;basis:string;catalogValue:string}>=[];
  for(const e of original.evidence??[]){
   for(const part of e.quote.split(/\.{3}|…/u)){const quote=literal(part.trim(),text);if(quote&&quote.length>=8&&!evidence.some(e=>e.quote===quote))evidence.push({...e,quote});}
  }
  if(!evidence.length)continue;
  // El mero nombre o copyright no basta para reparar una coincidencia.
  if(original.status==='matched'&&!evidence.some(e=>e.basis==='biography'||e.basis==='discography'||e.basis==='streaming'||(e.basis==='name_and_music'&&/músic|music|compos|improvis|band|disco|record|album|rock|listen|cant|prod|guitar|sound|show|live|photo/iu.test(e.quote))))continue;
  writeFileSync(`${dir}/casos/${f}.antes-reparar`,JSON.stringify(d,null,2)+'\n');
  const repaired={...d,status:original.status,siteType:original.siteType,evidence:evidence.slice(0,6),reason:original.reason,literalRecovery:'Se conservaron únicamente fragmentos presentes en la transcripción; se toleró solo puntuación, mayúsculas o espacios al localizar el fragmento original.',repairedAt:new Date().toISOString()};
  writeFileSync(path,JSON.stringify(repaired,null,2)+'\n');changes.push({artistId:d.artistId,name:d.name,url:d.url,status:repaired.status});
 }
 writeFileSync(`${dir}/citas-recuperadas.json`,JSON.stringify(changes,null,2)+'\n');console.log(JSON.stringify(changes));
}finally{await closeDb();}
