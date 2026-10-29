import {writeFileSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
import {YouTubeDataApi} from '../../src/youtube/api.js';
const p=getPool(),out=process.env['WAYBACK_OUT']!;const data:any={};
data.sources=(await p.query("SELECT DISTINCT c.album_id,c.person_id,r.url,r.canonical_url,r.stored_path FROM ingest.claims c JOIN ingest.raw_pages r ON r.id=c.raw_page_id WHERE c.album_id=ANY($1::bigint[]) OR c.person_id=ANY($2::bigint[])",[[630,655,23178,2671],[30108,15985,34358,12791,34302,29208,2651]])).rows;
data.evidence=(await p.query("SELECT DISTINCT c.person_id,e.url,e.excerpt FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id=c.id WHERE c.person_id=ANY($1::bigint[])",[[30108,15985,34358,12791,34302,29208,2651]])).rows;
data.videos=(await p.query("SELECT v.*,va.album_id FROM media.youtube_videos v LEFT JOIN media.video_albums va ON va.video_id=v.id WHERE v.video_id=ANY($1::text[]) OR va.album_id=ANY($2::bigint[])",[['nrctsTnYo7o','d_aIiMjuXFM'],[630,655]])).rows;
data.timestamps=(await p.query("SELECT vt.*,t.title,t.album_id,v.video_id youtube_id FROM media.video_tracks vt JOIN public.tracks t ON t.id=vt.track_id JOIN media.youtube_videos v ON v.id=vt.video_id WHERE t.album_id=ANY($1::bigint[]) ORDER BY t.album_id,vt.start_seconds",[[630,655]])).rows;
data.chapters=(await p.query("SELECT s.*,v.video_id youtube_id FROM media.youtube_tracklist_entries s JOIN media.youtube_videos v ON v.id=s.video_id WHERE v.video_id=ANY($1::text[])",[['nrctsTnYo7o','d_aIiMjuXFM']])).rows;
try{data.officialApi=await new YouTubeDataApi().listVideos(['nrctsTnYo7o','d_aIiMjuXFM']);}catch(e){data.apiError=String(e);}
writeFileSync(out+'/repertorio-y-procedencias.json',JSON.stringify(data,null,2));console.log(JSON.stringify(data,null,2));await closeDb();
