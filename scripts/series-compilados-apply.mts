/** Agrupaciones autorizadas por Brian; ensayo por defecto, diario y revalidación al aplicar. */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { compilationAlbumSql } from '../src/api/repositories/compilation-series.js';
const path=process.argv[2];if(!path)throw new Error('Indica grouping-plan.json del staging');
const plan=z.object({series:z.array(z.object({title:z.string().min(1),seriesId:z.number().nullable(),artistId:z.number().nullable(),description:z.string().nullable(),reason:z.string(),members:z.array(z.object({id:z.number().int().positive(),title:z.string(),volumeNumber:z.number().nullable(),volumeLabel:z.string().max(40).nullable(),sourceUrls:z.array(z.string())})).min(1)}))}).parse(JSON.parse(readFileSync(path,'utf8')));
const confirm=process.argv.includes('--confirm');
try {
 const result=await withOperatorRun({name:'series:compilados',operator:'codex',note:'Brian: series exclusivamente de compilados; agrupar colecciones documentadas (2026-10-27)',params:{groups:plan.series.length}},async context=>{
  let created=0,linked=0;const groups=[];
  for(const item of plan.series){
   for(const member of item.members){
    const current=(await context.client.query(`SELECT a.title,${compilationAlbumSql('a')} compilation FROM ingest.catalog_albums a WHERE id=$1`,[member.id])).rows[0];
    if(!current||current.title!==member.title||!current.compilation)throw new Error(`Ficha cambió o no es compilado: ${member.id}`);
   }
   const sources=[...new Set(item.members.flatMap(m=>m.sourceUrls))];
   const notes=JSON.stringify({reason:item.reason,sourceUrls:sources,report:'reports/series-compilados-2026-10-27/grouping-plan.json'});
   const existing=item.seriesId??(await context.client.query('SELECT id FROM ingest.series WHERE title=$1 AND artist_id IS NOT DISTINCT FROM $2',[item.title,item.artistId])).rows[0]?.id;
   const id=existing??(await context.client.query(`INSERT INTO ingest.series(title,artist_id,description,source,notes,run_id) VALUES($1,$2,$3,'compilados-2026-10-27',$4,$5) RETURNING id`,[item.title,item.artistId,item.description,notes,context.runId])).rows[0].id;
   if(!existing)created++;
   for(const member of item.members){
    const inserted=await context.client.query(`INSERT INTO ingest.series_albums(series_id,album_id,volume_number,volume_label,run_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(series_id,album_id) DO NOTHING`,[id,member.id,member.volumeNumber,member.volumeLabel,context.runId]);linked+=inserted.rowCount??0;
   }
   groups.push({id:Number(id),title:item.title,members:item.members.length});
  }
  return {created,linked,groups};
 },{rollbackOnly:!confirm});
 writeFileSync(path.replace(/\.json$/u,confirm?'-applied.json':'-dry-run.json'),JSON.stringify({confirmed:confirm,...result},null,2));
 console.log(JSON.stringify({confirmed:confirm,runId:result.runId,created:result.result.created,linked:result.result.linked}));
} finally {await closeDb();}
