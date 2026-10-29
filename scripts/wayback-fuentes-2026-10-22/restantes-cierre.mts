import {writeFileSync,readFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw new Error('WAYBACK_OUT obligatorio');
const pool=getPool();
const runs=(await pool.query("SELECT id,params->>'action' name,status,params FROM ingest.scrape_runs WHERE params->>'supplement'='wayback-restantes-2026-10-23' ORDER BY id")).rows;
const journal=(await pool.query(`SELECT id,run_id,table_name,op,row_pk,old_data,new_data FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) AND table_name IN ('public.artists','public.albums','public.tracks','public.persons','public.organizations','public.album_credits','public.track_credits','public.artist_members','media.artist_documents','media.artist_gallery','ingest.ephemerides','ingest.album_versions','ingest.artist_aliases','ingest.person_aliases','ingest.album_aliases','ingest.track_aliases') ORDER BY id`,[runs.map(r=>r.id)])).rows;
const counts:any={};const inserted=new Map<string,Set<number>>(),touched=new Map<string,Set<number>>();
for(const j of journal){const id=Number(j.row_pk.id);if(!Number.isSafeInteger(id))continue;
 if(j.op==='I'){if(!inserted.has(j.table_name))inserted.set(j.table_name,new Set());inserted.get(j.table_name)!.add(id);}
 if(!touched.has(j.table_name))touched.set(j.table_name,new Set());touched.get(j.table_name)!.add(id);
}
for(const [table,ids] of touched){const result=(await pool.query(`SELECT id FROM ${table} WHERE id=ANY($1::bigint[])`,[[...ids]])).rows.map(r=>Number(r.id));const news=inserted.get(table)??new Set();counts[table]={touchedAlive:result.length,newAlive:result.filter(id=>news.has(id)).length,preexistingTouchedAlive:result.filter(id=>!news.has(id)).length,insertedDuringRuns:news.size};}
const docs=(await pool.query("SELECT * FROM media.artist_documents WHERE metadata->>'supplement'='wayback-restantes-2026-10-23' ORDER BY id")).rows;
const people=inserted.has('public.persons')?(await pool.query('SELECT * FROM public.persons WHERE id=ANY($1::bigint[])',[[...inserted.get('public.persons')!]])).rows:[];
const orgs=inserted.has('public.organizations')?(await pool.query('SELECT * FROM public.organizations WHERE id=ANY($1::bigint[])',[[...inserted.get('public.organizations')!]])).rows:[];
const state=JSON.parse(readFileSync(out+'/applied-state.json','utf8'));
const sourceRows=JSON.parse(readFileSync(out+'/galeria-pendientes.json','utf8'));
const missing=sourceRows.filter((r:any)=>!docs.some((d:any)=>d.source_url===r.evidencia.url));
const summary={closedAt:new Date().toISOString(),runs: runs.map(r=>({id:Number(r.id),name:r.name,status:r.status})),counts,documentCategories:docs.reduce((a:any,d:any)=>(a[d.category]=(a[d.category]??0)+1,a),{}),documents:docs.length,visibleDocuments:docs.filter((d:any)=>!d.metadata.editorialHidden).length,yearOnlyMilestones:docs.flatMap((d:any)=>d.metadata.ephemerisIds??[]).length,missingGallerySources:missing.map((r:any)=>r.evidencia.url),publicationMapping:state.publications,newPeople:people.map((p:any)=>({id:Number(p.id),name:p.name})),newOrganizations:orgs.map((p:any)=>({id:Number(p.id),name:p.name})),unassignedCredits:docs.flatMap((d:any)=>(d.metadata.unassignedCredits??[]).map((c:any)=>({documentId:Number(d.id),albumId:d.metadata.albumId,...c})))};
writeFileSync(out+'/cierre-catalogo.json',JSON.stringify(summary,null,2));
writeFileSync(out+'/diario-cambios.json',JSON.stringify(journal));
writeFileSync(out+'/documentos-finales.json',JSON.stringify(docs));
console.log(JSON.stringify({runs:runs.length,counts,documents:docs.length,missingSources:missing.length,people:summary.newPeople,organizations:summary.newOrganizations},null,2));
await closeDb();
