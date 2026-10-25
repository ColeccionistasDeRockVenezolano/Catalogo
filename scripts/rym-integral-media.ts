import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {closeDb,getPool} from '../src/db/client.js';
import {updateEntity,withOperatorRun} from '../src/merge/operator.js';
import {validateRymCross,verifyRymPin} from '../src/verification/rym-identity.js';
import {streamingImportDisposition} from '../src/verification/streaming-import.js';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir obligatorio');
const requestedPhase=arg('--phase')??'images';if(!['images','listening','all'].includes(requestedPhase))throw new Error('Fase desconocida');
const mediaCampaign=arg('--media-campaign')??'rym-integral-2026-10-21';
if(!/^[a-z0-9-]+$/u.test(mediaCampaign))throw new Error('Campaña de medios inválida');
const confirm=process.argv.includes('--confirm');
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
interface Candidate{albumId:number;slug:string;sourceHref:string;capturePins:Array<{path:string;sha256:string}>;status:string|number;file?:string;sha256?:string;sourceUrl?:string;downloadUrl?:string;platform?:string;url?:string;externalId?:string;verified?:boolean;evidenceFile?:string;responseHash?:string}
async function main(phase:string){
 const cross=await validateRymCross(getPool(),directory!);
 const input=JSON.parse(readFileSync(path.join(directory!,phase==='images'?'portadas-descargas.json':'escucha-verificada.json'),'utf8')) as {results:Candidate[]};
 const jobs=input.results.filter(r=>phase==='images'?r.status==='ready':r.verified);
 const report={phase,runs:[] as number[],outcomes:[] as Array<Record<string,unknown>>};
 for(let offset=0;offset<jobs.length;offset+=40){
  const batch=jobs.slice(offset,offset+40);
  for(const row of batch){
   if(cross.get(row.slug)?.albumId!==row.albumId)throw new Error('Medio fuera del cruce acreditado');
   for(const pin of row.capturePins)verifyRymPin(pin);
   if(phase==='images'){
    if(!row.file||!/^\w+\.(?:jpg|png|webp|gif)$/u.test(row.file))throw new Error('Ruta de imagen inválida');
    const bytes=readFileSync(path.join('web/public/media',mediaCampaign,row.file));
    if(hash(bytes)!==row.sha256)throw new Error('Imagen publicada cambió');
   }else{
    if(!row.evidenceFile||path.basename(row.evidenceFile)!==row.evidenceFile)throw new Error('Evidencia oficial inválida');
    const bytes=gunzipSync(readFileSync(path.join(directory!,'official-platform-evidence',row.evidenceFile)));
    if(hash(bytes)!==row.responseHash)throw new Error('Respuesta oficial cambió');
   }
  }
  const result=await withOperatorRun({name:`catalogo:rym-integral-${phase}`,operator:'Codex (encargo de Brian: agotar RYM)',
   note:phase==='images'?'Portadas faltantes: originales descargados en SSD, publicados y verificados por hash; conservar cualquier portada existente.':'Escucha: título y artista verificados en la plataforma oficial; respetar enlaces aprobados y ediciones discrepantes.',
   params:{campaign:'rym-integral-2026-10-21',phase,offset,planHash:hash(JSON.stringify(batch)),sourcePins:batch.flatMap(r=>r.capturePins),platformEvidence:batch.map(r=>({albumId:r.albumId,hash:r.responseHash??r.sha256,url:r.url??r.sourceUrl}))}},async ctx=>{
   const output:Array<Record<string,unknown>>=[];
   await ctx.client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s'");
   for(const row of batch){
    const album=(await ctx.client.query<{cover_url:string|null}>('SELECT cover_url FROM ingest.catalog_albums WHERE id=$1 FOR UPDATE',[row.albumId])).rows[0];
    if(!album)continue;
    if(phase==='images'){
     if(album.cover_url)continue;
     const localUrl=`/media/${mediaCampaign}/${row.file!}`;
     await updateEntity(ctx,'album',row.albumId,{cover_url:localUrl});
     await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
      SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 AND album_id=$5 AND field='cover_url' ON CONFLICT DO NOTHING`,
      [ctx.runId,row.downloadUrl??row.sourceUrl,`Portada original RYM de ${row.sourceHref}; SHA256 ${row.sha256!}.`,row.sha256,row.albumId]);
     output.push({albumId:row.albumId,localUrl});
    }else{
     const existing=(await ctx.client.query<{url:string;verified:boolean;source:string}>('SELECT url,verified,source FROM public.streaming_links WHERE album_id=$1 AND platform=$2 FOR UPDATE',[row.albumId,row.platform])).rows[0];
     const disposition=streamingImportDisposition(existing,{url:row.url!,verified:true});
     if(disposition==='unchanged'||disposition==='protected')continue;
     const hadListen=!!(await ctx.client.query('SELECT 1 FROM public.streaming_links WHERE album_id=$1 AND verified',[row.albumId])).rowCount;
     const written=await ctx.client.query(`INSERT INTO public.streaming_links(album_id,platform,url,external_id,method,source,verified,notes)
      VALUES($1,$2,$3,$4,'exact','rym-integral',true,$5)
      ON CONFLICT(album_id,platform) WHERE album_id IS NOT NULL DO UPDATE SET url=EXCLUDED.url,external_id=EXCLUDED.external_id,
       source=EXCLUDED.source,verified=true,notes=EXCLUDED.notes
      WHERE NOT streaming_links.verified AND streaming_links.source IS DISTINCT FROM 'crv-operador' RETURNING id`,
      [row.albumId,row.platform,row.url,row.externalId,`Identidad RYM ${row.sourceHref}; artista y título contrastados en plataforma oficial. Respuesta SHA256 ${row.responseHash!}.`]);
     if(written.rowCount)output.push({albumId:row.albumId,platform:row.platform,disposition,firstListen:!hadListen});
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
async function run(){for(const phase of requestedPhase==='all'?['images','listening']:[requestedPhase])await main(phase);}
run().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
