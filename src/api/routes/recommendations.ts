import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { recommend, recordRecommendationFeedback, importRecommendationVersions, recommendationFeedbackReport } from "../../discovery/recommendations.js";
import { recommendationRequestSchema, feedbackSchema, versionBatchSchema } from "../../discovery/recommendation-contract.js";
import { createWindowLimiter } from "../rate-limit.js";
import { ApiError } from "../http-errors.js";
export async function registerRecommendationRoutes(app: FastifyInstance) {
  const api=app.withTypeProvider<ZodTypeProvider>();
  const limiter=createWindowLimiter({windowMs:60000,max:10,maxKeys:500});
  api.post("/discovery/recommendations",{bodyLimit:32000,schema:{tags:["curation"],summary:"Recomendación explicable con intención validada y pistas aprobadas",body:recommendationRequestSchema}},async (request,reply)=> {
    reply.header("Cache-Control","no-store");
    if (!limiter.take(request.operator)) throw new ApiError(429,"rate_limited","Demasiadas solicitudes de recomendación");
    return recommend(request.body,request.operator,true);
  });
  api.post("/discovery/recommendations/feedback",{bodyLimit:16000,schema:{tags:["curation"],summary:"Feedback explícito de una respuesta concreta",body:feedbackSchema}},async(request,reply)=> {
    reply.header("Cache-Control","no-store"); return recordRecommendationFeedback(request.body,request.operator);
  });
  api.get("/discovery/recommendations/evaluation",{schema:{tags:["curation"],summary:"Feedback revisado; discrepancias separadas de pertinencia"}},async(_request,reply)=> {
    reply.header("Cache-Control","no-store"); return recommendationFeedbackReport();
  });
  api.post("/discovery/recommendations/versions",{bodyLimit:250000,schema:{tags:["curation"],summary:"Vista previa/aplicación de equivalencias de obra revisadas",body:z.object({batch:versionBatchSchema,apply:z.boolean().default(false)}).strict()}},async(request,reply)=> {
    reply.header("Cache-Control","no-store"); return importRecommendationVersions({...request.body.batch,reviewer:request.operator},request.body.apply);
  });
}
