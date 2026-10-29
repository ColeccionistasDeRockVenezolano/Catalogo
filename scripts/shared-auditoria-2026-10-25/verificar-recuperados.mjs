import pg from 'pg';
import {config} from 'dotenv';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
config({quiet:true});
const dir=process.argv[2];
if(!dir?.includes('/crv-staging/'))throw Error('Usar staging SSD');
const rows=f=>readFileSync(f,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const applied=rows(path.join(dir,'plan-fechas-recuperadas.jsonl'));
const report=JSON.parse(readFileSync(path.join(dir,'aplicacion-fechas-recuperadas-run34296.json'),'utf8'));
const gaps=rows('reports/shared-auditoria-profunda-2026-10-25/huecos-con-candidatos-agrupados.jsonl');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const meta=(await client.query("SELECT now()::text captured_at,current_setting('transaction_read_only') read_only")).rows[0];
  const verified=[];
  for(const p of applied){
    const current=(await client.query('SELECT id,release_year,release_date_text FROM public.albums WHERE id=$1',[p.id])).rows[0];
    const journal=(await client.query("SELECT old_data,new_data FROM ingest.change_journal WHERE run_id=$1 AND table_name='public.albums' AND row_pk->>'id'=$2",[report.runId,String(p.id)])).rows;
    const claim=(await client.query("SELECT c.id,c.status,e.url,e.excerpt,s.slug FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id JOIN ingest.claim_evidence e ON e.claim_id=c.id WHERE c.run_id=$1 AND c.album_id=$2 AND c.field='release_date_text'",[report.runId,p.id])).rows;
    if(current.release_date_text!==p.value || current.release_year!==p.expectedYear || journal.length!==1 || journal[0].old_data.release_date_text!==null || claim.length!==1 || claim[0].status!=='accepted' || claim[0].slug!==p.sourceSlug)throw Error(`Validación falló: ${p.id}`);
    verified.push({id:p.id,value:current.release_date_text,year:current.release_year,claim:claim[0],journal:journal[0]});
  }
  const tables={artist:'artists',album:'albums',track:'tracks',person:'persons'};
  const entities={};
  for(const [kind,table] of Object.entries(tables)){
    const fields=[...new Set(gaps.filter(r=>r.kind===kind).map(r=>r.field==='label_name'?'label_id':r.field))];
    if(fields.some(f=>!/^[a-z_]+$/u.test(f)))throw Error('Campo inválido');
    const ids=gaps.filter(r=>r.kind===kind).map(r=>r.id);
    const result=(await client.query(`SELECT id,${fields.join(',')} FROM public.${table} WHERE id=ANY($1::bigint[])`,[ids])).rows;
    entities[kind]=new Map(result.map(r=>[String(r.id),r]));
  }
  const genres=new Set((await client.query("SELECT album_id FROM ingest.album_genres WHERE role='primary' AND status='confirmed'")).rows.map(r=>String(r.album_id)));
  let filled=0;
  for(const g of gaps){
    const v=entities[g.kind].get(String(g.id))?.[g.field==='label_name'?'label_id':g.field];
    if((v!==null && v!==undefined && String(v).trim()!=='') || (g.kind==='album' && g.field==='genre' && genres.has(String(g.id))))filled++;
  }
  await client.query('COMMIT');
  const result={...meta,runId:report.runId,verifiedChanges:verified.length,originalSlots:gaps.length,filledSlots:filled,emptySlots:gaps.length-filled,verified};
  writeFileSync(path.join(dir,'VERIFICACION-POSTERIOR.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...meta,runId:report.runId,verifiedChanges:verified.length,filledSlots:filled,emptySlots:gaps.length-filled}));
}finally{await client.end();}
