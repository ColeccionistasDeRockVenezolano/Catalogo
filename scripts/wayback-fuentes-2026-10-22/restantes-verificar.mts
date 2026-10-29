/** Comprobaciones de integridad y lectura real; no modifica el catálogo. */
import {writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw new Error('WAYBACK_OUT obligatorio');const p=getPool();
const checks:any={};
checks.suspectDocuments=(await p.query("SELECT id,artist_id,title,content,source_url,metadata FROM media.artist_documents WHERE source_url LIKE '%fnpr.htm%' OR artist_id=6807 ORDER BY id")).rows;
checks.manaoMilestones=(await p.query('SELECT id,title,event_year,event_date,status FROM ingest.ephemerides WHERE original_artist_id=6807')).rows;
checks.deletedTargets=(await p.query('SELECT id,name FROM public.persons WHERE id=ANY($1::bigint[])',[[42305,42324,42333,42438,42447,42448,42449,42453,42459,42465,42466,42467,42470,42458]])).rows;
checks.missingAlbumMetadata=(await p.query("SELECT d.id,d.metadata->>'albumId' album_id FROM media.artist_documents d WHERE d.metadata->>'supplement'='wayback-restantes-2026-10-23' AND d.metadata->>'albumId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.albums a WHERE a.id=(d.metadata->>'albumId')::bigint)")).rows;
checks.missingPersonMetadata=(await p.query("SELECT d.id,c FROM media.artist_documents d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.metadata->'resolvedCredits','[]'::jsonb)) c WHERE d.metadata->>'supplement'='wayback-restantes-2026-10-23' AND c->>'personId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.persons p WHERE p.id=(c->>'personId')::bigint)")).rows;
checks.duplicateNewPublications=(await p.query('SELECT artist_id,lower(title) title,array_agg(id) ids FROM public.albums WHERE artist_id=ANY($1::bigint[]) GROUP BY artist_id,lower(title) HAVING count(*)>1',[[7798,7799,7800]])).rows;
checks.loocilaGallery=(await p.query('SELECT id,title,description FROM media.artist_gallery WHERE artist_id=7463')).rows;
checks.albums=(await p.query('SELECT id,title,release_year,release_date_text,(SELECT count(*)::int FROM public.tracks t WHERE t.album_id=a.id) tracks FROM public.albums a WHERE id=ANY($1::bigint[]) ORDER BY id',[[2034,3609,5592,30342,2736,3276,738,2943,27548,34047]])).rows;
checks.http=[];
for(const id of [7798,7799,101,2794,4586,6806,257,7463]){
 try{const response=await fetch('http://127.0.0.1:8080/artists/'+id,{signal:AbortSignal.timeout(15000)});const body=await response.json() as any;checks.http.push({id,status:response.status,name:body.name??body.data?.name,documents:body.documents?.length,gallery:body.gallery?.length,audiovisuals:body.audiovisuals?.length,missingWrongManaoAward:!body.documents?.some((d:any)=>Number(d.id)===1500)});}catch(e){checks.http.push({id,error:String(e)});}
}
writeFileSync(out+'/verificacion-integridad.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));await closeDb();
