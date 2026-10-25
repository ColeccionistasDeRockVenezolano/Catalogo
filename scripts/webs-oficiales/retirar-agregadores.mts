// Retira las webs publicadas que son fichas de agregadores de descarga.
// La evidencia y la corrección de cada caso están en reintento/correcciones.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getPool,closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
import {writePlatformLink} from '../../src/merge/platform-links.js';
const dir='reports/webs-oficiales-2026-10-18/revision-990/reintento/correcciones';
const apply=process.argv.includes('--apply');
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
interface Correccion {artistId:number;name:string;url:string;senal:string|null;evidenceRecord:string}
try{
 const resumen=JSON.parse(readFileSync(`${dir}/resumen.json`,'utf8')) as {correcciones:Correccion[]};
 assert.ok(resumen.correcciones.length>0,'Sin correcciones documentadas');
 const pendientes:Array<Correccion & {evidenceHash:string}>=[];
 for(const c of resumen.correcciones){
  assert.ok(existsSync(c.evidenceRecord),`Falta evidencia ${c.evidenceRecord}`);
  const correction=JSON.parse(readFileSync(c.evidenceRecord,'utf8'));
  assert.equal(correction.status,'unrelated');assert.equal(correction.manualReview,true);
  const current=(await getPool().query('select url from public.social_links where artist_id=$1 and platform=\'website\'',[c.artistId])).rows[0];
  if(!current||current.url!==c.url){console.log(JSON.stringify({omitido:c.artistId,motivo:'la web actual no es la documentada',actual:current?.url??null}));continue;}
  pendientes.push({...c,evidenceHash:digest(c.evidenceRecord)});
 }
 if(!pendientes.length){console.log(JSON.stringify({changes:0}));}
 else{
  const note='Las webs retiradas son fichas generadas por agregadores de descarga (SkySound7 y similares), no publicaciones del artista. La revisión Scrapling del 18 de octubre las aceptó por contener nombre y repertorio; la página leída muestra descarga de mp3 y no identidad editorial. Se conserva la captura y el hash de cada corrección en reintento/correcciones.';
  const result=await withOperatorRun({name:'catalogo:retirar-webs-agregador',operator:'Hermes por encargo de Brian',note,
   params:{criterio:'agregador de descarga ≠ web del artista',casos:pendientes.map(p=>({artistId:p.artistId,url:p.url,evidenceRecord:p.evidenceRecord,evidenceHash:p.evidenceHash}))}},
   async context=>{
    for(const p of pendientes){
     assert.equal(digest(p.evidenceRecord),p.evidenceHash,'Cambió la evidencia antes de escribir');
     const row=(await context.client.query('select url from public.social_links where artist_id=$1 and platform=\'website\' for update',[p.artistId])).rows[0];
     assert.equal(row?.url,p.url,'La web cambió durante el retiro');
     await writePlatformLink(context,'artist',p.artistId,'social','website',null);
    }
    return {removed:pendientes.length,artistIds:pendientes.map(p=>p.artistId)};
   },{rollbackOnly:!apply});
  if(apply)writeFileSync(`${dir}/retiros.json`,JSON.stringify({...result,note,removedLinks:pendientes},null,2)+'\n');
  console.log(JSON.stringify({dryRun:!apply,runId:result.runId,removed:result.result.removed}));
 }
}finally{await closeDb();}
