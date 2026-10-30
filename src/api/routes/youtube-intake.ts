// CRV · Espacio de curaduría «Videos de YouTube».
//
// Lista los videos publicados del canal con su estado de alta, las revisiones
// de ingesta abiertas y las propuestas de IA que preparó el alta. Permite
// lanzar el análisis de un video o una pasada completa.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getEnv } from "../../config/env.js";
import { OPERATOR_SECURITY } from "../auth.js";
import {
  autoApproveReadyIntakes,
  intakeSummary,
  listIntakeVideos,
  runIntakeSweep,
  runVideoIntake,
} from "../../youtube/intake.js";

const params = z.object({ id: z.coerce.number().int().positive() });

export async function registerYouTubeIntakeRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/curation/ai/youtube/summary", {
    schema: { security: OPERATOR_SECURITY, response: { 200: z.unknown() } },
  }, () => intakeSummary());

  server.get("/curation/ai/youtube/videos", {
    schema: {
      security: OPERATOR_SECURITY,
      querystring: z.object({
        status: z.enum(["all", "sin-analizar", "planning", "ready", "review", "linked", "failed"]).optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
      }),
      response: { 200: z.unknown() },
    },
  }, (request) => listIntakeVideos({
    ...(request.query.status ? { status: request.query.status } : {}),
    ...(request.query.limit ? { limit: request.query.limit } : {}),
  }));

  server.post("/curation/ai/youtube/videos/:id/intake", {
    schema: { security: OPERATOR_SECURITY, params, response: { 200: z.unknown() } },
  }, (request) => runVideoIntake(request.params.id, { operator: request.operator }));

  server.post("/curation/ai/youtube/sweep", {
    schema: {
      security: OPERATOR_SECURITY,
      body: z.object({ limit: z.number().int().positive().max(20).optional() }).strict().optional(),
      response: { 200: z.unknown() },
    },
  }, (request) => runIntakeSweep({
    limit: request.body?.limit ?? getEnv().CRV_YT_INTAKE_MAX,
    ...(request.operator ? { operator: request.operator } : {}),
  }));

  server.post("/curation/ai/youtube/auto", {
    schema: { security: OPERATOR_SECURITY, response: { 200: z.unknown() } },
  }, () => autoApproveReadyIntakes());
}
