import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { updateEntity, withOperatorRun } from '../src/merge/operator.js';

const root='reports/aprovechamiento-1-5-2026-10-17';
const source=JSON.parse(readFileSync(`${root}/tracklists-descripciones-despues.json`,'utf8')) as Array<{id:number;title:string;description:string|null}>;
const replacements: Record<number, (value:string)=>string> = {
  2861:value=>value.replace(/ Incluye temas como .*$/u,''),
  2392:value=>value.replace(/, y contiene temas como .*$/u,'.'),
  2913:value=>value.replace(/Incluye temas como .*?, y forma parte/u,'Forma parte'),
  2916:value=>value.replace(/ Incluye temas como .*$/u,''),
  3064:value=>value.replace(/ Incluye los temas .*$/u,''),
};
async function main(){
  const pending: Array<{id:number;title:string;description:string;before:string}>=[];
  for(const row of source){
    const transform=replacements[row.id]; if(!transform || !row.description)continue;
    const description=transform(row.description);
    if(description===row.description)throw new Error(`No se identificó el texto derivado de las pistas ajenas: ${row.id}`);
    const live=(await getPool().query<{description:string}>('SELECT description FROM public.albums WHERE id=$1',[row.id])).rows[0];
    if(live?.description===description)continue;
    if(live?.description!==row.description)throw new Error('Cambió la descripción antes de corregir');
    pending.push({...row,description,before:row.description});
  }
  if(!pending.length){console.log('0 descripciones pendientes');return;}
  if(!process.argv.includes('--confirm')){writeFileSync(`${root}/descripciones-ensayo.json`,JSON.stringify(pending,null,2)+'\n');console.log(`${pending.length} descripciones propuestas`);return;}
  const result=await withOperatorRun({name:'catalogo:reseñas-tracklists-corregidos',operator:'Codex (encargo de Brian: puntos 1–5)',
    note:'Retirar de cinco reseñas únicamente las enumeraciones de pistas cuya atribución fue rechazada en las reparaciones documentadas; conservar el resto del texto.',params:{pending}},async context=>{
    for(const row of pending)await updateEntity(context,'album',row.id,{description:row.description});
    return pending.map(row=>row.id);
  });
  writeFileSync(`${root}/descripciones-aplicado.json`,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
