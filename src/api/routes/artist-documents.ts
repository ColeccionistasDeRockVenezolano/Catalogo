import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DOCUMENT_CATEGORIES } from '../../shared/artist-documents.js';
import { OPERATOR_SECURITY } from '../auth.js';
import { withOperatorRun } from '../../merge/operator.js';
import { notFound } from '../http-errors.js';
import { noteSchema } from './catalog-writes.js';
export const documentSchema=z.object({id:z.number().int(),category:z.enum(DOCUMENT_CATEGORIES),title:z.string(),content:z.string(),
 sourceUrl:z.string().nullable(),archiveUrl:z.string().nullable(),dateText:z.string().nullable(),location:z.string().nullable(),tags:z.array(z.string())});
export async function registerArtistDocumentRoutes(app:FastifyInstance):Promise<void>{
 app.withTypeProvider<ZodTypeProvider>().patch('/artists/:id/documents',{
  schema:{tags:['artists'],security:OPERATOR_SECURITY,params:z.object({id:z.coerce.number().int().positive()}),
   body:z.object({ids:z.array(z.number().int().positive()).min(1).max(500),category:z.enum(DOCUMENT_CATEGORIES),note:noteSchema}).strict(),
   response:{200:z.object({runId:z.number().int(),updated:z.number().int()})}},
 },async request=>{
  const ids=[...new Set(request.body.ids)];
  const {runId,result}=await withOperatorRun({name:'api:reclassify:artist-documents',operator:request.operator,note:request.body.note,params:{artistId:request.params.id}},async({client,runId})=>{
   await client.query("SELECT set_config('crv.run_id',$1,true)",[String(runId)]);
   const found=await client.query('SELECT id FROM media.artist_documents WHERE artist_id=$1 AND id=ANY($2::bigint[]) FOR UPDATE',[request.params.id,ids]);
   if(found.rowCount!==ids.length)throw notFound('Documento del artista',request.params.id);
   await client.query('UPDATE media.artist_documents SET category=$3,updated_at=now() WHERE artist_id=$1 AND id=ANY($2::bigint[])',[request.params.id,ids,request.body.category]);
   return ids.length;
  });
  return {runId,updated:result};
 });
}
