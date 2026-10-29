import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT'] ?? `${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
mkdirSync(out,{recursive:true});
const queries:Record<string,string>={
 artists:`SELECT a.*,coalesce((SELECT jsonb_agg(jsonb_build_object('name',p.name,'personId',p.id,'role',m.role,'isCurrent',m.is_current)) FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=a.id),'[]') members FROM public.artists a`,
 albums:`SELECT a.*,r.name artist_name FROM public.albums a JOIN public.artists r ON r.id=a.artist_id`,
 tracks:'SELECT t.id,t.title,t.track_number,t.disc_number,t.album_id,a.artist_id,t.duration_seconds FROM public.tracks t JOIN public.albums a ON a.id=t.album_id',
 persons:'SELECT id,name,real_name,biography FROM public.persons',
 organizations:'SELECT id,name,organization_type FROM public.organizations',
 artist_aliases:'SELECT * FROM ingest.artist_aliases',album_aliases:'SELECT * FROM ingest.album_aliases',
 exclusions:'SELECT * FROM ingest.artist_editorial_policy',
 table_columns:`SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('public','media','ingest') AND table_name IN ('album_credits','track_credits','artist_members','album_versions','sources','source_profiles','artist_audiovisuals','youtube_videos','genre_assertions','artist_gallery','album_classifications')`,
 counts:`SELECT (SELECT count(*) FROM public.artists)::int artists,(SELECT count(*) FROM public.albums)::int albums,(SELECT count(*) FROM public.tracks)::int tracks`,
};
for(const [name,sql] of Object.entries(queries)){const rows=(await getPool().query(sql)).rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='string'&&/^(?:id|.*_id)$/.test(k)&&/^\d+$/.test(v)?Number(v):v])));writeFileSync(join(out,`antes-${name}.json`),JSON.stringify(rows));console.log(name,rows.length);}
await closeDb();
