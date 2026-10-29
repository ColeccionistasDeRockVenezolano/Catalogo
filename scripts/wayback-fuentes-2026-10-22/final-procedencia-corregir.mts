import {writeFileSync,existsSync} from 'node:fs';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');
const file=out+'/procedencia-corregida.json';
if(!existsSync(file)){
 const old='https://music.apple.com/us/album/buena-vibra-vol-iii/1402101061',url='https://music.apple.com/ru/album/buena-vibra-vol-3/280200802?l=en-GB';
 const result=await withOperatorRun({name:'wayback-final:source-url-406',operator:'codex (encargo de Brian)',note:'Sustituir la URL regional de Apple Music que devuelve 404 por la ficha accesible de la misma obra. El press kit oficial y la ficha regional consultada confirman 2008; no se cambia el año ni se establece día exacto.',params:{campaign:'wayback-finalizacion-2026-10-25',oldUrl:old,verifiedUrl:url}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  const docs=(await ctx.client.query("SELECT * FROM media.artist_documents WHERE metadata->>'albumId'='406' AND metadata->'finalEditorialReview'->>'campaign'='wayback-finalizacion-2026-10-25' FOR UPDATE")).rows;
  if(docs.length!==2)throw Error('Documentos esperados distintos');
  for(const d of docs){const metadata={...d.metadata};for(const k of ['finalEditorialReview','approvedDecision'])if(metadata[k]?.sources)metadata[k]={...metadata[k],sources:metadata[k].sources.map((s:string)=>s===old?url:s)};
   await ctx.client.query('UPDATE media.artist_documents SET content=$2,metadata=$3::jsonb,updated_at=now() WHERE id=$1',[d.id,d.content.replaceAll(old,url),JSON.stringify(metadata)]);
  }return {albumId:406,documents:docs.map(d=>Number(d.id)),oldUrl:old,verifiedUrl:url};
 });writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}await closeDb();
