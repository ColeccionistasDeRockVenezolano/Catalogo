import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb, getPool } from '../../src/db/client.js';
import { withOperatorRun } from '../../src/merge/operator.js';
import { writeAlbumClassifications } from '../../src/catalog/album-classifications.js';
import { validateRymCross } from '../../src/verification/rym-identity.js';
import { rymReleaseClassifications, type RymPublicationInput } from '../../src/verification/rym-release-plan.js';

const argument=(name:string):string|undefined=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const directory=argument('--dir') ?? 'reports/aprovechamiento-1-5-2026-10-17/rym-resto-segunda-pasada';
const richFile=argument('--v4') ?? 'reports/aprovechamiento-1-5-2026-10-17/rym-v4-resto/albumes.jsonl';
const confirm=process.argv.includes('--confirm');
async function main(){
  const cross=await validateRymCross(getPool(),directory);
  const rich=new Map(readFileSync(richFile,'utf8').trim().split('\n').map(line=>{const record=JSON.parse(line) as RymPublicationInput & {slug:string};return [record.slug,record] as const;}));
  const jobs=new Map<number,{albumId:number;type:string;before:string[];wanted:string[];slugs:string[]}>();
  for(const source of cross.values()){
    const record=rich.get(source.slug);if(!record)throw new Error('Falta la publicación rica');
    const publication=rymReleaseClassifications(record);
    if(!publication || !['ep','single'].includes(publication.albumType))continue;
    const current=(await getPool().query<{album_type:string;classifications:string[]}>('SELECT album_type,ARRAY(SELECT classification FROM ingest.effective_album_classifications WHERE album_id=a.id ORDER BY classification) classifications FROM public.albums a WHERE id=$1',[source.albumId])).rows[0]!;
    if(!['remix','soundtrack'].includes(current.album_type))continue;
    const job=jobs.get(source.albumId) ?? {albumId:source.albumId,type:current.album_type,before:current.classifications,wanted:[...current.classifications],slugs:[]};
    job.wanted=[...new Set([...job.wanted,...publication.classifications])];job.slugs.push(source.slug);jobs.set(job.albumId,job);
  }
  const pending=[...jobs.values()].filter(job=>job.wanted.some(label=>!job.before.includes(label)));
  writeFileSync(path.join(directory,'categorias-publicacion-ensayo.json'),JSON.stringify(pending,null,2)+'\n');
  if(!confirm || !pending.length){console.log(`${pending.length} tipos de publicación para combinar con la característica conservada`);return;}
  const result=await withOperatorRun({name:'catalogo:rym-tipos-publicacion-combinados',operator:'Codex (encargo de Brian: puntos 1–5)',
    note:'Conservar Remix o banda sonora y añadir el tipo de publicación documentado (EP/sencillo), sin deducirlo del número de pistas ni borrar las categorías existentes.',params:{pending}},async context=>{
    for(const job of pending){
      const rejected=(await context.client.query('SELECT 1 FROM ingest.album_classification_decisions WHERE album_id=$1 AND NOT selected AND classification=ANY($2::text[])',[job.albumId,job.wanted.filter(label=>!job.before.includes(label))])).rowCount;
      if(rejected)throw new Error('Existe una decisión contraria de clasificación; requiere revisión');
      await writeAlbumClassifications(context,job.albumId,job.wanted);
    }
    return {changed:pending.length,albums:pending.map(job=>job.albumId)};
  });
  writeFileSync(path.join(directory,'categorias-publicacion-aplicado.json'),JSON.stringify({runId:result.runId,...result.result},null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
