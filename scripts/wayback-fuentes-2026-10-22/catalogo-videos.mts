import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {getPool,closeDb} from '../../src/db/client.js';import {withOperatorRun} from '../../src/merge/operator.js';import {syncYouTubeVideo} from '../../src/youtube/pipeline.js';
import {WAYBACK_ARCHIVE_TAG as TAG} from '../../src/shared/artist-documents.js';
const O=process.env['WAYBACK_OUT']??`${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const D=readFileSync('reports/wayback-analisis-catalogo-2026-10-22/paginas-compactas.jsonl','utf8').trim().split('\n').map(x=>JSON.parse(x));
const pool=getPool();const A=(await pool.query('SELECT id::int,name FROM ingest.catalog_artists')).rows;
const key=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const find=(name:string)=>{const rs=A.filter(a=>key(a.name)===key(name));return rs.length===1?rs[0].id:null;};
const candidates:any[]=[];const seen=new Set<string>();
for(const d of D){
 if(d.site==='caracaspunk'&&/\/videos\.asp$/.test(d.url)){
  const blocks=[...d.texto.matchAll(/Video\s+de\s+(.*?)\s+Cancion\s*-\s*(.*?)\s+Archivo/gs)];
  const links=d.enlaces_internos.filter((l:any)=>/\.(?:mov|wmv|wmp|mpg|mpeg|avi|rm)(?:[?#]|$)/i.test(l.href));
  for(let n=0;n<blocks.length;n++){const name=blocks[n]![1]!.replace(/\s+/g,' ').trim(),title=blocks[n]![2]!.replace(/\s+/g,' ').trim();const id=find(name);
   if(!id||!links[n]||/^['_"\s]+$/.test(title))continue;
   candidates.push({artistId:id,artist:name,title,url:links[n].href,youtubeId:null,sourceUrl:d.url,archiveUrl:'https://web.archive.org/web/'+d.ts+'/'+d.url,year:null});
  }
 }
 if(d.site==='lagaleriadelrock'&&d.url.includes('/videos/'))for(const url of d.marcos??[]){
  const match=String(url).match(/youtu(?:\.be\/|be\.com\/(?:embed\/|v\/|watch\?v=))([a-zA-Z0-9_-]{11})/);if(!match)continue;
  candidates.push({artistId:257,artist:'Various Artists',title:'Festival Nuevas Bandas 2013 — resumen de La Galería del Rock',url:'https://www.youtube.com/watch?v='+match[1],youtubeId:match[1],sourceUrl:d.url,archiveUrl:'https://web.archive.org/web/'+d.ts+'/'+d.url,year:2013});
 }
}
writeFileSync(join(O,'videos-candidatos.jsonl'),candidates.map(r=>JSON.stringify(r)).join('\n')+'\n');let preserved=0,playable=0;
for(const r of candidates){const k=r.artistId+':'+(r.youtubeId??r.url);if(seen.has(k))continue;seen.add(k);
 if(r.youtubeId)try{await syncYouTubeVideo(r.youtubeId);}catch(e){appendFileSync(join(O,'videos-verificacion.jsonl'),JSON.stringify({...r,error:String(e)})+'\n');}
 const video=r.youtubeId?(await pool.query('SELECT id,publication_status,metadata,title FROM media.youtube_videos WHERE video_id=$1',[r.youtubeId])).rows[0]:null;
 const isPlayable=video&&['published','unlisted'].includes(video.publication_status)&&video.metadata?.status?.embeddable===true;
 const sourceKey=TAG+':video:'+createHash('sha256').update(k).digest('hex').slice(0,24);
 const metadata={campaign:TAG,tags:[TAG,'video-historico'],originalUrl:r.url,sourceUrl:r.sourceUrl,archiveUrl:r.archiveUrl,youtubeId:r.youtubeId,availabilityChecked:!!r.youtubeId,archiveBinaryPlayable:false};
 const result=await withOperatorRun({name:'wayback:audiovisual',operator:'codex',note:'Incorporación autorizada del archivo audiovisual histórico, conservando evidencia y publicando sólo reproducción confirmada por YouTube.',params:{artistId:r.artistId,campaign:TAG}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  const existing=video?(await ctx.client.query('SELECT id,metadata FROM media.artist_audiovisuals WHERE artist_id=$1 AND video_id=$2',[r.artistId,video.id])).rows[0]:null;
  if(existing){const tags=[...new Set([...(Array.isArray(existing.metadata?.tags)?existing.metadata.tags:[]),...metadata.tags])];await ctx.client.query('UPDATE media.artist_audiovisuals SET metadata=metadata||$2::jsonb,updated_at=now() WHERE id=$1',[existing.id,JSON.stringify({...metadata,tags})]);}
  else await ctx.client.query(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,title,title_key,release_year,kind,description,source_type,metadata)
   VALUES($1,$2,$3,$4,$5,$6,'other',$7,'Archivo histórico',$8::jsonb) ON CONFLICT(artist_id,source_key) DO NOTHING`,[r.artistId,sourceKey,video?.id??null,video?.title??r.title,key(video?.title??r.title),r.year,'Video documentado en el archivo histórico. La captura de una página o enlace no demuestra reproducción disponible.',JSON.stringify(metadata)]);
  if(!isPlayable)await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,archive_url,tags,metadata)
   VALUES($1,$2,'other',$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(artist_id,source_key) DO NOTHING`,[r.artistId,sourceKey,`${r.title} — referencia audiovisual`,`${r.title}\n\nEl archivo conserva un enlace a este video. La copia reproducible no está confirmada; el registro audiovisual se mantiene fuera del reproductor público.`,r.sourceUrl,r.archiveUrl,[TAG,'audiovisual','reproduccion-no-confirmada'],JSON.stringify(metadata)]);
 });preserved++;if(isPlayable)playable++;appendFileSync(join(O,'videos-aplicados.jsonl'),JSON.stringify({...r,playable:!!isPlayable,runId:result.runId})+'\n');
}
writeFileSync(join(O,'resultado-videos.json'),JSON.stringify({preserved,playable},null,2));console.log({preserved,playable});await closeDb();
