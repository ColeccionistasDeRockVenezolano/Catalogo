import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { createEntity,OperatorError,withOperatorRun } from '../src/merge/operator.js';
import { assertRymIdentity,normalizeRymIdentity as norm,readRymIdentityLedger } from '../src/verification/rym-identity.js';
import { rymReleaseClassifications,rymReleaseDateText,rymTrackPositions,type RymPublicationInput,type RymTrackInput } from '../src/verification/rym-release-plan.js';
import { writeAlbumClassifications } from '../src/catalog/album-classifications.js';
import {distinctRymPublication} from '../src/verification/rym-distinct-publication.js';
import {rymCatalogKey} from '../src/verification/rym-publication-identity.js';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir obligatorio');
const confirm=process.argv.includes('--confirm');
const limit=Number(arg('--limit')??0);
const jsonl=<T>(file:string):T[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as T);
interface Pin{path:string;sha256:string}
interface Proposal{slug:string;artistId:number;artistHref:string;tituloRym:string;sourceHref:string;capturePins:Pin[]}
interface Release extends RymPublicationInput{slug:string;href:string;url:string;anio:number|null;catalog_no:string|null;released_text:string|null;pistas:RymTrackInput[]}
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
async function main(){
  const ledger=readRymIdentityLedger(path.join(directory!,'identity-ledger.json'));
  const rich=new Map(jsonl<Release>(path.join(directory!,'corpus/albumes.jsonl')).map(r=>[r.slug,r]));
  const grouped=new Map<string,Proposal[]>();
  for(const proposal of jsonl<Proposal>(path.join(directory!,'cruce-sobrantes.jsonl'))){
    const key=`${proposal.artistId}|${norm(proposal.tituloRym)}`;grouped.set(key,[...(grouped.get(key)??[]),proposal]);
  }
  const jobs:Proposal[]=[],held:Array<Record<string,unknown>>=[];
  for(const proposals of grouped.values()){
    let chosen=proposals[0]!;
    if(proposals.length>1){
      const primary=proposals.filter(p=>!/_f\d+\/?$/u.test(p.sourceHref));
      const signatures=new Set(proposals.map(p=>JSON.stringify(rich.get(p.slug)!.pistas.map(t=>[t.n,norm(t.titulo)]))));
      if(primary.length===1)chosen=primary[0]!;
      else if(signatures.size===1)chosen=[...proposals].sort((a,b)=>(rich.get(a.slug)?.anio??9999)-(rich.get(b.slug)?.anio??9999)||a.sourceHref.length-b.sourceHref.length)[0]!;
      else{held.push({artistId:chosen.artistId,title:chosen.tituloRym,reason:'editions_need_primary_source',sourceHrefs:proposals.map(p=>p.sourceHref)});continue;}
    }
    jobs.push(chosen);
  }
  const outcomes:Array<Record<string,unknown>>=[],runs:number[]=[];
  if(limit)jobs.splice(limit);
  const checked=new Set<string>();
  for(let offset=0;offset<jobs.length;offset+=10){
    const batch=jobs.slice(offset,offset+10);
    const result=await withOperatorRun({name:'catalogo:rym-integral-publicaciones',operator:'Codex (encargo de Brian: agotar RYM)',
      note:'Altas de publicaciones musicales documentadas en RYM. Cruce contra títulos, alias y repertorio existentes. Ambigüedades resueltas o retenidas en el informe, sin crear colas masivas.',
      params:{campaign:'rym-integral-2026-10-21',offset,sourcePins:batch.flatMap(p=>p.capturePins),planHash:digest(JSON.stringify(batch))}},async context=>{
      await context.client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s'");
      const output:Array<Record<string,unknown>>=[];
      for(const p of batch){
        if(!checked.has(p.artistHref)){await assertRymIdentity(context.client,ledger,p.artistHref,p.artistId);checked.add(p.artistHref);}
        const r=rich.get(p.slug)!;
        for(const pin of p.capturePins)if(digest(readFileSync(pin.path))!==pin.sha256)throw new Error('Captura cambió');
        const type=rymReleaseClassifications(r),tracks=rymTrackPositions(r.pistas);
        if(!type||type.reviewReason||r.titulo.length>250||tracks===null){held.push({slug:p.slug,reason:type?.reviewReason??(tracks===null?'ambiguous_positions':'unsupported_type')});continue;}
        const existing=(await context.client.query<{id:number;title:string;album_type:string;catalog_id:string|null;aliases:string[];titles:string[]}>(`SELECT a.id::int,a.title,a.album_type,a.catalog_id,
          ARRAY(SELECT alias FROM ingest.album_aliases WHERE album_id=a.id) aliases,
          ARRAY(SELECT title FROM public.tracks WHERE album_id=a.id ORDER BY disc_number,track_number,id) titles
          FROM public.albums a WHERE a.artist_id=$1`,[p.artistId])).rows;
        if(existing.some(a=>[a.title,...a.aliases].some(t=>norm(t)===norm(r.titulo)))){output.push({slug:p.slug,status:'already_exists'});continue;}
        const versions=(await context.client.query<{album_id:number;catalog_number:string|null;source_ref:string|null}>('SELECT v.album_id::int,v.catalog_number,v.source_ref FROM ingest.album_versions v JOIN public.albums a ON a.id=v.album_id WHERE a.artist_id=$1',[p.artistId])).rows;
        const sourceCatalog=rymCatalogKey(r.catalog_no);
        const catalogMatches=sourceCatalog?[...existing.filter(a=>rymCatalogKey(a.catalog_id)===sourceCatalog).map(a=>a.id),...versions.filter(v=>rymCatalogKey(v.catalog_number)===sourceCatalog).map(v=>v.album_id)]:[];
        const sourceMatches=versions.filter(v=>v.source_ref===r.url).map(v=>v.album_id);
        if(catalogMatches.length||sourceMatches.length){held.push({slug:p.slug,reason:sourceMatches.length?'already_documented_as_existing_version':'catalog_number_matches_existing_publication',albumIds:[...new Set([...catalogMatches,...sourceMatches])]});continue;}
        const incoming=tracks.map(t=>norm(t.title));
        const equivalent=existing.filter(a=>incoming.length>0&&
          JSON.stringify(a.titles.map(norm).sort())===JSON.stringify([...incoming].sort()));
        if(equivalent.length){held.push({slug:p.slug,reason:'same_complete_repertoire_preserve_as_edition',albumIds:equivalent.map(a=>a.id)});continue;}
        await context.client.query('SAVEPOINT integral_publication');
        try{
          const date=rymReleaseDateText(r.released_text);
          const fields:Record<string,unknown>={title:r.titulo,album_type:type.albumType,
            ...(r.anio?{release_year:r.anio}:{}),...(date?{release_date_text:date}:{}),
            ...(r.catalog_no&&r.catalog_no.length<=80&&rymCatalogKey(r.catalog_no)?{catalog_id:r.catalog_no}:{}),
            ...(r.formato&&r.formato.length<=50?{media_format:r.formato}:{}),
            notes:`Publicación musical documentada en ${r.url}. Fuente original y lista primaria conservadas.`};
          const distinguished=distinctRymPublication({title:r.titulo,year:r.anio,albumType:type.albumType,titles:tracks.map(t=>t.title)},existing);
          const album=await createEntity(context,'album',fields,{artistId:p.artistId,allowSimilar:distinguished});
          await writeAlbumClassifications(context,album.id,type.classifications,{addOnly:true});
          for(const track of tracks)await createEntity(context,'track',track,{albumId:album.id,allowSimilar:true});
          await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
            SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 AND (album_id=$5 OR track_id IN (SELECT id FROM public.tracks WHERE album_id=$5)) ON CONFLICT DO NOTHING`,
            [context.runId,r.url,`${r.titulo}: ${r.tipo}; lista primaria de la edición seleccionada.`,digest(JSON.stringify(p.capturePins)),album.id]);
          output.push({slug:p.slug,status:'created',albumId:album.id,artistId:p.artistId,tracks:tracks.length});
          await context.client.query('RELEASE SAVEPOINT integral_publication');
        }catch(error){
          await context.client.query('ROLLBACK TO SAVEPOINT integral_publication');
          if(!(error instanceof OperatorError)&&!(error&&typeof error==='object'&&'code' in error&&error.code==='PCE01'))throw error;
          held.push({slug:p.slug,reason:`operator_${error instanceof OperatorError?error.code:'editorial_exclusion'}`,detail:error instanceof Error?error.message:String(error)});
        }
      }
      return output;
    },{rollbackOnly:!confirm});
    if(confirm)runs.push(result.runId);
    if(confirm)writeFileSync(path.join(directory!,`run-${result.runId}-publications.json`),JSON.stringify(result,null,2)+'\n');outcomes.push(...result.result);
    writeFileSync(path.join(directory!,`publicaciones-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify({dryRun:!confirm,runs,outcomes,held,planned:jobs.length,processed:offset+batch.length},null,2)+'\n');
    console.log(`Publicaciones ${offset+batch.length}/${jobs.length}: creadas=${outcomes.filter(o=>o['status']==='created').length}; retenidas=${held.length}`);
  }
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
