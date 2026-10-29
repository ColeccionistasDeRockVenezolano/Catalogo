/** Manifiesto final de sólo lectura, contado desde filas vivas y diario de campaña. */
import {writeFileSync,readFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
import {WAYBACK_ARCHIVE_TAG as TAG} from '../../src/shared/artist-documents.js';
const out=process.env['WAYBACK_OUT']??`${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const pool=getPool();
const runs=(await pool.query('SELECT id,kind,status,params FROM ingest.scrape_runs WHERE params->>\'campaign\'=$1 ORDER BY id',[TAG])).rows;
const ids=runs.map(r=>r.id);
const journal=(await pool.query('SELECT table_name,op,count(*)::int entries,count(DISTINCT row_pk)::int rows FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) GROUP BY 1,2 ORDER BY 1,2',[ids])).rows;
const created:any={};
const inserted=(await pool.query("SELECT DISTINCT table_name,row_pk FROM ingest.change_journal WHERE run_id=ANY($1::bigint[]) AND op='I'",[ids])).rows;
for(const table of [...new Set(journal.filter(r=>r.op==='I').map(r=>r.table_name))]){
 const exists=(await pool.query('SELECT to_regclass($1)::text AS name',[table])).rows[0]?.name;if(!exists)continue;
 const safe=table.split('.').map((s:string)=>'"'+s.replaceAll('"','""')+'"').join('.');
 const pks=inserted.filter(r=>r.table_name===table).map(r=>r.row_pk);
 let n=0;for(const pk of pks){const fields=Object.keys(pk);const condition=fields.map((f,i)=>'"'+f.replaceAll('"','""')+'"=$'+(i+1)).join(' AND ');if((await pool.query(`SELECT 1 FROM ${safe} WHERE ${condition}`,fields.map(f=>pk[f]))).rowCount)n++;}
 created[table]=n;
}
const artists=(await pool.query('SELECT id,name,biography,logo_url FROM public.artists')).rows;
const before=new Map(JSON.parse(readFileSync(out+'/antes-artists.json','utf8')).map((a:any)=>[Number(a.id),a]));
const existing=artists.filter(a=>before.has(Number(a.id)));
const changedBio=existing.filter(a=>(before.get(Number(a.id)) as any).biography!==a.biography);
const changedLogos=existing.filter(a=>(before.get(Number(a.id)) as any).logo_url!==a.logo_url);
const queries={
 gallery:"SELECT category,count(*)::int n,count(DISTINCT artist_id)::int artists FROM media.artist_gallery WHERE $1=ANY(tags) GROUP BY category ORDER BY category",
 documents:"SELECT category,count(*)::int n,count(*) FILTER(WHERE NOT(metadata @> '{\"editorialHidden\":true}'))::int visible FROM media.artist_documents WHERE $1=ANY(tags) GROUP BY category ORDER BY category",
 ephemerides:"SELECT status,count(*)::int n,count(*) FILTER(WHERE event_date IS NOT NULL)::int exact_date FROM ingest.ephemerides WHERE event_key LIKE $1||':%' GROUP BY status",
 audiovisuals:"SELECT artist_id,id,title,metadata FROM media.artist_audiovisuals WHERE metadata->'tags' ? $1",
};
const details:any={};for(const [name,sql]of Object.entries(queries))details[name]=(await pool.query(sql,[TAG])).rows;
const metrics={generatedAt:new Date().toISOString(),campaign:TAG,runs,journal,created,existingArtistsBiographiesChanged:changedBio.length,existingArtistsLogosChanged:changedLogos.length,...details};
writeFileSync(out+'/cierre-catalogo.json',JSON.stringify(metrics,null,2));
writeFileSync(out+'/biografias-enriquecidas.json',JSON.stringify(changedBio.map(a=>({id:a.id,name:a.name})),null,2));
console.log(JSON.stringify({...metrics,runs:{count:runs.length,min:ids[0],max:ids.at(-1)},audiovisuals:details.audiovisuals.map((a:any)=>({id:a.id,artistId:a.artist_id,title:a.title}))},null,2));await closeDb();
