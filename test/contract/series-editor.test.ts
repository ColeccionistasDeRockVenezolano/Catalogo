import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startPgContainer, type PgContainer } from '../support/pg-container.js';
import { applyCore } from '../support/apply-core.js';
import { closeDb, getPool } from '../../src/db/client.js';
import { resetEnvCache } from '../../src/config/env.js';
import { migrateUp } from '../../src/db/migrate.js';
import { buildApp } from '../../src/api/app.js';

const TOKEN='series-editor-contract-token-0123456789';
describe('series editables por la administración',()=>{
 let container:PgContainer;let app:FastifyInstance;let va:number;let band:number;let vol1:number;let vol2:number;let own:number;let org:number;
 const headers={authorization:`Bearer ${TOKEN}`};
 const get=(url:string)=>app.inject({method:'GET',url,headers});
 const anonymous=(url:string)=>app.inject({method:'GET',url});
 const write=(method:'POST'|'PATCH',url:string,payload:Record<string,unknown>)=>app.inject({method,url,headers,payload:{note:'Serie documentada en la contraportada',...payload}});
 const remove=(url:string)=>app.inject({method:'DELETE',url:`${url}?note=${encodeURIComponent('Retiro documentado')}`,headers});
 const undo=(runId:number)=>app.inject({method:'POST',url:`/changes/${runId}/undo`,headers,payload:{note:'Deshacer en la prueba'}});
 const entries=(series:number)=>`/catalog-editor/series/${series}/entries`;
 beforeAll(async()=>{
  container=await startPgContainer();process.env['DATABASE_URL']=container.databaseUrl;process.env['CRV_OPERATOR_TOKEN']=TOKEN;resetEnvCache();await applyCore(container.name);await migrateUp();app=await buildApp();
  va=(await write('POST','/artists',{name:'Various Artists'})).json().id;
  band=(await write('POST','/artists',{name:'Banda de sesiones'})).json().id;
  vol1=(await write('POST','/albums',{artistId:va,title:'Rock de Catia Vol. 1',albumType:'compilation',releaseYear:1998})).json().id;
  vol2=(await write('POST','/albums',{artistId:va,title:'Rock de Catia Vol. 2',albumType:'compilation',releaseYear:1999,allowSimilar:true})).json().id;
  own=(await write('POST','/albums',{artistId:band,title:'Sesión acústica',albumType:'live_album'})).json().id;expect(own).toBeTypeOf('number');
  org=(await write('POST','/organizations',{name:'Sello de la serie',organizationType:'record_label'})).json().id;
 },120000);
 afterAll(async()=>{await app?.close();await closeDb();delete process.env['CRV_OPERATOR_TOKEN'];resetEnvCache();await container?.stop();},60000);

 it('crea, lee y explica por qué una serie todavía no es pública',async()=>{
  expect((await anonymous('/catalog-editor/series')).statusCode).toBe(401);
  const created=await write('POST','/catalog-editor/series',{title:'  Rock de Catia ',kind:'compilation',description:'Compilados del oeste de Caracas.'});
  expect(created.statusCode,created.body).toBe(200);const series=created.json().id;
  const detail=await get(`/catalog-editor/series/${series}`);expect(detail.headers['cache-control']).toBe('private, no-store');
  expect(detail.json()).toMatchObject({title:'Rock de Catia',kind:'compilation',source:'operador',isPublic:false,hiddenReason:'few_entries',entries:[]});
  expect((await anonymous(`/series/${series}`)).statusCode).toBe(404);
  expect((await write('POST','/catalog-editor/series',{title:'rock de catia',kind:'compilation'})).statusCode).toBe(409);
  expect((await write('POST','/catalog-editor/series',{title:'   ',kind:'compilation'})).statusCode).toBe(400);
  expect((await get('/catalog-editor/series?status=hidden&q=Catia')).json().data).toEqual([expect.objectContaining({id:series,isPublic:false,hiddenReason:'few_entries',entryCount:0})]);
 });

 it('añadir entregas de Various Artists la publica en orden; corregir volúmenes y datos se refleja en la ficha',async()=>{
  const series=(await get('/catalog-editor/series?q=Catia')).json().data[0].id;
  const second=await write('POST',entries(series),{albumId:vol2,volumeNumber:2,volumeLabel:'Vol. 2'});expect(second.statusCode,second.body).toBe(200);
  const first=await write('POST',entries(series),{albumId:vol1,volumeNumber:1,volumeLabel:'Vol. 1'});expect(first.statusCode,first.body).toBe(200);
  expect((await write('POST',entries(series),{albumId:vol1})).statusCode).toBe(409);
  expect((await write('POST',entries(series),{albumId:999999})).statusCode).toBe(404);
  const published=(await anonymous(`/series/${series}`)).json();
  expect(published.volumes.map((v:{albumId:number})=>v.albumId)).toEqual([vol1,vol2]);
  expect((await anonymous(`/albums/${vol1}`)).json().series).toEqual([expect.objectContaining({id:series,title:'Rock de Catia'})]);

  const renamed=await write('PATCH',`/catalog-editor/series/${series}`,{title:'Rock de Catia (serie)',organizationId:org,description:null});expect(renamed.statusCode,renamed.body).toBe(200);
  expect((await anonymous(`/series/${series}`)).json()).toMatchObject({title:'Rock de Catia (serie)',description:null,organization:{id:org,name:'Sello de la serie'}});
  const relabeled=await write('PATCH',`${entries(series)}/${first.json().id}`,{volumeNumber:3,volumeLabel:'Vol. III'});expect(relabeled.statusCode,relabeled.body).toBe(200);
  expect((await anonymous(`/series/${series}`)).json().volumes.map((v:{volumeLabel:string})=>v.volumeLabel)).toEqual(['Vol. 2','Vol. III']);
  expect((await write('PATCH',`${entries(series)}/${first.json().id}`,{albumId:vol2})).statusCode).toBe(400);
  expect((await undo(relabeled.json().runId)).statusCode).toBe(200);
  expect((await anonymous(`/series/${series}`)).json().volumes.map((v:{volumeLabel:string})=>v.volumeLabel)).toEqual(['Vol. 1','Vol. 2']);
  expect((await get(`/catalog-editor/album/${vol1}/series`)).json()).toEqual([expect.objectContaining({id:first.json().id,seriesId:series,volumeLabel:'Vol. 1',isPublic:true})]);
 });

 it('una entrega de un solo artista la oculta salvo en una serie de sesiones; las entregas se validan por serie',async()=>{
  const series=(await get('/catalog-editor/series?q=Catia')).json().data[0].id;
  const other=(await write('POST','/catalog-editor/series',{title:'Otra serie',kind:'compilation'})).json().id;
  const added=await write('POST',entries(series),{albumId:own});expect(added.statusCode,added.body).toBe(200);
  expect((await get(`/catalog-editor/series/${series}`)).json()).toMatchObject({isPublic:false,hiddenReason:'not_various_artists'});
  expect((await anonymous(`/series/${series}`)).statusCode).toBe(404);
  const sessions=await write('PATCH',`/catalog-editor/series/${series}`,{kind:'sessions'});expect(sessions.statusCode,sessions.body).toBe(200);
  expect((await anonymous(`/series/${series}`)).json()).toMatchObject({kind:'sessions'});
  expect((await write('PATCH',`${entries(other)}/${added.json().id}`,{volumeNumber:1})).statusCode).toBe(404);
  expect((await remove(`${entries(other)}/${added.json().id}`)).statusCode).toBe(404);
  const dropped=await remove(`${entries(series)}/${added.json().id}`);expect(dropped.statusCode,dropped.body).toBe(200);
  expect((await get(`/catalog-editor/series/${series}`)).json().entries.map((e:{albumId:number})=>e.albumId)).toEqual([vol1,vol2]);
  expect((await remove(`/catalog-editor/series/${other}`)).statusCode).toBe(200);
 });

 it('borrar la serie no toca los discos y deshacer la restaura con sus entregas',async()=>{
  const series=(await get('/catalog-editor/series?q=Catia')).json().data[0].id;
  const deleted=await remove(`/catalog-editor/series/${series}`);expect(deleted.statusCode,deleted.body).toBe(200);
  expect((await get(`/catalog-editor/series/${series}`)).statusCode).toBe(404);
  expect((await anonymous(`/albums/${vol1}`)).json()).toMatchObject({id:vol1,series:[]});
  expect((await getPool().query('SELECT count(*)::int AS n FROM ingest.series_albums WHERE series_id=$1',[series])).rows[0].n).toBe(0);
  expect((await undo(deleted.json().runId)).statusCode).toBe(200);
  expect((await anonymous(`/series/${series}`)).json().volumes.map((v:{albumId:number})=>v.albumId)).toEqual([vol1,vol2]);
  expect((await remove(`/catalog-editor/series/999999`)).statusCode).toBe(404);
 });
});
