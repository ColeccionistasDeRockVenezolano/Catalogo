import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {loadCapture,readCaptureOriginal} from "../../verification/documents/capture.js";
import {getPool} from "../../db/client.js";
import {getEnv} from "../../config/env.js";
import {executionBudgetUsage} from "../../ai/budget.js";
import { ACQUISITION_METHODS } from "../../evidence/provenance.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { notFound } from "../http-errors.js";
import { controlIndividualVerification, activeIndividualJob, latestIndividualJob, getIndividualJob, getIndividualVerification, recoverIndividualJobs, startIndividualVerification } from "../../verification/store.js";
import {reprocessIndividualVerification} from "../../verification/store.js";
import {listVerificationVersions,getVerificationVersion} from "../../verification/history.js";
const area=z.enum(["identity","members","discography","missingAlbums","tracks","socials","genres","status","biography","images","labels"]);
const kind=z.enum(["person","artist","album","organization","track"]);
const locationSchema=z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative(),selector:z.string(),page:z.number().int().positive().optional(),context:z.enum(["navigation","footer","header","body","structured"]).optional(),confidence:z.number().optional(),bbox:z.object({x:z.number(),y:z.number(),width:z.number(),height:z.number(),unit:z.enum(["px","pt"])}).optional()});
const documentSchema=z.object({captureId:z.number().int().positive(),extractionHash:z.string().optional(),rawHash:z.string(),format:z.enum(["html","rendered_html","json","text","pdf","image"]),method:z.string(),extractionVersion:z.number().int(),complete:z.boolean(),unreadParts:z.array(z.string()),warnings:z.array(z.string())});
const evidence=z.object({contentHash:z.string().optional(),extractionHash:z.string().optional(),requiresOriginalReview:z.boolean().optional(),captureId:z.number().int().positive().optional(),locations:z.array(locationSchema).optional(),url:z.string(),title:z.string(),quote:z.string(),origin:z.enum(["page","search_snippet"]),fetchedAt:z.string(),
  capturedAt:z.string().nullable().optional(),readAt:z.string().nullable().optional(),acquisitionMethod:z.enum(ACQUISITION_METHODS).optional()});
const findingSchema=z.object({key:z.string(),area,label:z.string(),value:z.string().nullable(),expected:z.array(z.string()),context:z.array(z.string()),issue:z.string().nullable(),conflicted:z.boolean().optional(),status:z.enum(["confirmed","partial","contradicted","missing","unverified"]),observed:z.string().nullable(),explanation:z.string(),coverage:z.number().min(0).max(1),evidence:z.array(evidence)});
const researchSchema=z.object({
  version:z.literal(1),stopReason:z.enum(["paused","cancelled","budget"]).nullable(),
  consumption:z.object({calls:z.number().int().nonnegative(),cachedCalls:z.number().int().nonnegative(),tokensIn:z.number().int().nonnegative(),tokensOut:z.number().int().nonnegative(),unknownUsageCalls:z.number().int().nonnegative()}),
  tasks:z.array(z.object({id:z.string(),kind:z.enum(["search","acquire","evaluate","extract"]),input:z.string(),evaluatedKeys:z.array(z.string()).optional(),dependencies:z.array(z.string()),status:z.enum(["pending","running","completed","failed"]),attempts:z.number().int(),error:z.string().nullable(),updatedAt:z.string()})),
  sources:z.array(z.object({url:z.string(),status:z.enum(["discovered","obtained","partially_read","completely_read","failed","inaccessible"]),reason:z.string().nullable(),capturedAt:z.string().nullable(),contentHash:z.string().nullable(),attempts:z.number().int(),captureId:z.number().int().positive().optional(),chunks:z.object({total:z.number().int(),processed:z.number().int()})})),
});
export const verificationReportSchema=z.object({researchVersionId:z.number().int().positive().optional(),version:z.literal(1),research:researchSchema.optional(),inProgress:z.boolean().optional(),snapshotHash:z.string(),kind,entityId:z.number().int(),name:z.string(),createdAt:z.string(),researched:z.boolean(),stale:z.boolean(),score:z.number().min(0).max(100).nullable(),
  areas:z.array(z.object({key:area,label:z.string(),points:z.number(),maximum:z.number(),confirmed:z.number().int(),partial:z.number().int(),missing:z.number().int(),contradicted:z.number().int(),unverified:z.number().int()})),
  findings:z.array(findingSchema),suggestions:z.array(findingSchema).optional(),
  extractions:z.array(z.object({id:z.string(),kind:z.enum(["finding","discovery"]),key:z.string().nullable(),area:area.nullable(),value:z.string().nullable(),context:z.array(z.string()),state:z.enum(["supported","uncertain","contradicted","invalid"]),destination:z.enum(["already_present","proposal","conflict","pending","discarded"]),reason:z.string(),findingKey:z.string().nullable(),evidence:z.array(z.object({source:z.number().int(),url:z.string().nullable(),contentHash:z.string().nullable(),captureId:z.number().int().positive().nullable(),extractionHash:z.string().optional(),quote:z.string(),valid:z.boolean(),reason:z.string().nullable()}))})).optional(),
  rulesVersion:z.number().int().optional(),evaluation:z.object({total:z.number().int(),processed:z.number().int(),pendingKeys:z.array(z.string()),attempts:z.number().int(),complete:z.boolean(),sourceChunks:z.object({total:z.number().int(),processed:z.number().int()}).optional()}).optional(),
  issues:z.array(z.string()),limitations:z.array(z.string()),sources:z.array(evidence.omit({quote:true}).extend({contentHash:z.string(),document:documentSchema.optional()}))});
const jobSchema=z.object({researchVersionId:z.number().int().positive().optional(),sourceReportId:z.number().int().positive().optional(),resumeFromJobId:z.number().int().positive().optional(),reportId:z.number().int().positive().optional(),preservedOnly:z.boolean().optional(),id:z.number().int(),kind,entityId:z.number().int(),status:z.enum(["queued","running","done","failed","partial","paused","cancelled"]),control:z.enum(["continue","paused","cancelled"]).optional(),budget:z.object({maxCalls:z.number().int().positive().optional(),maxTokens:z.number().int().positive().optional()}).optional(),error:z.string().nullable(),requestedAt:z.string(),finishedAt:z.string().nullable(),progress:z.object({phase:z.enum(["collecting","evaluating","saving","done"]),completed:z.number().int(),total:z.number().int(),sources:z.number().int(),evaluated:z.number().int(),totalUnits:z.number().int(),updatedAt:z.string()}).nullable().optional()});
const budgetSchema=z.object({maxCalls:z.number().int().positive().optional(),maxTokens:z.number().int().positive().optional()}).strict();
const params=z.object({kind,id:z.coerce.number().int().positive()});
export async function registerEntityVerificationRoutes(app:FastifyInstance):Promise<void> {
  const server=app.withTypeProvider<ZodTypeProvider>();
  server.get("/entity-verification/budget",{schema:{tags:["verification"],security:OPERATOR_SECURITY,response:{200:z.object({id:z.string(),maxUsd:z.number(),chargedUsd:z.number(),calls:z.number().int(),tokens:z.number().int(),unknownCalls:z.number().int()}).nullable()}}},async()=>{
    const id=getEnv().CRV_AI_BUDGET_ID;return id?{id,...await executionBudgetUsage(id)}:null;
  });
  await recoverIndividualJobs();
  app.addHook("onSend", async (request,reply,payload) => {
    if (request.url.startsWith("/entity-verification/")) reply.header("cache-control","no-store");
    return payload;
  });
  server.get("/entity-verification/captures/:captureId/original",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params:z.object({captureId:z.coerce.number().int().positive()})}},async(request,reply)=>{
    const capture=await loadCapture(getPool(),request.params.captureId);if(!capture)throw notFound("captura",request.params.captureId);
    const bytes=await readCaptureOriginal(capture);
    const extension=capture.contentType.includes("pdf")?"pdf":capture.contentType.includes("html")?"html":capture.contentType.includes("png")?"png":capture.contentType.includes("jpeg")?"jpg":"bin";
    reply.header("content-disposition",`attachment; filename="captura-${capture.id}.${extension}"`).header("x-content-type-options","nosniff").header("content-security-policy","sandbox allow-downloads; default-src 'none'");
    return reply.type("application/octet-stream").send(Buffer.from(bytes));
  });
  server.get("/entity-verification/:kind/:id",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,response:{200:verificationReportSchema}}},async(request)=>getIndividualVerification(request.params.kind,request.params.id));
  const versionParams=params.extend({versionId:z.coerce.number().int().positive()});
  server.get("/entity-verification/:kind/:id/versions",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,querystring:z.object({beforeId:z.coerce.number().int().positive().optional()}).strict(),response:{200:z.object({versions:z.array(z.object({id:z.number().int().positive(),createdAt:z.string(),requestedBy:z.string(),sourceCount:z.number().int().nonnegative(),snapshotHash:z.string(),complete:z.boolean(),reprocessAvailable:z.boolean(),unavailableReason:z.string().nullable()})),nextBeforeId:z.number().int().positive().nullable()})}}},async request=>listVerificationVersions(request.params.kind,request.params.id,request.query.beforeId));
  server.get("/entity-verification/:kind/:id/versions/:versionId",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params:versionParams,response:{200:verificationReportSchema}}},async request=>getVerificationVersion(request.params.kind,request.params.id,request.params.versionId));
  server.post("/entity-verification/:kind/:id/versions/:versionId/reprocess",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params:versionParams,body:z.object({budget:budgetSchema.optional()}).strict().nullish(),response:{200:jobSchema}}},async request=>reprocessIndividualVerification(request.params.kind,request.params.id,request.params.versionId,request.operator,request.body?.budget));
  server.get("/entity-verification/:kind/:id/active-job",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,response:{200:jobSchema.nullable()}}},async(request)=>activeIndividualJob(request.params.kind,request.params.id));
  server.get("/entity-verification/:kind/:id/latest-job",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,response:{200:jobSchema.nullable()}}},async(request)=>latestIndividualJob(request.params.kind,request.params.id));
  server.post("/entity-verification/:kind/:id/jobs",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params,body:z.object({budget:budgetSchema.optional()}).strict().nullish(),response:{200:jobSchema}}},async(request)=>startIndividualVerification(request.params.kind,request.params.id,request.operator,undefined,request.body?.budget));
  server.post("/entity-verification/jobs/:jobId/control",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params:z.object({jobId:z.coerce.number().int().positive()}),body:z.object({action:z.enum(["pause","resume","cancel"]),budget:budgetSchema.optional()}).strict(),response:{200:jobSchema}}},async request=>controlIndividualVerification(request.params.jobId,request.body.action,request.operator,request.body.budget));
  server.get("/entity-verification/jobs/:jobId",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params:z.object({jobId:z.coerce.number().int().positive()}),response:{200:jobSchema}}},async(request)=>{
    const result=await getIndividualJob(request.params.jobId);if(!result)throw notFound("investigación",request.params.jobId);return result;
  });
}
