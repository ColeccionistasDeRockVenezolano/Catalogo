import {writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
import {YouTubeDataApi} from '../../src/youtube/api.js';
const out=process.env['WAYBACK_OUT']!;
const ids=[237,1159,450,1163,1755,257];
const rows=(await getPool().query(`SELECT av.id,av.artist_id,av.title,av.kind,av.source_key,v.id youtube_row_id,v.video_id,v.title youtube_title,v.publication_status,v.metadata FROM media.artist_audiovisuals av LEFT JOIN media.youtube_videos v ON v.id=av.video_id WHERE av.artist_id=ANY($1::bigint[]) ORDER BY av.artist_id,av.title`,[ids])).rows;
writeFileSync(out+'/videos-catalogo-candidatos.json',JSON.stringify(rows,null,2));
const query=rows.filter(r=>r.video_id&&/ni[ñn]o|militar|kaos|siempre|ne[gc]rofilia|verdad|cabron|cabrón|barricadas|politica|política|Nuevas Bandas 2013/i.test(r.title));
let result:any;try{result=await new YouTubeDataApi().listVideos([...new Set(['N_VnciWBL-I',...query.map(r=>r.video_id)])]);}catch(e){result={error:String(e)};}
writeFileSync(out+'/youtube-api-verificacion.json',JSON.stringify({consultedAt:new Date().toISOString(),candidates:query,api:result},null,2));
console.log({catalogueRows:rows.length,candidates:query.map(r=>({id:r.id,artist:r.artist_id,title:r.title,video:r.video_id})),returned:result.items?.length,error:result.error});
await closeDb();
