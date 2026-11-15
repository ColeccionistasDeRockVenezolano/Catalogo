// CRV · Errores del navegador al log (Brian, 2026-11-12).
// Quien visita solo ve un código de referencia; el detalle llega aquí y se
// registra con ese código para buscarlo cuando alguien lo comparta.
// Escritura abierta con origen confiable (auth.ts) y límite por IP.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { moduleLogger } from "../../logger/index.js";
import { ApiError } from "../http-errors.js";
import { clientIp } from "../auth.js";
import { createWindowLimiter } from "../rate-limit.js";
import { INCIDENT_CODE } from "../incident-code.js";

const log = moduleLogger("client-errors");

const reportBody = z.object({
  code: z.string().regex(INCIDENT_CODE),
  kind: z.enum(["render", "load", "runtime"]),
  path: z.string().max(300).optional(),
  message: z.string().max(500).optional(),
  stack: z.string().max(4000).optional(),
  componentStack: z.string().max(4000).optional(),
  status: z.number().int().min(0).max(599).optional(),
  apiCode: z.string().max(60).optional(),
}).strict();

export async function registerClientErrorRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const limiter = createWindowLimiter({ max: 30, windowMs: 10 * 60_000, maxKeys: 5_000 });

  api.post("/client-errors", {
    bodyLimit: 16 * 1024,
    schema: { tags: ["health"], body: reportBody },
  }, async (request, reply) => {
    if (!limiter.take(clientIp(request))) throw new ApiError(429, "rate_limited", "Demasiados reportes.");
    const userAgent = request.headers["user-agent"];
    log.warn({
      ...request.body,
      userAgent: typeof userAgent === "string" ? userAgent.slice(0, 200) : undefined,
    }, "error en el navegador");
    return reply.status(204).send();
  });
}
