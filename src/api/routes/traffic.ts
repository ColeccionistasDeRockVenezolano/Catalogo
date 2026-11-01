// CRV · Ventana 3.7 (Métricas) y aviso interno del gateway.
//
// - GET    /community/admin/metrics?days=7|30|90 → informe de «Personas y bots».
// - DELETE /community/admin/metrics              → «Poner el contador a cero».
// - POST   /traffic/page                         → aviso del gateway (loopback,
//   token compartido) con las señales del visitante de un documento público.
//
// El informe es de lectura; el borrado no toca el contador público
// (`project_visit_stats`), solo el agregado de tráfico.
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getEnv } from "../../config/env.js";
import { ApiError } from "../http-errors.js";
import { clientIp } from "../auth.js";
import { projectId } from "../community/store.js";
import { classifyRequest, type RequestHeaders } from "../../traffic/classify.js";
import { recordTraffic, resetTraffic, TRAFFIC_PAGES, settleTraffic, type TrafficPage } from "../../traffic/record.js";
import { parseMetricsRange, trafficReport } from "../../traffic/report.js";

const pageBody = z.object({
  page: z.enum(TRAFFIC_PAGES),
  userAgent: z.string().max(512).optional(),
  accept: z.string().max(512).optional(),
  acceptLanguage: z.string().max(512).optional(),
  secFetchMode: z.string().max(64).optional(),
  secFetchSite: z.string().max(64).optional(),
  signatureAgent: z.string().max(512).optional(),
  country: z.string().max(8).optional(),
}).strict();

function sameToken(request: FastifyRequest): boolean {
  const expected = getEnv().CRV_TRAFFIC_TOKEN;
  const raw = request.headers["x-crv-traffic-token"];
  const given = typeof raw === "string" ? raw : "";
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

function requestCountry(request: FastifyRequest): string | null {
  const raw = request.headers["cf-ipcountry"] ?? request.headers["x-vercel-ip-country"] ?? request.headers["x-country"];
  return typeof raw === "string" ? raw : null;
}

export async function registerTrafficRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const env = getEnv();

  // El gateway reenvía la visita de cada documento público. Sin token, la ruta
  // no existe: el aviso es entre procesos de esta máquina, no una API pública.
  if (env.CRV_TRAFFIC_ENABLED && env.CRV_TRAFFIC_TOKEN) {
    api.post("/traffic/page", { schema: { tags: ["Tráfico"], body: pageBody } }, async (request, reply) => {
      if (!sameToken(request)) throw new ApiError(403, "forbidden", "Aviso interno sin token.");
      const project = await projectId();
      const headers: RequestHeaders = {
        "user-agent": request.body.userAgent,
        accept: request.body.accept,
        "accept-language": request.body.acceptLanguage,
        "sec-fetch-mode": request.body.secFetchMode,
        "sec-fetch-site": request.body.secFetchSite,
        "signature-agent": request.body.signatureAgent,
      };
      recordTraffic({
        projectId: project,
        page: request.body.page as TrafficPage,
        ip: clientIp(request),
        country: request.body.country ?? requestCountry(request),
        classification: classifyRequest(headers, "navigation"),
      });
      return reply.status(204).send();
    });
  }

  api.get("/community/admin/metrics", {
    schema: { tags: ["Tráfico"], querystring: z.object({ days: z.string().optional(), lang: z.enum(["es", "en"]).optional() }) },
  }, async (request) => {
    const project = await projectId();
    // Lo que acaba de pasar debe verse: se vacía la cola antes de leer.
    await settleTraffic();
    return trafficReport(project, parseMetricsRange(request.query.days), request.query.lang ?? "es");
  });

  api.delete("/community/admin/metrics", { schema: { tags: ["Tráfico"] } }, async () => {
    const project = await projectId();
    const cleared = await resetTraffic(project);
    return { ok: true, ...cleared };
  });
}
