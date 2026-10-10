import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OPERATOR_SECURITY } from "../auth.js";
import { notFound } from "../http-errors.js";
import { activeIndividualJob, latestIndividualJob, getIndividualJob, getIndividualVerification, recoverIndividualJobs, startIndividualVerification } from "../../verification/store.js";
const area=z.enum(["identity","members","discography","missingAlbums","tracks","socials","genres","status","biography","images","labels"]);
const kind=z.enum(["person","artist","album"]);
const evidence=z.object({url:z.string(),title:z.string(),quote:z.string(),origin:z.enum(["page","search_snippet"]),fetchedAt:z.string()});
const findingSchema=z.object({key:z.string(),area,label:z.string(),value:z.string().nullable(),expected:z.array(z.string()),context:z.array(z.string()),issue:z.string().nullable(),status:z.enum(["confirmed","partial","contradicted","missing","unverified"]),observed:z.string().nullable(),explanation:z.string(),coverage:z.number().min(0).max(1),evidence:z.array(evidence)});
export const verificationReportSchema=z.object({version:z.literal(1),inProgress:z.boolean().optional(),snapshotHash:z.string(),kind,entityId:z.number().int(),name:z.string(),createdAt:z.string(),researched:z.boolean(),stale:z.boolean(),score:z.number().min(0).max(100).nullable(),
  areas:z.array(z.object({key:area,label:z.string(),points:z.number(),maximum:z.number(),confirmed:z.number().int(),partial:z.number().int(),missing:z.number().int(),contradicted:z.number().int(),unverified:z.number().int()})),
  findings:z.array(findingSchema),suggestions:z.array(findingSchema).optional(),
  rulesVersion:z.number().int().optional(),evaluation:z.object({total:z.number().int(),processed:z.number().int(),pendingKeys:z.array(z.string()),attempts:z.number().int(),complete:z.boolean(),sourceChunks:z.object({total:z.number().int(),processed:z.number().int()}).optional()}).optional(),
  issues:z.array(z.string()),limitations:z.array(z.string()),sources:z.array(evidence.omit({quote:true}).extend({contentHash:z.string()}))});
const jobSchema=z.object({id:z.number().int(),kind,entityId:z.number().int(),status:z.enum(["queued","running","done","failed"]),error:z.string().nullable(),requestedAt:z.string(),finishedAt:z.string().nullable(),progress:z.object({phase:z.enum(["collecting","evaluating","saving","done"]),completed:z.number().int(),total:z.number().int(),sources:z.number().int(),evaluated:z.number().int(),totalUnits:z.number().int(),updatedAt:z.string()}).nullable().optional()});
const params=z.object({kind,id:z.coerce.number().int().positive()});
export async function registerEntityVerificationRoutes(app:FastifyInstance):Promise<void> {
  const server=app.withTypeProvider<ZodTypeProvider>();
  await recoverIndividualJobs();
  app.addHook("onSend", async (request,reply,payload) => {
    if (request.url.startsWith("/entity-verification/")) reply.header("cache-control","no-store");
    return payload;
  });
  server.get("/entity-verification/:kind/:id",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,response:{200:verificationReportSchema}}},async(request)=>getIndividualVerification(request.params.kind,request.params.id));
  server.get("/entity-verification/:kind/:id/active-job",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,response:{200:jobSchema.nullable()}}},async(request)=>activeIndividualJob(request.params.kind,request.params.id));
  server.get("/entity-verification/:kind/:id/latest-job",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,response:{200:jobSchema.nullable()}}},async(request)=>latestIndividualJob(request.params.kind,request.params.id));
  server.post("/entity-verification/:kind/:id/jobs",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,response:{200:jobSchema}}},async(request)=>startIndividualVerification(request.params.kind,request.params.id,request.operator));
  server.get("/entity-verification/jobs/:jobId",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params:z.object({jobId:z.coerce.number().int().positive()}),response:{200:jobSchema}}},async(request)=>{
    const result=await getIndividualJob(request.params.jobId);if(!result)throw notFound("investigación",request.params.jobId);return result;
  });
}
