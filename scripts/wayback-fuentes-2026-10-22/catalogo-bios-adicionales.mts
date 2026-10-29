import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {getPool,closeDb} from '../../src/db/client.js';
import {WAYBACK_ARCHIVE_TAG as TAG} from '../../src/shared/artist-documents.js';
const O=process.env['WAYBACK_OUT']??`${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const path=join(O,'expedientes-artistas.jsonl');const cases=readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));const known=new Set(cases.map(c=>c.key));
const docs=(await getPool().query(`SELECT d.*,a.name,a.biography,a.origin_city,a.origin_country,a.formed_year,a.artist_type,
 coalesce((SELECT jsonb_agg(jsonb_build_object('name',p.name,'role',m.role)) FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=a.id),'[]') members
 FROM media.artist_documents d JOIN ingest.catalog_artists a ON a.id=d.artist_id
 WHERE d.tags @> $1::text[] AND d.source_key LIKE $2 AND d.category IN ('biography','review','news','article')`,[[TAG],TAG+':document:%'])).rows;
const groups=new Map<number,any[]>();for(const d of docs){const id=Number(d.artist_id);if(!groups.has(id))groups.set(id,[]);groups.get(id)!.push(d);}
let added=0;
for(const [id,ds] of groups){const key='document-bio:'+id;if(known.has(key))continue;
 const a=ds[0];const evidence=ds.map(d=>({url:d.source_url,wayback:d.archive_url,cita:d.metadata?.evidence?.cita??'',title:d.title}));
 cases.push({key,name:a.name,candidates:[{id,name:a.name,biography:a.biography,origin_city:a.origin_city,origin_country:a.origin_country,formed_year:a.formed_year,artist_type:a.artist_type,members:a.members}],source:{biografia:ds.map(d=>d.title+'\n'+d.content).join('\n\n'),evidencia:{...evidence[0],sources:evidence}},scope:'Documentos históricos del archivo (sello, reseñas, noticias, biografías). Extraídos de capturas ya conservadas; no son fuentes independientes nuevas. Conservar todos los hechos actuales y sumar sólo hechos biográficos documentados. No convertir reseñas en opiniones propias ni desde/fecha de publicación en año de formación. Una formación histórica o un anuncio no prueban actividad actual.'});added++;
}
writeFileSync(path,cases.map(c=>JSON.stringify(c)).join('\n')+'\n');console.log({added,total:cases.length});await closeDb();
