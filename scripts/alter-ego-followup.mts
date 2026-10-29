/** Conserva un hallazgo concurrente sin fusionar personas por semejanza de nombre. */
import {writeFileSync}from'node:fs';
import path from'node:path';
import {getPool,closeDb}from'../src/db/client.js';
import {withOperatorRun}from'../src/merge/operator.js';
const report=process.env['ALTER_REPORT'];if(!report)throw Error('Falta ALTER_REPORT');
try{
 const members=(await getPool().query("SELECT m.*,p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=1686 AND m.person_id IN(4707,55380) ORDER BY m.id")).rows;
 if(members.length!==2)throw Error('El hallazgo cambió: revisar antes de abrir otro expediente');
 const run=await withOperatorRun({name:'alter-ego:concurrent-membership-review',operator:'codex (encargo de Brian)',note:'Documentar posible integrante duplicado aparecido durante la campaña concurrente RHV. No fusionar personas por nombre ni modificar membresías.',params:{campaign:'alter-ego-cola-2026-10-25'}},async ctx=>{
  const key='alter-ego-cola-2026-10-25:member-luis';
  const exists=(await ctx.client.query<{id:string}>("SELECT id::text FROM ingest.review_queue WHERE payload->>'repairKey'=$1",[key])).rows[0];
  if(exists)return{id:Number(exists.id),created:false};
  const payload={campaign:'alter-ego-cola-2026-10-25',repairKey:key,record:{key:'members:alter-ego:luis-gonzalez',artistId:1686,personIds:[4707,55380],members,sourceUrl:'https://rockhechovenezuela.com/a/alter-ego/'},missingEvidence:'Contrastar nombre completo, guitarra/violín y formación con la página fuente y el fanzine de 1992 antes de unificar membresía o persona. Revisar créditos y pertenencias de ambos IDs.'};
  const row=(await ctx.client.query<{id:string}>("INSERT INTO ingest.review_queue(kind,status,priority,artist_a_id,notes,payload)VALUES('manual_review','open',7,1686,$1,$2::jsonb)RETURNING id::text",['Posible integrante duplicado: Luis E. González #4707 y Luis Gonzáles #55380, incorporado por otra campaña. Coincidencia de banda y guitarra; identidad personal aún sin resolver.',JSON.stringify(payload)])).rows[0]!;
  return{id:Number(row.id),created:true};
 });
 writeFileSync(path.join(report,'hallazgo-concurrente.json'),JSON.stringify({runId:run.runId,...run.result,members},null,2));console.log(JSON.stringify(run));
}finally{await closeDb();}
