// Campos vacíos validados por la campaña; evidencia real y run reversible.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
import {persistClaim,type ClaimToPersist} from '../../src/claims/persistence.js';
import {mergeClaim} from '../../src/merge/engine.js';

interface Row {
  kind:'album'|'artist';id:number;field:'release_date_text'|'cover_url'|'picture_url';value:string;
  expectedYear?:number;sourceSlug:string;extractor:string;url:string;excerpt:string;
}
const dir=process.argv[2]??'';
const phase=process.argv[3];
const confirm=process.argv.includes('--confirm');
if (!dir?.includes('/crv-staging/') || !phase || !/^[a-z-]+$/u.test(phase)) throw Error('Usar directorio staging y fase');
const plan=readFileSync(path.join(dir,`plan-${phase}.jsonl`),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l) as Row);
if(new Set(plan.map(r=>`${r.kind}:${r.id}:${r.field}`)).size!==plan.length)throw Error('Plan duplicado');
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const report={phase,confirm,rows:plan.length,runId:0,applied:[] as unknown[],skipped:[] as unknown[]};
async function main():Promise<void>{
  const result=await withOperatorRun({name:`codex:shared-recuperacion-2026-10-26:${phase}`,operator:'codex (encargo de Brian)',
    note:'Brian autorizó aplicar los datos válidos del contraste de la auditoría de Shared. Fuentes releídas; sólo campos vacíos.',
    params:{phase,rows:plan.length,planSha256:sha(plan)}},async context=>{
    for(const r of plan){
      if(!(['album','artist'] as string[]).includes(r.kind) || !Number.isSafeInteger(r.id) ||
         !(r.kind==='album'?['release_date_text','cover_url']:['picture_url']).includes(r.field))throw Error('Destino no permitido');
      if(r.value.startsWith('/crv/media/')){
        const local=path.resolve('web/public',r.value.replace(/^\/crv\//u,''));
        if(!local.startsWith(path.resolve('web/public/media')+path.sep)||!existsSync(local))throw Error('Imagen publicada inexistente');
      }
      const table=r.kind==='album'?'public.albums':'public.artists';
      const select=r.kind==='album'?',release_year,artist_id':',id AS artist_id';
      const before=(await context.client.query<{value:string|null;release_year?:number;artist_id:string}>(`SELECT ${r.field} AS value ${select} FROM ${table} WHERE id=$1 FOR UPDATE`,[r.id])).rows[0];
      if(!before)throw Error('Ficha inexistente');
      if(before.value?.trim()){report.skipped.push({id:r.id,reason:'campo ya ocupado'});continue;}
      if(r.expectedYear!==undefined && before.release_year!==r.expectedYear)throw Error(`Año cambió: ${r.id}`);
      if((await context.client.query('SELECT 1 FROM ingest.artist_editorial_policy WHERE artist_id=$1',[before.artist_id])).rowCount){report.skipped.push({id:r.id,reason:'política editorial'});continue;}
      const source=(await context.client.query<{id:string}>('SELECT id FROM ingest.sources WHERE slug=$1',[r.sourceSlug])).rows[0];
      if(!source)throw Error(`Fuente inexistente: ${r.sourceSlug}`);
      const identity=`shared-recuperacion:${r.kind}:${r.id}:${r.field}`;
      const claim={entityKind:r.kind,identity,identitySecondary:identity,originalIdentity:identity,
        field:r.field,rawValue:r.value,normalizedValue:r.value,rawHash:sha([identity,r.value,r.url]),
        extractor:r.extractor,extractorVersion:'1',sourceId:Number(source.id),runId:context.runId,
        confidence:'high',createdBy:'human',evidence:{url:r.url,excerpt:r.excerpt},
        [r.kind==='album'?'albumId':'artistId']:r.id} as ClaimToPersist;
      const persisted=await persistClaim(claim,context.client);
      const outcome=await mergeClaim(claim,persisted,{client:context.client});
      const after=(await context.client.query<{value:string|null}>(`SELECT ${r.field} AS value FROM ${table} WHERE id=$1`,[r.id])).rows[0];
      if(after?.value!==r.value)throw Error(`Valor no aplicado: ${r.id} ${outcome.action}`);
      report.applied.push({kind:r.kind,id:r.id,field:r.field,value:after.value,claimId:persisted.id,source:r.url});
    }
  },{rollbackOnly:!confirm});
  report.runId=result.runId;
  writeFileSync(path.join(dir,`aplicacion-${phase}-${confirm?`run${result.runId}`:'ensayo'}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({phase,confirm,runId:result.runId,applied:report.applied.length,skipped:report.skipped.length}));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
