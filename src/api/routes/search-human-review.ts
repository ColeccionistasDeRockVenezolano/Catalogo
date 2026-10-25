import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import { projectRoot } from "../../config/project-root.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { adjudicateMapping, blindSchema, humanEvaluationState, mappingAdjudicationState, saveBlindReading, saveVerdict, verdictSchema } from "../../search/human-review.js";

const root = projectRoot(import.meta.url);

// Evaluación humana del estudio y adjudicación de correspondencias (etapa 2).
// Bajo /search/administration: solo administradores leen y escriben.
export async function registerSearchHumanReviewRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get("/search/administration/human-evaluation", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return humanEvaluationState(root, getPool(), request.operator);
  });
  api.post("/search/administration/human-evaluation/:id/blind", {
    schema: { security: OPERATOR_SECURITY, params: z.object({ id: z.string().min(1).max(40) }), body: blindSchema },
  }, async request => ({ annotation: await saveBlindReading(root, getPool(), request.operator, request.params.id, request.body) }));
  api.post("/search/administration/human-evaluation/:id/verdict", {
    schema: { security: OPERATOR_SECURITY, params: z.object({ id: z.string().min(1).max(40) }),
      body: z.object({ verdict: verdictSchema, note: z.string().trim().max(1000).default("") }).strict() },
  }, async request => {
    await saveVerdict(root, getPool(), request.operator, request.params.id, request.body.verdict, request.body.note);
    return { saved: true as const };
  });
  api.get("/search/administration/mapping-adjudications", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return mappingAdjudicationState(root, getPool());
  });
  api.post("/search/administration/mapping-adjudications/decision", {
    schema: { security: OPERATOR_SECURITY, body: z.object({ term: z.string().min(1).max(200), decision: z.enum(["approved", "corrected", "rejected"]),
      targetSlug: z.string().trim().min(1).nullable().default(null), relation: z.enum(["equivalence", "specialization", "partial", "pending"]).nullable().default(null),
      note: z.string().trim().max(1000).default("") }).strict() },
  }, async request => {
    const { term, ...decision } = request.body;
    await adjudicateMapping(root, getPool(), request.operator, term, decision);
    return { saved: true as const };
  });
}
