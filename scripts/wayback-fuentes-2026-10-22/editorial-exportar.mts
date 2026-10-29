import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;if(!out||existsSync(out+'/antes-catalogo.json'))throw new Error('Ruta nueva obligatoria; no sobrescribir línea base');
const p=getPool();const c=await p.connect();
try{
await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const q=async(sql:string,args:any[]=[]) => (await c.query(sql,args)).rows;
const previous=JSON.parse(readFileSync('reports/wayback-restantes-2026-10-23/cierre-catalogo.json','utf8'));
const creditCases=previous.unassignedCredits.filter((x:any)=>x.name);
const albumIds=[...new Set([...creditCases.map((x:any)=>Number(x.albumId)),23178,2671,630,655])];
const albums=await q('SELECT a.*,r.name artist_name FROM public.albums a JOIN public.artists r ON r.id=a.artist_id WHERE a.id=ANY($1::bigint[]) ORDER BY a.id',[albumIds]);
const persons=await q('SELECT * FROM public.persons WHERE id=ANY($1::bigint[]) OR name ILIKE ANY($2::text[]) ORDER BY id',[creditCases.flatMap((x:any)=>x.candidates??[]),['%Luxxar%','%Paper%soul%','%Thug%','%Luis%Navas%','%Pedro%Fajardo%','%Leonardo%P%rez%','%Daniel%Gonz%lez%','%Carlos%Delgado%']]);
const data={at:new Date().toISOString(),creditCases,albums,persons,aliases:await q('SELECT * FROM ingest.person_aliases WHERE person_id=ANY($1::bigint[])',[persons.map(r=>r.id)]),credits:await q('SELECT * FROM public.album_credits WHERE album_id=ANY($1::bigint[])',[albumIds]),documents:await q('SELECT d.*,a.name artist_name FROM media.artist_documents d JOIN public.artists a ON a.id=d.artist_id WHERE d.id=ANY($1::bigint[]) OR d.artist_id=ANY($2::bigint[]) OR d.metadata->>\'albumId\'=ANY($3::text[]) ORDER BY d.id',[creditCases.map((x:any)=>x.documentId),[6994,7008],['23178','2671','630','655']]),tracks:await q('SELECT * FROM public.tracks WHERE album_id=ANY($1::bigint[]) ORDER BY album_id,track_number,id',[[23178,2671,630,655]]),members:await q('SELECT m.*,p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE artist_id=ANY($1::bigint[])',[[6994,7008]]),versions:await q('SELECT * FROM ingest.album_versions WHERE album_id=ANY($1::bigint[])',[[23178,2671,630,655]]),organizations:await q('SELECT * FROM public.organizations WHERE name ILIKE ANY($1::text[])',[['%paper%','%thug%','%luxx%']])};
writeFileSync(out+'/antes-catalogo.json',JSON.stringify(data,null,2));
console.log(JSON.stringify({albums:albums.map(r=>({id:r.id,title:r.title,artist:r.artist_name,type:r.album_type,year:r.release_year})),persons:persons.map(r=>({id:r.id,name:r.name,real_name:r.real_name,biography:r.biography})),members:data.members},null,2));
await c.query('COMMIT');
}finally{c.release();await closeDb();}
