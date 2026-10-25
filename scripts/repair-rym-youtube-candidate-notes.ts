import { writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { validateRymCross } from '../src/verification/rym-identity.js';

const directory='reports/aprovechamiento-1-5-2026-10-17/rym-resto-segunda-pasada';
async function main(){
  const cross=await validateRymCross(getPool(),directory);
  const albumIds=[...new Set([...cross.values()].map(row=>row.albumId))];
  const rows=(await getPool().query<{id:number;notes:string}>(`SELECT id::int,notes FROM public.streaming_links
    WHERE album_id=ANY($1::bigint[]) AND platform='youtube' AND source='rym-data-links' AND NOT verified AND notes LIKE '%(título distinto)%'`,[albumIds])).rows;
  if(!rows.length){console.log('0 motivos pendientes de aclarar');return;}
  if(!process.argv.includes('--confirm')){writeFileSync(`${directory}/youtube-motivos-ensayo.json`,JSON.stringify(rows,null,2)+'\n');console.log(`${rows.length} notas propuestas`);return;}
  const result=await withOperatorRun({name:'catalogo:rym-youtube-motivos',operator:'Codex (encargo de Brian: puntos 1–5)',
    note:'Precisar el motivo de los candidatos YouTube: falta acreditar la publicación completa, y eso no implica necesariamente un título distinto. Conservar URLs y verificaciones.',params:{rows}},async context=>{
    let changed=0;
    for(const row of rows){
      const updated=await context.client.query(`UPDATE public.streaming_links SET notes=replace(notes,'(título distinto)','(publicación completa pendiente de acreditar)')
        WHERE id=$1 AND notes=$2 AND platform='youtube' AND source='rym-data-links' AND NOT verified`,[row.id,row.notes]);
      changed+=updated.rowCount ?? 0;
    }
    return {changed};
  });
  writeFileSync(`${directory}/youtube-motivos-aplicado.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
