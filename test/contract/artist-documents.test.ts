import Fastify, {type FastifyInstance} from 'fastify';
import {serializerCompiler,validatorCompiler} from 'fastify-type-provider-zod';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {startPgContainer,type PgContainer} from '../support/pg-container.js';import {applyCore} from '../support/apply-core.js';
import {migrateUp} from '../../src/db/migrate.js';import {getPool,closeDb} from '../../src/db/client.js';import {resetEnvCache} from '../../src/config/env.js';
import {registerOperatorAuth,resetAuthStateForTests} from '../../src/api/auth.js';import {registerArtistDocumentRoutes} from '../../src/api/routes/artist-documents.js';
import {toApiError} from '../../src/api/http-errors.js';import {withOperatorRun} from '../../src/merge/operator.js';import {undoRun} from '../../src/merge/run-undo.js';
import {artistDocuments} from '../../src/api/repositories/artist-documents.js';import {listChanges} from '../../src/api/repositories/changes.js';
describe('archivo de artista: reclasificación en lote, permisos, pertenencia y deshacer',()=>{
 let pg:PgContainer,app:FastifyInstance,artist:number,other:number,one:number,two:number,foreign:number;
 const env={...process.env};const headers={authorization:'Bearer archive-contract-test-token-2026'};
 beforeAll(async()=>{
  pg=await startPgContainer();process.env['DATABASE_URL']=pg.databaseUrl;process.env['CRV_OPERATOR_TOKEN']='archive-contract-test-token-2026';delete process.env['CRV_HERRA_DB_PATH'];resetEnvCache();resetAuthStateForTests();
  await applyCore(pg.name);await migrateUp();
  const ids=(await getPool().query("INSERT INTO public.artists(name) VALUES('Archivo de prueba'),('Otro artista') RETURNING id")).rows;artist=Number(ids[0].id);other=Number(ids[1].id);
  const docs=(await getPool().query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,tags) VALUES($1,'a','other','Entrevista','Preguntas y respuestas',ARRAY['archivo-wayback-2026-10-22']),($1,'b','article','Crónica','Crónica documentada','{}'),($2,'c','other','Ajeno','Documento de otra ficha','{}') RETURNING id`,[artist,other])).rows;one=Number(docs[0].id);two=Number(docs[1].id);foreign=Number(docs[2].id);
  app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);app.setErrorHandler((e,_r,reply)=>{const expected=toApiError(e);return expected?reply.code(expected.statusCode).send({error:{message:expected.message}}):reply.send(e);});await registerOperatorAuth(app);await registerArtistDocumentRoutes(app);
 });
 afterAll(async()=>{await app?.close();await closeDb();await pg?.stop();for(const k of ['DATABASE_URL','CRV_OPERATOR_TOKEN','CRV_HERRA_DB_PATH']){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}resetEnvCache();resetAuthStateForTests();});
 it('rechaza escrituras sin permiso y evita lotes que incluyan documentos de otra ficha',async()=>{
  const url=`/artists/${artist}/documents`;const payload={ids:[one,two],category:'interview',note:'Clasificar entrevistas del archivo'};
  expect((await app.inject({method:'PATCH',url,payload})).statusCode).toBe(401);
  expect((await app.inject({method:'PATCH',url,headers,payload:{...payload,ids:[one,foreign]}})).statusCode).toBe(404);
  expect((await artistDocuments(artist)).find(d=>d.id===one)?.category).toBe('other');
  expect((await app.inject({method:'PATCH',url,headers,payload:{...payload,category:'invalid'}})).statusCode).toBe(400);
 });
 it('mueve el lote sin perder contenido, etiquetas ni procedencia, registra historial y permite deshacer',async()=>{
  const before=await artistDocuments(artist);const response=await app.inject({method:'PATCH',url:`/artists/${artist}/documents`,headers,payload:{ids:[one,two,one],category:'interview',note:'Reclasificar entrevistas documentadas'}});
  expect(response.statusCode,response.body).toBe(200);expect(response.json().updated).toBe(2);
  const moved=await artistDocuments(artist);expect(moved.every(d=>d.category==='interview')).toBe(true);expect(moved.find(d=>d.id===one)?.tags).toEqual(['archivo-wayback-2026-10-22']);
  expect((await listChanges({entity:'artist',id:artist,limit:20,offset:0})).rows.some(r=>r.runId===response.json().runId)).toBe(true);
  await withOperatorRun({name:'test:undo-documents',operator:'test',note:'Deshacer reclasificación'},ctx=>undoRun(ctx,response.json().runId));
  expect(await artistDocuments(artist)).toEqual(before);
 });
});
