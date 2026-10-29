import {writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
import {previewAlbumMerge} from '../../src/merge/album-merge.js';
const p=getPool(),out=process.env['WAYBACK_OUT']!;
const checks:any={};
checks.albums=(await p.query('SELECT * FROM public.albums WHERE id=ANY($1::bigint[])',[[33868,33960,33996,34038,33997,34039,33991,34037,2384,26643,34042]])).rows;
checks.tracks=(await p.query('SELECT * FROM public.tracks WHERE album_id=ANY($1::bigint[]) ORDER BY album_id,track_number,id',[[33996,34038,33997,34039,33991,34037,2384,26643]])).rows;
checks.documents=(await p.query("SELECT * FROM media.artist_documents WHERE id=ANY($1::bigint[]) OR metadata->>'albumId'=ANY($2::text[])",[[841,1218,1931,2075,2646],['33996','34038','33997','34039','33991','34037','2384','26643']])).rows;
checks.redirects=(await p.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='ingest' AND table_name LIKE '%redirect%' ORDER BY table_name,ordinal_position")).rows;
checks.laterRuns=(await p.query('SELECT * FROM ingest.scrape_runs WHERE id=ANY($1::bigint[])',[[31783,31784,31785,31786,32019,33221,33228,33261,33280,33293]])).rows;
checks.deletions=(await p.query("SELECT id,run_id,table_name,op,old_data,new_data FROM ingest.change_journal WHERE table_name='public.albums' AND row_pk->>'id'=ANY($1::text[]) ORDER BY id",[['33868','33960','34042']])).rows;
checks.previews=[];
for(const [keep,drop] of [[33991,34037],[33996,34038],[33997,34039],[2384,26643]]){
 const preview=await previewAlbumMerge(p,keep!,drop!);checks.previews.push({keep,drop,preview});
}
writeFileSync(out+'/investigacion-hallazgos.json',JSON.stringify(checks,null,2));
console.log(JSON.stringify(checks,null,2));await closeDb();
