import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { trackContexts, contextCoverage, contextReview, contextOntology } from "../../discovery/track-contexts.js";
import { importTrackContexts } from "../../discovery/track-context-curation.js";
import { trackContextBatchSchema } from "../../discovery/track-context-contract.js";
import { contextEvidenceSchema, recordContextEvidence } from "../../discovery/track-context-evidence.js";
const trackParams = z.object({ trackId: z.coerce.number().int().positive().safe() });
export async function registerTrackContextRoutes(app: FastifyInstance) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get("/discovery/track-contexts/:trackId", {
    schema: { tags: ["search"], summary: "Contextos aprobados de una pista de edición, con evidencia y origen de géneros", params: trackParams },
  }, async (request,reply) => { reply.header("Cache-Control","no-store"); return trackContexts(request.params.trackId); });
  api.get("/discovery/contexts/tracks/:trackId/review", {
    schema: { tags: ["curation"], summary: "Propuestas, decisiones y evaluaciones de una pista (administración)", params: trackParams },
  }, async (request,reply) => { reply.header("Cache-Control","no-store"); return contextReview(request.params.trackId); });
  api.get("/discovery/contexts/ontology", {
    schema: { tags: ["curation"], summary: "Ontología inicial versionada de contextos musicales" },
  }, async (_request,reply) => { reply.header("Cache-Control","no-store"); return contextOntology(); });
  api.get("/discovery/contexts/coverage", {
    schema: { tags: ["curation"], summary: "Cobertura y pertinencia por pista de edición (administración)",
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0), albumId: z.coerce.number().int().positive().safe().optional() }).strict() },
  }, async (request,reply) => {
    reply.header("Cache-Control","no-store");
    const { limit, offset, albumId } = request.query;
    return contextCoverage({ limit, offset, ...(albumId === undefined ? {} : { albumId }) });
  });
  api.post("/discovery/contexts/import", {
    bodyLimit: 2_000_000,
    schema: { tags: ["curation"], summary: "Vista previa o aplicación atómica de contextos revisados", body: z.object({ batch: trackContextBatchSchema, apply: z.boolean().default(false) }).strict() },
  }, async (request,reply) => {
    reply.header("Cache-Control","no-store");
    return importTrackContexts({ ...request.body.batch, reviewer: request.operator },request.body.apply);
  });
  api.post("/discovery/contexts/evidence", {
    bodyLimit: 32_000,
    schema: { tags: ["curation"], summary: "Registrar evidencia revisada en claims existentes, sin modificar la pista",
      body: z.object({ evidence: contextEvidenceSchema, apply: z.boolean().default(false) }).strict() },
  }, async (request,reply) => {
    reply.header("Cache-Control","no-store");
    return recordContextEvidence({ ...request.body.evidence,reviewer:request.operator },request.body.apply);
  });
}
