import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getPool,closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
import {writePlatformLink} from '../../src/merge/platform-links.js';
const dir='reports/webs-oficiales-2026-10-18/revision-990/scrapling';
const cases=`${dir}/evaluacion/casos`;
try{
 const file=readdirSync(cases).find(f=>{if(!f.startsWith('2873-')||!f.endsWith('.json'))return false;return JSON.parse(readFileSync(`${cases}/${f}`,'utf8')).manualReview;});assert.ok(file);
 const evidenceRecord=`${cases}/${file}`,bytes=readFileSync(evidenceRecord),evidence=JSON.parse(bytes.toString());assert.equal(evidence.status,'uncertain');
 const current=(await getPool().query('select url,notes from public.social_links where artist_id=2873 and platform=\'website\'')).rows[0];
 if(current){
  assert.equal(current.url,'https://hidra.bigcartel.com/products');assert.ok(current.notes?.includes('Brian autorizó'));
  const evidenceHash=createHash('sha256').update(bytes).digest('hex');
  const note=`Revisión Scrapling de las 990 URLs: retirar la atribución no corroborada de la tienda de Hidra. El nombre es compartido, la ficha no tiene discografía ni enlaces verificados coincidentes y la comprobación adicional sitúa al grupo de Crónica en Tres Cantos, España. Se conservan página, evidencia original y revisión: ${evidenceRecord} (sha256 ${evidenceHash}).`;
  const result=await withOperatorRun({name:'catalogo:retirar-web-homonimo',operator:'Codex por encargo de Brian',note,params:{artistId:2873,evidenceRecord,evidenceHash}},async context=>{
   const row=(await context.client.query('select url from public.social_links where artist_id=2873 and platform=\'website\' for update')).rows[0];assert.equal(row?.url,current.url);
   await writePlatformLink(context,'artist',2873,'social','website',null);return {removed:1,artistIds:[2873]};
  });
  writeFileSync(`${dir}/retiros.json`,JSON.stringify({...result,removedLinks:[{artistId:2873,url:current.url,evidenceRecord,evidenceHash}],reason:note},null,2)+'\n');console.log(JSON.stringify(result));
 }else console.log('Sin enlace atribuido a Hidra.');
}finally{await closeDb();}
