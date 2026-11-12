import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OPERATOR_SECURITY } from "../auth.js";
import { closeCaseSchema, closeImprovementCase, improvementState, openCaseSchema, openImprovementCase } from "../../search/improvement.js";

// Etapa 5 (reducida): bandeja de mejora manual. Bajo /search/administration: solo administradores leen y escriben.
export async function registerSearchImprovementRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get("/search/administration/improvement", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return improvementState();
  });
  api.post("/search/administration/improvement", { schema: { security: OPERATOR_SECURITY, body: openCaseSchema } },
    async request => openImprovementCase(request.body, request.operator));
  api.post("/search/administration/improvement/:id/close", {
    schema: { security: OPERATOR_SECURITY, params: z.object({ id: z.coerce.number().int().positive() }), body: closeCaseSchema },
  }, async request => closeImprovementCase(request.params.id, request.body, request.operator));
}
