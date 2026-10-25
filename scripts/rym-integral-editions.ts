import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb,getPool} from '../src/db/client.js';
import {OperatorError,withOperatorRun} from '../src/merge/operator.js';
import {writeEditorResource} from '../src/catalog/editor.js';
import {assertRymIdentity,normalizeRymIdentity as norm,readRymIdentityLedger,rymHref,verifyRymPin} from '../src/verification/rym-identity.js';
import {rymReleaseClassifications,rymTrackPositions,type RymPublicationInput,type RymTrackInput} from '../src/verification/rym-release-plan.js';
import {albumTitleEdition} from '../src/normalization/album-characteristics.js';
import {versionFormatOf} from '../src/discography/versions.js';
import {audiovisualKey,audiovisualKind} from '../src/youtube/audiovisual-rules.js';
import {rymCatalogKey,rymFormatKey,rymVideoOnlyMedium} from '../src/verification/rym-publication-identity.js';

const arg=(s:string)=>{const i=process.argv.indexOf(s);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir obligatorio');
const requestedPhase=arg('--phase')??'versions';if(!['versions','audiovisuals','all'].includes(requestedPhase))throw new Error('Fase desconocida');
const confirm=process.argv.includes('--confirm');
const jsonl=<T>(file:string):T[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as T);
interface Release extends RymPublicationInput{slug:string;href:string;url:string;artista_url:string;anio:number|null;catalog_no:string|null;pistas:RymTrackInput[];listeningLinks?:Record<string,Record<string,unknown>>;capturePins:Array<{path:string;sha256:string}>}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function main(phase:string){
 const ledger=readRymIdentityLedger(path.join(directory!,'identity-ledger.json'));
 const sources=jsonl<Release>(path.join(directory!,'corpus/albumes.jsonl'));
 const report={phase,runs:[] as number[],outcomes:[] as Array<Record<string,unknown>>,held:[] as Array<Record<string,unknown>>};
 const checked=new Set<string>();
 type Album={id:number;artist_id:number;title:string;release_year:number|null;catalog_id:string|null;media_format:string|null;aliases:string[];titles:string[]};
 const catalogAlbums=phase==='versions'?(await getPool().query<Album>(`SELECT a.id::int,a.artist_id::int,a.title,a.release_year,a.catalog_id,a.media_format,
  ARRAY(SELECT alias FROM ingest.album_aliases WHERE album_id=a.id) aliases,
  ARRAY(SELECT title FROM public.tracks WHERE album_id=a.id ORDER BY disc_number,track_number,id) titles FROM ingest.catalog_albums a`)).rows:[];
 const byArtist=new Map<number,Album[]>();for(const album of catalogAlbums)byArtist.set(album.artist_id,[...(byArtist.get(album.artist_id)??[]),album]);
 const jobs=sources.flatMap(source=>{
  const entry=ledger.identities.find(e=>e.status==='resolved'&&rymHref(e.href)===rymHref(source.artista_url??''));
  if(!entry?.artistId)return [];
  const video=/video/iu.test(source.tipo??'')||rymVideoOnlyMedium(source.formato)||audiovisualKind(source.tipo)!==null;
  if((phase==='audiovisuals')!==video)return [];
  if(phase==='versions'){
   const publication=rymReleaseClassifications(source);
   if(!publication||publication.reviewReason)return [];
  }
  return [{source,artistId:entry.artistId,artistHref:entry.href}];
 });
 for(let offset=0;offset<jobs.length;offset+=40){
  const batch=jobs.slice(offset,offset+40);
  const result=await withOperatorRun({name:`catalogo:rym-integral-${phase}`,operator:'Codex (encargo de Brian: agotar RYM)',
   note:'RYM integral: conservar versiones y obras audiovisuales documentadas sin duplicar discos ni crear pistas a partir de videos.',
   params:{campaign:'rym-integral-2026-10-21',phase,offset,sourcePins:batch.flatMap(t=>t.source.capturePins),planHash:digest(batch)}},async ctx=>{
   const output:Array<Record<string,unknown>>=[];
   await ctx.client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s'");
   for(const {source:r,artistId,artistHref} of batch){
    if(!checked.has(artistHref)){await assertRymIdentity(ctx.client,ledger,artistHref,artistId);checked.add(artistHref);}
    for(const pin of r.capturePins)verifyRymPin(pin);
    if(!(await ctx.client.query('SELECT 1 FROM ingest.catalog_artists WHERE id=$1',[artistId])).rowCount)continue;
    await ctx.client.query('SAVEPOINT integral_edition');
    try{
     if(phase==='audiovisuals'){
      const existing=(await ctx.client.query<{id:number;title:string;source_key:string;video_id:number|null;youtube_id:string|null;metadata:{editorialHidden?:boolean}}>('\nSELECT a.id::int,a.title,a.source_key,a.video_id::int,v.video_id AS youtube_id,a.metadata FROM media.artist_audiovisuals a LEFT JOIN media.youtube_videos v ON v.id=a.video_id WHERE a.artist_id=$1',[artistId])).rows;
      const videoIds=Object.keys(r.listeningLinks?.['youtube']??{}).filter(v=>/^[A-Za-z0-9_-]{11}$/u.test(v));
      const youtubeId=videoIds.length===1?videoIds[0]:undefined;
      const sourceKey=`rym:${artistId}:${digest(r.href).slice(0,24)}`;
      // Hidden editorial entries also prevent reintroducing a rejected work.
      const same=existing.filter(a=>a.source_key===sourceKey||audiovisualKey(a.title)===audiovisualKey(r.titulo)||youtubeId&&a.youtube_id===youtubeId);
      if(same.length){
       const target=same.length===1?same[0]:undefined;
       if(target&&youtubeId&&!target.video_id&&!target.metadata?.editorialHidden){
        await writeEditorResource(ctx,'audiovisual',artistId,{url:`https://youtu.be/${youtubeId}`},target.id);
        output.push({artistId,audiovisualId:target.id,sourceHref:r.href,title:r.titulo,videoLinked:youtubeId});
       }
       continue;
      }
      const id=await writeEditorResource(ctx,'audiovisual',artistId,{title:r.titulo,releaseYear:r.anio,
       ...(youtubeId?{url:`https://youtu.be/${youtubeId}`} : {}),
       kind:/music video/iu.test(r.tipo??'')?'music_video':(audiovisualKind(r.tipo,r.titulo)??'other'),description:`Obra audiovisual documentada en ${r.url}. No se crea una publicación musical ni pistas por esta referencia.`});
      // The editor's default key identifies a run. Each work needs its own
      // stable provenance key when several works share an artist and run.
      await ctx.client.query('UPDATE media.artist_audiovisuals SET source_key=$2 WHERE id=$1',[id,sourceKey]);
      output.push({artistId,audiovisualId:id,sourceHref:r.href,title:r.titulo});
     }else{
      const tracks=rymTrackPositions(r.pistas),wanted=tracks?.map(t=>norm(t.title));
      const albums=byArtist.get(artistId)??[];
      const literal=albums.filter(a=>[a.title,...a.aliases].some(t=>norm(t)===norm(r.titulo)));
      // A complete matching repertoire can establish another title for an
      // edition, but a short single or a partial list cannot establish it.
      const matches=wanted&&new Set(wanted).size>=3?albums.filter(a=>JSON.stringify(a.titles.map(norm))===JSON.stringify(wanted)):[];
      const album=literal.length===1&&matches.some(a=>a.id===literal[0]!.id)?literal[0]:literal.length===0&&matches.length===1?matches[0]:undefined;
      if(!album)continue;
      const different=![album.title,...album.aliases].some(t=>norm(t)===norm(r.titulo))||!!rymCatalogKey(r.catalog_no)&&!!rymCatalogKey(album.catalog_id)&&rymCatalogKey(r.catalog_no)!==rymCatalogKey(album.catalog_id)
       ||!!r.formato&&!!album.media_format&&rymFormatKey(r.formato)!==rymFormatKey(album.media_format)||/_f\d+\/?$/u.test(r.href)||!!albumTitleEdition(r.titulo);
      if(!different)continue;
      if(r.anio&&(r.anio<1890||r.anio>2100))continue;
      const versions=(await ctx.client.query<{source_ref:string|null;position:number;title:string;format:string|null;format_details:string|null;catalog_number:string|null;release_year:number|null}>('SELECT source_ref,position,title,format,format_details,catalog_number,release_year FROM ingest.album_versions WHERE album_id=$1',[album.id])).rows;
      const format=versionFormatOf(r.titulo,r.formato);
      if(versions.some(v=>v.source_ref===r.url||norm(v.title??'')===norm(r.titulo)&&v.release_year===r.anio&&rymCatalogKey(v.catalog_number)===rymCatalogKey(r.catalog_no)&&rymFormatKey(v.format)===rymFormatKey(format.format)
       ||!!rymCatalogKey(r.catalog_no)&&rymCatalogKey(v.catalog_number)===rymCatalogKey(r.catalog_no)&&v.release_year===r.anio&&rymFormatKey(v.format)===rymFormatKey(format.format)))continue;
      const id=await writeEditorResource(ctx,'version',album.id,{position:Math.max(0,...versions.map(v=>v.position))+1,title:r.titulo,format:format.format,
       formatDetails:r.formato,catalogNumber:r.catalog_no&&r.catalog_no.length<=80?r.catalog_no:null,releaseYear:r.anio,
       sourceRef:r.url,distinctTracks:false,isPrimary:false,editionTypes:albumTitleEdition(r.titulo)?.types??[],
       notes:`Edición RYM con repertorio primario completo contrastado: ${r.url}. ${r.tipo??''}.`});
      output.push({albumId:album.id,versionId:id,title:r.titulo,sourceHref:r.href});
     }
     await ctx.client.query('RELEASE SAVEPOINT integral_edition');
    }catch(error){
     await ctx.client.query('ROLLBACK TO SAVEPOINT integral_edition');
     if(!(error instanceof OperatorError))throw error;
     report.held.push({slug:r.slug,reason:error.code,detail:error.message});
    }
   }
   return output;
  },{rollbackOnly:!confirm});
  if(confirm){report.runs.push(result.runId);writeFileSync(path.join(directory!,`run-${result.runId}-${phase}.json`),JSON.stringify(result,null,2)+'\n');}
  report.outcomes.push(...result.result);
  writeFileSync(path.join(directory!,`${phase}-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(`${phase} ${offset+batch.length}/${jobs.length}; aportes=${report.outcomes.length}`);
 }
}
async function run(){for(const phase of requestedPhase==='all'?['versions','audiovisuals']:[requestedPhase])await main(phase);}
run().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
