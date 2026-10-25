import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {load} from 'cheerio';
import type pg from 'pg';
import {getPool,closeDb} from '../src/db/client.js';
import {withOperatorRun} from '../src/merge/operator.js';
import {corroboratesPlaybackAlbum,corroboratesPlaybackRepertoire,corroboratedPlaybackMembers,playbackIdentityKey as key,type PlaybackCatalogAlbum} from '../src/verification/artist-player-recovery.js';
import {streamingImportDisposition} from '../src/verification/streaming-import.js';

const root='reports/reproductores-pendientes-2026-10-18';
const confirm=process.argv.includes('--confirm');
interface Pin {path:string;sha256:string;url?:string}
interface Job {kind:'profile_identifier'|'album_link'|'artist_track';artistId:number;albumId?:number;catalogAlbumId?:number|null;linkId?:number;url:string;platform?:string;externalId:string;basis:string;title?:string;albumTitle?:string;artistName?:string;releaseYear?:number;sharedTracks?:string[];biographyMatches?:string[];pins:Pin[]}
interface Artist {name:string;biography:string|null;originCity:string|null;members:Array<{id:number;name:string;role:string}>;aliases:string[];albums:PlaybackCatalogAlbum[]}
interface SourceRelease {artist:string;title:string;year:number|null;tracks:string[];id:number;type:string}
interface Tralbum {artist:string;current:{title:string;id:number;type:string;release_date?:string;about?:string;credits?:string};album_release_date?:string;trackinfo:Array<{title:string}>}
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const plan=JSON.parse(readFileSync(`${root}/plan.json`,'utf8')) as Job[];
const adjudications=JSON.parse(readFileSync(`${root}/identidades-adjudicadas.json`,'utf8')) as Array<{artistId:number;reason:string;catalogSnapshot:Pick<Artist,'biography'|'originCity'|'members'>;pins:Pin[]}>;
async function artist(client:pg.PoolClient,id:number):Promise<Artist>{
  return (await client.query<Artist>(`SELECT a.name,a.biography,a.origin_city "originCity",
    ARRAY(SELECT alias FROM ingest.artist_aliases WHERE artist_id=a.id) aliases,
    coalesce((SELECT json_agg(json_build_object('id',p.id,'name',p.name,'role',m.role)) FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=a.id),'[]'::json) members,
    coalesce((SELECT json_agg(json_build_object('id',al.id,'title',al.title,'year',al.release_year,'tracks',coalesce((SELECT json_agg(t.title ORDER BY t.disc_number,t.track_number) FROM public.tracks t WHERE t.album_id=al.id),'[]'::json))) FROM public.albums al WHERE al.artist_id=a.id),'[]'::json) albums
    FROM public.artists a WHERE id=$1 FOR SHARE`,[id])).rows[0]!;
}
function sources(job:Job):{releases:SourceRelease[];bio:string;titles:string[];listed:Set<string>}{
  const releases:SourceRelease[]=[],titles:string[]=[];let bio='';const listed=new Set<string>();
  for(const pin of job.pins){
    const body=readFileSync(pin.path);if(hash(body)!==pin.sha256)throw new Error('Cambió una captura');
    if(!pin.path.endsWith('.html'))continue;
    const $=load(body.toString());bio+=' '+$('#bio-text,#band-name-location,#band-bio').text();
    $('[data-item-id]').each((_,el)=>{listed.add($(el).attr('data-item-id')!);titles.push($(el).find('.title').text().trim());});
    $('[data-client-items]').each((_,el)=>{
      const items=JSON.parse($(el).attr('data-client-items')!) as Array<{type:string;id:number;title:string}>;
      for(const item of items)if(['album','track'].includes(item.type)&&Number.isSafeInteger(item.id)){listed.add(`${item.type}-${item.id}`);titles.push(item.title);}
    });
    $('[data-tralbum]').each((_,el)=>{
      const d=JSON.parse($(el).attr('data-tralbum')!) as Tralbum;
      if(!d.current)return;
      bio+=' '+(d.current.about??'')+' '+(d.current.credits??'');
      const year=/\b(?:19|20)\d{2}\b/u.exec(d.current.release_date??d.album_release_date??'');
      releases.push({artist:d.artist,title:d.current.title,id:d.current.id,type:d.current.type,year:year?Number(year[0]):null,tracks:d.trackinfo.map(t=>t.title)});
      listed.add(`${d.current.type}-${d.current.id}`);titles.push(d.current.title);
    });
  }
  return {releases,bio,titles,listed};
}
async function validate(client:pg.PoolClient,job:Job){
  const current=await artist(client,job.artistId);if(!current)throw new Error('Falta el artista');
  const proof=sources(job);const names=[current.name,...current.aliases];
  if(job.kind==='artist_track'){
    const raw=JSON.parse(readFileSync(job.pins[0]!.path,'utf8')) as {url:string;data:{description:string;title:string;html:string}};
    if(new URL(raw.url).searchParams.get('url')!==job.url||key(current.name)!=='gerson garcia'||!key(current.biography??'').includes('bandola')||!key(raw.data.description).includes('bandola llanera gerson garcia')||!raw.data.html.includes('224013250'))throw new Error('No se acredita al intérprete de bandola');
    return;
  }
  if(job.kind==='album_link'){
    const target=current.albums.find(album=>album.id===job.albumId);if(!target)throw new Error('Cambió el dueño del disco');
    if(job.platform==='bandcamp'){
      if(!job.pins.some(pin=>pin.url===job.url))throw new Error('Falta la captura de la URL musical');
      if(!proof.releases.some(s=>`album=${s.id}`===job.externalId&&corroboratesPlaybackAlbum(s,target,names)))throw new Error('La publicación Bandcamp no queda acreditada');
    }else{
      const raw=JSON.parse(readFileSync(job.pins[0]!.path,'utf8')) as {data:{id:number;title:string;release_date:string;artist:{name:string};tracks:{data:Array<{title:string}>}}};
      if(job.platform!=='deezer')throw new Error('Nueva plataforma exige validador específico');
      const d=raw.data;
      if(String(d.id)!==job.externalId||!corroboratesPlaybackAlbum({artist:d.artist.name,title:d.title,year:Number(d.release_date.slice(0,4)),tracks:d.tracks.data.map(t=>t.title)},target,names))throw new Error('La publicación Deezer no queda acreditada');
    }
    return;
  }
  const [type,id]=job.externalId.split('=');if(!['album','track'].includes(type??'')||!/^\d+$/u.test(id??'')||!proof.listed.has(`${type}-${id}`))throw new Error('El ID no está documentado en la captura');
  if(job.pins.some(pin=>pin.path.endsWith('.html')&&(!pin.url||new URL(pin.url).hostname!==new URL(job.url).hostname)))throw new Error('La captura no pertenece al perfil');
  const source=proof.releases.find(s=>s.id===Number(id)&&s.type===type);
  if(source&&current.albums.some(album=>corroboratesPlaybackAlbum(source,album,names)))return;
  if(source&&corroboratesPlaybackRepertoire(source,current.albums,names))return;
  if(corroboratedPlaybackMembers(proof.bio,current.members).length>=2)return;
  const quoted=new Set([...current.biography?.matchAll(/«([^»]+)»/gu)??[]].map(m=>key(m[1]!)));
  const shared=new Set(proof.titles.map(key).filter(title=>title.length>=6&&quoted.has(title)&&!names.map(key).includes(title)));
  if(shared.size>=2)return;
  const adjudicated=adjudications.find(row=>row.artistId===job.artistId);
  if(adjudicated&&adjudicated.catalogSnapshot.biography===current.biography&&adjudicated.catalogSnapshot.originCity===current.originCity
    &&JSON.stringify(adjudicated.catalogSnapshot.members.map(m=>m.id).sort())===JSON.stringify(current.members.map(m=>m.id).sort())
    &&adjudicated.pins.every(pin=>job.pins.some(p=>p.path===pin.path&&p.sha256===pin.sha256)))return;
  throw new Error(`Identidad sin corroboración para ${job.artistId}`);
}
async function main(){
  let pending=0;
  for(const job of plan){
    if(job.kind==='profile_identifier'){
      const row=(await getPool().query<{external_id:string|null}>('SELECT external_id FROM public.streaming_links WHERE id=$1',[job.linkId])).rows[0];
      if(!row||row.external_id!==job.externalId)pending++;
    }else{
      const column=job.kind==='album_link'?'album_id':'artist_id';
      const id=job.kind==='album_link'?job.albumId:job.artistId;
      const row=(await getPool().query<{url:string;source:string;verified:boolean}>(`SELECT url,source,verified FROM public.streaming_links WHERE ${column}=$1 AND platform=$2`,[id,job.platform])).rows[0];
      if(!['unchanged','protected'].includes(streamingImportDisposition(row,{url:job.url,verified:true})))pending++;
    }
  }
  if(!pending){writeFileSync(`${root}/repeticion.json`,JSON.stringify({pending:0,planned:plan.length},null,2)+'\n');console.log('0 cambios pendientes; sin run');return;}
  const outcomes:Array<{artistId:number;kind:string;status:string}>=[];
  const result=await withOperatorRun({name:'catalogo:reproductores-pendientes',operator:'Codex (encargo de Brian: resolver reproductores pendientes)',note:'Identificadores y publicaciones acreditados por repertorio, integrantes o adjudicación documentada. Conservar perfiles y enlaces aprobados; no crear discos ni pistas.',params:{planHash:hash(readFileSync(`${root}/plan.json`)),adjudicationsHash:hash(readFileSync(`${root}/identidades-adjudicadas.json`)),plan}},async context=>{
    for(const job of plan){
      await validate(context.client,job);
      if(job.kind==='profile_identifier'){
        const row=(await context.client.query<{external_id:string|null;url:string;verified:boolean}>('SELECT external_id,url,verified FROM public.streaming_links WHERE id=$1 AND artist_id=$2 AND platform=\'bandcamp\' FOR UPDATE',[job.linkId,job.artistId])).rows[0];
        if(!row||!row.verified||row.url!==job.url)throw new Error('Cambió el perfil verificado');
        if(row.external_id){if(row.external_id!==job.externalId)throw new Error('Identificador existente distinto');outcomes.push({artistId:job.artistId,kind:job.kind,status:'unchanged'});continue;}
        await context.client.query('UPDATE public.streaming_links SET external_id=$1 WHERE id=$2',[job.externalId,job.linkId]);
      }else{
        const col=job.kind==='album_link'?'album_id':'artist_id';const id=job.kind==='album_link'?job.albumId:job.artistId;
        const row=(await context.client.query<{url:string;source:string;verified:boolean}>(`SELECT url,source,verified FROM public.streaming_links WHERE ${col}=$1 AND platform=$2 FOR UPDATE`,[id,job.platform])).rows[0];
        const disposition=streamingImportDisposition(row,{url:job.url,verified:true});
        if(disposition==='unchanged'||disposition==='protected'){outcomes.push({artistId:job.artistId,kind:job.kind,status:disposition});continue;}
        await context.client.query(`INSERT INTO public.streaming_links(artist_id,album_id,platform,url,external_id,method,source,verified,notes) VALUES($1,$2,$3,$4,$5,'exact','crv-operador',true,$6)
          ON CONFLICT (${col},platform) WHERE ${col} IS NOT NULL DO UPDATE SET url=EXCLUDED.url,external_id=EXCLUDED.external_id,method=EXCLUDED.method,source=EXCLUDED.source,verified=true,notes=EXCLUDED.notes`,
          [job.kind==='artist_track'?job.artistId:null,job.kind==='album_link'?job.albumId:null,job.platform,job.url,job.externalId,`Fuente musical acreditada · ${job.title??job.albumTitle??''} · ${job.basis}. ${job.kind==='artist_track'?'Pieza colaborativa publicada por Miguel Siso; Gerson García acreditado en bandola llanera.':''}`]);
      }
      outcomes.push({artistId:job.artistId,kind:job.kind,status:'applied'});
    }
    return {applied:outcomes.filter(o=>o.status==='applied').length,outcomes};
  },{rollbackOnly:!confirm});
  writeFileSync(`${root}/aplicacion-${confirm?'real':'ensayo'}.json`,JSON.stringify({dryRun:!confirm,runId:confirm?result.runId:null,...result.result},null,2)+'\n');console.log(JSON.stringify({dryRun:!confirm,runId:result.runId,applied:result.result.applied}));
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
