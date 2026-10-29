/** Añade la característica documentada; conserva publicación, directo, remix y otras categorías. */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { writeAlbumClassifications } from '../src/catalog/album-classifications.js';
const path=process.argv[2];if(!path)throw new Error('Indica classification-plan.json');
const plan=z.array(z.object({id:z.number(),title:z.string(),type:z.string(),evidence:z.object({sourceUrl:z.string().url(),albumUrl:z.string().url(),excerpt:z.string().min(5)})})).parse(JSON.parse(readFileSync(path,'utf8')));
const confirm=process.argv.includes('--confirm');
try{
 const result=await withOperatorRun({name:'series:compilados-clasificacion',operator:process.env['CRV_OPERATOR']??'codex',note:'Brian: comprobar compilados para series; la fuente identifica las recopilaciones',params:{count:plan.length}},async context=>{
  const changed=[];
  for(const item of plan){
   const current=(await context.client.query('SELECT title,album_type FROM ingest.catalog_albums WHERE id=$1',[item.id])).rows[0];
   if(!current||current.title!==item.title||current.album_type!==item.type)throw new Error(`Cambió ficha ${item.id}`);
   await writeAlbumClassifications({...context,note:`${item.evidence.sourceUrl} — evidencia de compilado: «${item.evidence.excerpt}». Ficha de la edición: ${item.evidence.albumUrl}`},item.id,['Compilation Album'],{addOnly:true});
   changed.push(item.id);
  }
  return {changed};
 },{rollbackOnly:!confirm});
 writeFileSync(path.replace('.json',confirm?'-applied.json':'-dry-run.json'),JSON.stringify({confirmed:confirm,...result},null,2));console.log({confirmed:confirm,runId:result.runId,count:result.result.changed.length});
}finally{await closeDb();}
