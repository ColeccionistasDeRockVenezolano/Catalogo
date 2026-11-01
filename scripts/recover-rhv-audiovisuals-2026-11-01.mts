import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { audiovisualKey } from '../src/youtube/audiovisual-rules.js';

const root=process.argv[2];
if(!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const entries=[
  {id:'2i62HEx15Iw',url:'https://rockhechovenezuela.com/a/arkangel/',kind:'live_concert'},
  {id:'BnPmBj6qP8I',url:'https://rockhechovenezuela.com/a/atiko/',kind:'live_concert'},
  {id:'z3_89y3Ukcs',url:'https://rockhechovenezuela.com/b/belica/',kind:'music_video'},
  {id:'8EISNsME568',url:'https://rockhechovenezuela.com/b/blush-magenta/',kind:'live_concert'},
];
const key=process.env['YOUTUBE_API_KEY'] ?? /^YOUTUBE_API_KEY=(.+)$/m.exec(readFileSync('.env','utf8'))?.[1]?.trim();
if(!key) throw new Error('Falta clave de YouTube');
const api=new URL('https://www.googleapis.com/youtube/v3/videos');
api.search=new URLSearchParams({part:'snippet,status,contentDetails',id:entries.map(e=>e.id).join(','),key}).toString();
const response=await fetch(api,{signal:AbortSignal.timeout(30000)});
if(!response.ok) throw new Error(`YouTube API ${response.status}`);
type Video={id:string;snippet:{title:string;description?:string;channelId?:string;channelTitle?:string;publishedAt?:string};status:Record<string,unknown>;contentDetails:Record<string,unknown>};
const data=await response.json() as {items:Video[]};
const found=new Map(data.items.map(v=>[v.id,v]));
try {
 const outcome=await withOperatorRun({name:'rhv:recover-audiovisuals-2026-11-01',operator:'codex',note:'Videos incrustados omitidos y videos no incrustables previamente omitidos, con fuente RHV y estado de YouTube conservado',params:{videos:entries.length}},async ctx=>{
  const result={created:[] as unknown[],skipped:[] as unknown[]};
  for(const e of entries){
   const video=found.get(e.id); if(!video){result.skipped.push({...e,reason:'API no devuelve ficha'});continue;}
   const docs=(await ctx.client.query<{artistId:number}>('SELECT DISTINCT artist_id::int "artistId" FROM media.artist_documents WHERE source_url=$1',[e.url])).rows;
   const artist=docs.length===1?docs[0]!.artistId:undefined;
   if(!artist){result.skipped.push({...e,reason:'identidad o URL requiere verificación',docs});continue;}
   const existing=(await ctx.client.query<{id:number}>('SELECT id::int FROM media.youtube_videos WHERE video_id=$1',[e.id])).rows[0];
   let vid=existing?.id;
   if(!vid){const added=await ctx.client.query<{id:number}>(`INSERT INTO media.youtube_videos(video_id,url,title,description,channel_id,channel_title,published_at,publication_status,metadata,last_fetched_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now()) ON CONFLICT(video_id) DO NOTHING RETURNING id::int`,[e.id,`https://www.youtube.com/watch?v=${e.id}`,video.snippet.title,video.snippet.description??null,video.snippet.channelId??null,video.snippet.channelTitle??null,video.snippet.publishedAt??null,video.status['privacyStatus']==='public'?'published':video.status['privacyStatus']==='unlisted'?'unlisted':'unpublished',JSON.stringify(video)]); vid=added.rows[0]?.id;}
   if(!vid){result.skipped.push({...e,reason:'alta concurrente'});continue;}
   const associated=(await ctx.client.query<{artistId:number}>('SELECT artist_id::int "artistId" FROM media.artist_audiovisuals WHERE video_id=$1',[vid])).rows;
   if(associated.length){result.skipped.push({...e,reason:'video ya catalogado',associated});continue;}
   const inserted=await ctx.client.query(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,title,title_key,release_year,kind,source_type,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'rockhecho',$8::jsonb) ON CONFLICT DO NOTHING RETURNING id`,[artist,`rhv-2026-11-01:${e.id}`,vid,video.snippet.title,audiovisualKey(video.snippet.title),video.snippet.publishedAt?Number(video.snippet.publishedAt.slice(0,4)):null,e.kind,JSON.stringify({ficha:e.url,campaign:'rhv-completo-2026-11-01'})]);
   if(inserted.rowCount){await ctx.client.query("INSERT INTO media.video_artists(video_id,artist_id,relation_kind,confidence) VALUES($1,$2,'performer','high') ON CONFLICT DO NOTHING",[vid,artist]); result.created.push({...e,artist,title:video.snippet.title});}
  }
  return result;
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,confirm?'audiovisuals-applied.json':'audiovisuals-rehearsal.json'),JSON.stringify(outcome,null,2));
 console.log(JSON.stringify({confirmed:confirm,runId:outcome.runId,...outcome.result}));
} finally {await closeDb();}
