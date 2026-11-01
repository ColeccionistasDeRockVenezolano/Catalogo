/** Recover Elementor's data-settings and iframe video inventory; default is rollback. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { audiovisualKey } from '../src/youtube/audiovisual-rules.js';

const root=process.argv[2];
if(!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
type Row={artist:string;source:string;videoId:string;videoUrl:string;widgetId:string|null;element:string};
type Video={id:string;snippet:{title:string;description?:string;channelId?:string;channelTitle?:string;publishedAt?:string;thumbnails?:Record<string,{url:string}>};status:Record<string,unknown>;contentDetails:Record<string,unknown>};
const rows=(JSON.parse(readFileSync(path.join(root,'elementor-extract.json'),'utf8')) as {rows:Row[]}).rows;
const ids=[...new Set(rows.map(r=>r.videoId))];
const apiKey=process.env['YOUTUBE_API_KEY'] ?? /^YOUTUBE_API_KEY=(.+)$/m.exec(readFileSync('.env','utf8'))?.[1]?.trim();
if(!apiKey) throw new Error('Falta clave de YouTube');
const found=new Map<string,Video>();
for(let i=0;i<ids.length;i+=50){
 const api=new URL('https://www.googleapis.com/youtube/v3/videos');
 api.search=new URLSearchParams({part:'snippet,status,contentDetails',id:ids.slice(i,i+50).join(','),key:apiKey}).toString();
 const response=await fetch(api,{signal:AbortSignal.timeout(30000)});
 if(!response.ok) throw new Error(`YouTube API: ${response.status}`);
 const data=await response.json() as {items:Video[]};
 for(const v of data.items) found.set(v.id,v);
}
writeFileSync(path.join(root,'youtube-metadata.json'),JSON.stringify({requested:ids,items:[...found.values()],queriedAt:new Date().toISOString()},null,2));
function kind(title:string):string {
 const s=title.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 if(/documental|documentary/.test(s))return 'documentary';
 if(/entrevista|interview/.test(s))return 'interview';
 if(/en vivo|concierto|sesion|acustic|unplugged|\blive\b/.test(s))return 'live_concert';
 if(/#shorts?\b/.test(s))return 'short';
 if(/videoclip|video oficial|official video|video musical/.test(s))return 'music_video';
 return 'other';
}
function seconds(value:unknown):number|null {
 if(typeof value!=='string') return null;
 const match=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(value);
 return match ? Number(match[1]??0)*3600+Number(match[2]??0)*60+Number(match[3]??0) : null;
}
try {
 const outcome=await withOperatorRun({name:'rhv:elementor-videos-2026-11-01',operator:'codex',note:'Brian: recuperar todos los reproductores Elementor, incluidos data-settings e iframe, conservando videos no disponibles',params:{pages:new Set(rows.map(r=>r.source)).size,videos:ids.length}},async ctx=>{
  await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('rhv:elementor-videos-2026-11-01'))");
  const docs=(await ctx.client.query<{artistId:number;url:string}>(`SELECT DISTINCT artist_id::int "artistId",source_url url FROM media.artist_documents WHERE source_url LIKE 'https://rockhechovenezuela.com/%'`)).rows;
  const result={created:[] as unknown[],existing:[] as unknown[],review:[] as unknown[],missingApi:[] as unknown[]};
  const unique=new Map(rows.map(row=>[`${row.source}|${row.videoId}`,row]));
  for(const r of unique.values()){
   const artists=[...new Set(docs.filter(d=>d.url===r.source).map(d=>d.artistId))];
   if(artists.length!==1){result.review.push({...r,reason:'identidad ambigua o sin fuente vinculada',artists});continue;}
   const artist=artists[0]!; const video=found.get(r.videoId);
   if(!video) result.missingApi.push({source:r.source,videoId:r.videoId});
   let vid=(await ctx.client.query<{id:number}>('SELECT id::int FROM media.youtube_videos WHERE video_id=$1',[r.videoId])).rows[0]?.id;
   const title=video?.snippet.title || `Video de ${r.artist}`;
   if(!vid){
    const added=await ctx.client.query<{id:number}>(`INSERT INTO media.youtube_videos(video_id,url,title,description,channel_id,channel_title,published_at,publication_status,metadata,last_fetched_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,CASE WHEN $10::boolean THEN now() ELSE NULL END) ON CONFLICT(video_id) DO NOTHING RETURNING id::int`,[r.videoId,`https://www.youtube.com/watch?v=${r.videoId}`,title,video?.snippet.description??null,video?.snippet.channelId??null,video?.snippet.channelTitle??null,video?.snippet.publishedAt??null,video ? video.status['privacyStatus']==='public'?'published':video.status['privacyStatus']==='unlisted'?'unlisted':'unpublished' : 'unknown',JSON.stringify(video??{source:r.source,campaign:'rhv-elementor-2026-11-01'}),!!video]);
    vid=added.rows[0]?.id ?? (await ctx.client.query<{id:number}>('SELECT id::int FROM media.youtube_videos WHERE video_id=$1',[r.videoId])).rows[0]?.id;
   }
   if(!vid) throw new Error(`No se pudo registrar ${r.videoId}`);
   if(video) await ctx.client.query(`UPDATE media.youtube_videos SET thumbnail_url=coalesce(thumbnail_url,$2),duration_seconds=coalesce(duration_seconds,$3)
     WHERE id=$1 AND (thumbnail_url IS NULL OR duration_seconds IS NULL)`,[vid,video.snippet.thumbnails?.['high']?.url??video.snippet.thumbnails?.['default']?.url??null,seconds(video.contentDetails['duration'])]);
   const existing=(await ctx.client.query<{artistId:number}>('SELECT artist_id::int "artistId" FROM media.artist_audiovisuals WHERE video_id=$1',[vid])).rows;
   if(existing.some(e=>e.artistId===artist)){result.existing.push({source:r.source,videoId:r.videoId,artist});continue;}
   if(existing.length){result.review.push({...r,reason:'video asociado a otro artista',artist,existing});continue;}
   const inserted=await ctx.client.query(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,title,title_key,release_year,kind,source_type,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'rockhecho',$8::jsonb) ON CONFLICT DO NOTHING RETURNING id`,[artist,`rhv-elementor:${r.videoId}`,vid,title,audiovisualKey(title),video?.snippet.publishedAt?Number(video.snippet.publishedAt.slice(0,4)):null,kind(title),JSON.stringify({ficha:r.source,videoUrl:r.videoUrl,widgetId:r.widgetId,campaign:'rhv-elementor-2026-11-01'})]);
   if(inserted.rowCount){await ctx.client.query("INSERT INTO media.video_artists(video_id,artist_id,relation_kind,confidence) VALUES($1,$2,'subject','high') ON CONFLICT DO NOTHING",[vid,artist]);result.created.push({source:r.source,videoId:r.videoId,artist,title,kind:kind(title)});}
  }
  for(const item of result.review as Array<Row & {reason:string;artist?:number}>) {
   const reviewKey=`rhv-elementor:${item.source}:${item.videoId}`;
   await ctx.client.query(`INSERT INTO ingest.review_queue(kind,artist_a_id,payload,notes)
    SELECT 'manual_review',$1,$2::jsonb,$3 WHERE NOT EXISTS
    (SELECT 1 FROM ingest.review_queue WHERE payload->>'rhvElementorKey'=$4)`,
   [item.artist??null,JSON.stringify({...item,rhvElementorKey:reviewKey,runId:ctx.runId}),`RHV Elementor: ${item.reason}`,reviewKey]);
  }
  return result;
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,confirm?'applied.json':'rehearsal.json'),JSON.stringify(outcome,null,2));
 console.log(JSON.stringify({confirmed:confirm,runId:outcome.runId,rows:rows.length,apiFound:found.size,created:outcome.result.created.length,existing:outcome.result.existing.length,review:outcome.result.review.length,missingApi:outcome.result.missingApi.length}));
} finally {await closeDb();}
