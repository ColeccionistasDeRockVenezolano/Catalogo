import {writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;
if(!out)throw new Error('WAYBACK_OUT obligatorio');
for(const [name,sql] of Object.entries({documents:'SELECT * FROM media.artist_documents',person_aliases:'SELECT * FROM ingest.person_aliases',credits:'SELECT * FROM public.album_credits',members:'SELECT * FROM public.artist_members',videos:"SELECT * FROM media.artist_audiovisuals WHERE metadata->>'campaign'='archivo-wayback-2026-10-22'"})){
 const rows=(await getPool().query(sql)).rows;
 writeFileSync(out+'/antes-'+name+'.json',JSON.stringify(rows));console.log(name,rows.length);
}
await closeDb();
