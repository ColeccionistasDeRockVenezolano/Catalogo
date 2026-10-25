import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {withOperatorRun,updateEntity} from '../src/merge/operator.js';
import {mergeAlbums,previewAlbumMerge} from '../src/merge/album-merge.js';
import {normalizeRymIdentity as norm,verifyRymPin} from '../src/verification/rym-identity.js';

const arg=(s:string)=>{const i=process.argv.indexOf(s);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir obligatorio');
const confirm=process.argv.includes('--confirm');
const pairs=[{keepId:4871,dropId:33620,reason:'Mismo sencillo Promus 50-109, 1972: las dos caras, artista y posiciones coinciden. La descripción previa documenta también el número de catálogo.'},
 {keepId:29907,dropId:33679,reason:'Mismo sencillo de dos temas, artista y fecha 2022; las posiciones coinciden y las duraciones solo difieren un segundo de redondeo. El enlace Apple Music de la propia fuente RYM identifica el título previo Orden #30 Extra Brócoli.'}];
async function main(){
 const sources=readFileSync(path.join(directory!,'corpus/albumes.jsonl'),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s) as {titulo:string;url:string;capturePins:Array<{path:string;sha256:string}>});
 const result=await withOperatorRun({name:'catalogo:rym-integral-consolidacion',operator:'Codex (encargo de Brian: resolver duplicados)',note:'Consolidación de dos altas de esta campaña detectadas por la auditoría de repertorio; conservar fichas y pistas previas, alias, evidencia y trazabilidad nativa.',params:{campaign:'rym-integral-2026-10-21',phase:'duplicate_consolidation',pairs}},async ctx=>{
  const output=[];
  for(const pair of pairs){
   const exists=await ctx.client.query('SELECT 1 FROM public.albums WHERE id=$1',[pair.dropId]);if(!exists.rowCount){output.push({...pair,status:'already_consolidated'});continue;}
   const own=await ctx.client.query(`SELECT 1 FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE r.params->>'campaign'='rym-integral-2026-10-21' AND j.table_name='public.albums' AND j.op='I' AND (j.row_pk->>'id')::int=$1`,[pair.dropId]);
   if(!own.rowCount)throw new Error('Solo se consolidan altas de esta campaña');
   const preview=await previewAlbumMerge(ctx.client,pair.keepId,pair.dropId,{lock:true});
   if(preview.keep.artistId!==preview.drop.artistId||preview.keep.tracks.length!==2||preview.drop.tracks.length!==2||preview.matchedTracks.length!==2||preview.unmatchedDropTracks.length)throw new Error('Cambió el repertorio contrastado');
   for(let i=0;i<2;i++){
    const a=preview.keep.tracks[i]!,b=preview.drop.tracks[i]!;
    if(norm(a.title)!==norm(b.title)||a.discNumber!==b.discNumber||a.trackNumber!==b.trackNumber||a.durationSeconds&&b.durationSeconds&&Math.abs(a.durationSeconds-b.durationSeconds)>2)throw new Error('Repertorio o grabación discrepante');
   }
   const source=sources.find(s=>s.titulo===preview.drop.title&&String(preview.drop.fields['notes']).includes(s.url));
   if(!source)throw new Error('Falta fuente original');for(const pin of source.capturePins)verifyRymPin(pin);
   const rows=(await ctx.client.query<Record<string,unknown>>('SELECT * FROM public.albums WHERE id=ANY($1::int[])',[ [pair.keepId,pair.dropId] ])).rows;
   const keep=rows.find(r=>Number(r['id'])===pair.keepId)!,drop=rows.find(r=>Number(r['id'])===pair.dropId)!;
   const fields:Record<string,unknown>={};
   for(const key of ['catalog_id','media_format','release_date_text','rym_rating','rym_ratings_count'])if((keep[key]===null||keep[key]==='')&&drop[key]!==null)fields[key]=drop[key];
   if(Object.keys(fields).length)await updateEntity(ctx,'album',pair.keepId,fields);
   const refreshed=await previewAlbumMerge(ctx.client,pair.keepId,pair.dropId,{lock:true});
   const merged=await mergeAlbums(ctx,{keepId:pair.keepId,dropId:pair.dropId,previewHash:refreshed.previewHash,keepDropNameAsAlias:true});
   output.push({...pair,...merged,sourceUrl:source.url,sourcePins:source.capturePins,metadataFilled:Object.keys(fields)});
  }
  return output;
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(directory!,`consolidacion-${confirm?'aplicada':'ensayo'}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({runId:result.runId,results:result.result},null,2));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
