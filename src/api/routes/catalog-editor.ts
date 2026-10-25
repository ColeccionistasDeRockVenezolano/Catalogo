import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EDITOR_RESOURCES, readEditorVocabulary, readEditorEntity, readEditorResource, writeEditorResource, type EditorResource } from '../../catalog/editor.js';
import { withOperatorRun } from '../../merge/operator.js';
import { OPERATOR_SECURITY } from '../auth.js';
import { noteSchema } from './catalog-writes.js';
import { writeErrorResponses } from '../schemas.js';
import { ALBUM_EDITION_TYPES } from '../../shared/album-categories.js';
import { STREAMING_PLATFORMS } from '../../shared/platforms.js';
import { parseDateValue } from '../../catalog/date-value.js';
const id=z.coerce.number().int().positive();const positive=z.number().int().positive();
const text=(max=250)=>z.string().trim().min(1).max(max);
const date=text(40).refine(v=>{try{parseDateValue(v);return true;}catch{return false;}},'Fecha inválida: usa AAAA, AAAA-MM, AAAA-MM-DD, ~ o inicio/fin.');
const optionalText=text(20000).nullable().optional();
const mediaUrl=z.string().max(2000).refine(v=>z.string().url().safeParse(v).success||/^\/crv\/media\/[A-Za-z0-9_./-]+$/.test(v));
const shapes={
 version:z.object({position:positive.max(999).optional(),title:text().nullable().optional(),format:text(60).nullable().optional(),formatDetails:optionalText,catalogNumber:text(120).nullable().optional(),country:text(120).nullable().optional(),releaseYear:z.number().int().min(1890).max(2100).nullable().optional(),releaseDate:date.nullable().optional(),coverUrl:mediaUrl.nullable().optional(),notes:optionalText,distinctTracks:z.boolean().optional(),discNumbers:z.array(positive.max(99)).max(99).optional(),isPrimary:z.boolean().optional(),sourceRef:text(2000).nullable().optional(),editionTypes:z.array(z.string().refine(v=>ALBUM_EDITION_TYPES.some(t=>t.key===v))).max(ALBUM_EDITION_TYPES.length).optional()}),
 label:z.object({organizationId:positive,versionId:positive.nullable().optional(),role:z.enum(['label','distributor','licensee']),position:positive.max(999).optional(),sourceText:optionalText,notes:optionalText}),
 disc:z.object({discNumber:positive.max(99),title:text(120),notes:optionalText}),
 discLink:z.object({discNumber:positive.max(99),platform:z.enum(STREAMING_PLATFORMS),url:z.string().url().max(2000),verified:z.boolean().optional(),notes:optionalText}),
 audiovisual:z.object({title:text(2000),releaseYear:z.number().int().min(1890).max(2100).nullable().optional(),kind:z.enum(['documentary','live_concert','music_video','interview','short','other']),description:optionalText,url:z.string().url().max(2000).nullable().optional()}),
 time:z.object({trackId:positive,videoId:positive,startSeconds:z.number().int().min(0),endSeconds:z.number().int().min(1).nullable().optional()}),
};
export async function registerCatalogEditorRoutes(app:FastifyInstance) {
 const server=app.withTypeProvider<ZodTypeProvider>();
 server.get('/catalog-editor/vocabulary',{schema:{security:OPERATOR_SECURITY,response:{200:z.unknown(),...writeErrorResponses}}},async(_req,reply)=>{reply.header('cache-control','private, no-store');return readEditorVocabulary();});
 server.get('/catalog-editor/entity/:kind/:id',{schema:{security:OPERATOR_SECURITY,params:z.object({kind:z.enum(['album','artist','person','organization','track']),id}),response:{200:z.unknown(),...writeErrorResponses}}},async(req,reply)=>{
  reply.header('cache-control','private, no-store');return readEditorEntity(req.params.kind,req.params.id);
 });
 for(const resource of Object.keys(EDITOR_RESOURCES) as EditorResource[]) {
  const path=`/catalog-editor/${EDITOR_RESOURCES[resource].owner}/:ownerId/${resource}`;
  const params=z.object({ownerId:id});const itemParams=params.extend({id});
  server.get(path,{schema:{security:OPERATOR_SECURITY,params,response:{200:z.array(z.record(z.unknown())),...writeErrorResponses}}},async(req,reply)=>{
   reply.header('cache-control','private, no-store');return readEditorResource(resource,req.params.ownerId);
  });
  for(const method of ['POST','PATCH','DELETE'] as const) {
   const shape:z.AnyZodObject=shapes[resource];
   const schema={security:OPERATOR_SECURITY,params:method==='POST'?params:itemParams,
    ...(method==='DELETE'?{querystring:z.object({note:noteSchema})}:{body:(method==='PATCH'?shape.partial():shape).extend({note:noteSchema}).strict()}),
    response:{200:z.object({id:positive,runId:positive}),...writeErrorResponses}};
   server.route({method,url:method==='POST'?path:`${path}/:id`,schema,handler:async(req)=>{
    const p=req.params as {ownerId:number;id?:number};const {note,...input}=(method==='DELETE'?req.query:req.body) as Record<string,unknown>&{note:string};
    const result=await withOperatorRun({name:`api:editor:${method.toLowerCase()}:${resource}`,operator:req.operator,note},ctx=>writeEditorResource(ctx,resource,p.ownerId,method==='DELETE'?null:input,p.id));
    return {id:result.result,runId:result.runId};
   }});
  }
 }
}
