import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { audiovisualKey } from '../src/youtube/audiovisual-rules.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const key=process.env['YOUTUBE_API_KEY']??/^YOUTUBE_API_KEY=(.+)$/m.exec(readFileSync('.env','utf8'))?.[1]?.trim();
if(!key)throw new Error('Falta clave de YouTube');
const url=new URL('https://www.googleapis.com/youtube/v3/videos');url.search=new URLSearchParams({part:'snippet,status,contentDetails',id:'oOkV_owPp20',key}).toString();
const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`YouTube API ${response.status}`);
type Video={id:string;snippet:{title:string;description:string;channelId:string;channelTitle:string;publishedAt:string;thumbnails:Record<string,{url:string}>};status:Record<string,unknown>;contentDetails:{duration:string}};
const data=await response.json() as {items:Video[]};const video=data.items[0];
if(!video||video.id!=='oOkV_owPp20'||!video.snippet.description.toLowerCase().includes('entrevistado'))throw new Error('Entrevista no confirmada por la API');
writeFileSync(path.join(root,'leyendas-joseito-youtube.json'),JSON.stringify({url:'https://rockhechovenezuela.com/blog/joseito-romero/',capturedAt:new Date().toISOString(),video},null,2));
const dur=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(video.contentDetails.duration);
const duration=dur?Number(dur[1]??0)*3600+Number(dur[2]??0)*60+Number(dur[3]??0):null;
try{
 const outcome=await withOperatorRun({name:'rhv:leyendas-joseito-interview',operator:'codex',note:'La página Leyendas de RHV incrusta esta entrevista de Joseito Romero con Alfredo Escalante.',params:{source:'https://rockhechovenezuela.com/blog/joseito-romero/',videoId:video.id}},async ctx=>{
  const matched=await ctx.client.query(`SELECT 1 FROM media.artist_documents WHERE artist_id=6661 AND source_url='https://rockhechovenezuela.com/j/joseito-romero/'`);
  if(!matched.rowCount)throw new Error('Cambió la identidad del artista');
  const insert=await ctx.client.query<{id:number}>(`INSERT INTO media.youtube_videos(video_id,url,title,description,channel_id,channel_title,published_at,duration_seconds,thumbnail_url,publication_status,metadata,last_fetched_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now()) ON CONFLICT(video_id) DO NOTHING RETURNING id::int`,[video.id,`https://www.youtube.com/watch?v=${video.id}`,video.snippet.title,video.snippet.description,video.snippet.channelId,video.snippet.channelTitle,video.snippet.publishedAt,duration,video.snippet.thumbnails['high']?.url??null,video.status['privacyStatus']==='public'?'published':video.status['privacyStatus']==='unlisted'?'unlisted':'unpublished',JSON.stringify(video)]);
  const vid=insert.rows[0]?.id??(await ctx.client.query<{id:number}>('SELECT id::int FROM media.youtube_videos WHERE video_id=$1',[video.id])).rows[0]!.id;
  const existing=(await ctx.client.query<{artistId:number}>('SELECT artist_id::int "artistId" FROM media.artist_audiovisuals WHERE video_id=$1',[vid])).rows;
  if(existing.length)return {created:false,existing};
  const added=await ctx.client.query(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,title,title_key,release_year,kind,source_type,metadata) VALUES(6661,$1,$2,$3,$4,$5,'interview','rockhecho',$6::jsonb) ON CONFLICT DO NOTHING RETURNING id`,[`rhv-leyendas:${video.id}`,vid,video.snippet.title,audiovisualKey(video.snippet.title),Number(video.snippet.publishedAt.slice(0,4)),JSON.stringify({ficha:'https://rockhechovenezuela.com/blog/joseito-romero/',campaign:'rhv-integral-2026-11-01'})]);
  if(added.rowCount)await ctx.client.query("INSERT INTO media.video_artists(video_id,artist_id,relation_kind,confidence) VALUES($1,6661,'subject','high') ON CONFLICT DO NOTHING",[vid]);
  return {created:!!added.rowCount,existing};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`leyendas-joseito-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(outcome,null,2));console.log(JSON.stringify({confirmed:confirm,...outcome}));
}finally{await closeDb();}
