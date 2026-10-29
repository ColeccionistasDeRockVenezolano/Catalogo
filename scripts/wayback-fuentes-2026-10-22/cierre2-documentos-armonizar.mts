import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');
const file=out+'/documentos-armonizados.json';
if(!existsSync(file)){
 const applied=JSON.parse(readFileSync(out+'/aplicado.json','utf8'));const ids=applied.filter((x:any)=>x.key.startsWith('video:')).map((x:any)=>x.result.documentId);
 const old='El archivo conserva un enlace a este video. La copia reproducible no está confirmada; el registro audiovisual se mantiene fuera del reproductor público.';
 const result=await withOperatorRun({name:'wayback-cierre2:video-document-status',operator:'codex (encargo de Brian)',note:'Actualizar el aviso de disponibilidad de los cinco documentos tras confirmar y publicar las copias audiovisuales; preservar el enlace y la descripción histórica.',params:{campaign:'wayback-finalizacion-2-2026-10-25'}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  const docs=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE id=ANY($1::bigint[]) FOR UPDATE',[ids])).rows;if(docs.length!==5)throw Error('Faltan documentos');
  for(const d of docs){if(!d.content.includes(old)||!d.metadata.verifiedAudiovisualId)throw Error('Estado documental inesperado');await ctx.client.query('UPDATE media.artist_documents SET content=$2,updated_at=now() WHERE id=$1',[d.id,d.content.replace(old,'El archivo conserva el enlace histórico a este video. La copia localizada y verificada está disponible en Audiovisuales.')]);}
  return {documentIds:ids};
 });writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}await closeDb();
