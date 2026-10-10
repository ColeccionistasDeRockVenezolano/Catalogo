import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OPERATOR_SECURITY } from "../auth.js";
import { notFound } from "../http-errors.js";
import { verificationReportSchema } from "./entity-verification.js";
import { comparisonHistory, activeComparisonJob, getComparison, getComparisonJob, recoverComparisonJobs, startComparison } from "../../verification/comparison-store.js";
const kind=z.enum(["artist","person","album"]);
const ref=z.object({kind,id:z.number().int().positive()});
const album=z.object({id:z.number().int(),title:z.string(),artist:z.string(),year:z.number().nullable()});
const side=ref.extend({name:z.string(),hash:z.string(),artistType:z.string().nullable(),facts:z.record(z.array(z.string())),verification:verificationReportSchema,
 snapshot:ref.extend({name:z.string(),identity:z.array(z.string()),sourceUrls:z.array(z.string()),albums:z.array(album),catalogAlbums:z.array(album),units:z.array(verificationReportSchema.shape.findings.element.omit({status:true,observed:true,explanation:true,coverage:true,evidence:true}))})});
export const comparisonReportSchema=z.object({version:z.literal(1),left:side,right:side,createdAt:z.string(),researched:z.boolean(),stale:z.boolean(),score:z.number().min(0).max(100).nullable(),catalogPoints:z.number(),webPoints:z.number(),
 rows:z.array(z.object({key:z.string(),label:z.string(),left:z.array(z.string()),right:z.array(z.string()),status:z.enum(["match","partial","different","missing"]),coverage:z.number().min(0).max(1),points:z.number(),maximum:z.number(),explanation:z.string()})),
 conclusion:z.enum(["same_identity","related","distinct","inconclusive"]),explanation:z.string(),evidence:z.array(verificationReportSchema.shape.findings.element.shape.evidence.element),limitations:z.array(z.string())});
const job=z.object({id:z.number().int(),left:ref,right:ref,status:z.enum(["queued","running","done","failed"]),error:z.string().nullable(),requestedAt:z.string(),finishedAt:z.string().nullable()});
const query=z.object({leftKind:kind,leftId:z.coerce.number().int().positive(),rightKind:kind,rightId:z.coerce.number().int().positive()});
export async function registerEntityComparisonRoutes(app:FastifyInstance):Promise<void> {
 await recoverComparisonJobs();
 const server=app.withTypeProvider<ZodTypeProvider>();
 server.get("/entity-verification/compare/history/:kind/:id",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params:ref.extend({id:z.coerce.number().int().positive()}),response:{200:z.array(z.object({target:ref,name:z.string(),createdAt:z.string(),jobId:z.number().nullable(),status:z.enum(["queued","running","done","failed"]).nullable()}))}}},async({params})=>comparisonHistory(params));
 server.get("/entity-verification/compare",{schema:{tags:["verification"],security:OPERATOR_SECURITY,querystring:query,response:{200:comparisonReportSchema}}},async({query:q})=>getComparison({kind:q.leftKind,id:q.leftId},{kind:q.rightKind,id:q.rightId}));
 server.get("/entity-verification/compare/active-job",{schema:{tags:["verification"],security:OPERATOR_SECURITY,querystring:query,response:{200:job.nullable()}}},async({query:q})=>activeComparisonJob({kind:q.leftKind,id:q.leftId},{kind:q.rightKind,id:q.rightId}));
 server.post("/entity-verification/compare/jobs",{schema:{tags:["verification"],security:OPERATOR_SECURITY,body:z.object({left:ref,right:ref}),response:{200:job}}},async(request)=>startComparison(request.body.left,request.body.right,request.operator));
 server.get("/entity-verification/compare/jobs/:id",{schema:{tags:["verification"],security:OPERATOR_SECURITY,params:z.object({id:z.coerce.number().int().positive()}),response:{200:job}}},async({params})=>{const result=await getComparisonJob(params.id);if(!result)throw notFound("comparación",params.id);return result;});
}
