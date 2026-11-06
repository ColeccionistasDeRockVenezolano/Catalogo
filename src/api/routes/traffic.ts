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
import { ACQUISITION_PAGES, attributionFromUrl } from '../../traffic/attribution.js';
import { recordAcquisition } from '../../traffic/acquisition.js';
import { createWindowLimiter } from '../rate-limit.js';

const pageBody = z.object({
  page: z.enum(TRAFFIC_PAGES),
  userAgent: z.string().max(512).optional(),
  accept: z.string().max(512).optional(),
  acceptLanguage: z.string().max(512).optional(),
  secFetchMode: z.string().max(64).optional(),
  secFetchSite: z.string().max(64).optional(),
  signatureAgent: z.string().max(512).optional(),
  country: z.string().max(8).optional(),
  url: z.string().max(4096).optional(),
  referrer: z.string().max(2048).optional(),
}).strict();

const attributionBody = z.object({
  ref: z.string().max(80).optional(), source: z.string().max(80).optional(), medium: z.string().max(80).optional(),
  campaign: z.string().max(80).optional(), content: z.string().max(80).optional(), referrer: z.string().max(2048).optional(),
}).strict();
const eventBody = z.object({
  page: z.enum(ACQUISITION_PAGES), kind: z.enum(['page', 'collaborate', 'radio']),
  eventId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/u), webdriver: z.boolean(), attribution: attributionBody,
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
  const eventLimiter = createWindowLimiter({ max: 120, windowMs: 60_000, maxKeys: 10_000 });

  if (env.CRV_TRAFFIC_ENABLED) {
    api.post('/traffic/event', { schema: { tags: ['Tráfico'], body: eventBody }, bodyLimit: 4096 }, async (request, reply) => {
      if (!eventLimiter.take(clientIp(request))) throw new ApiError(429, 'rate_limited', 'Demasiados avisos de tráfico.');
      recordAcquisition({ projectId: await projectId(), ip: clientIp(request), country: requestCountry(request),
        page: request.body.page, kind: request.body.kind, eventId: request.body.eventId,
        attribution: request.body.attribution, classification: classifyRequest(request.headers, 'beacon', request.body.webdriver) });
      return reply.header('Cache-Control', 'no-store').status(204).send();
    });
  }

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
      if ((ACQUISITION_PAGES as readonly string[]).includes(request.body.page)) {
        recordAcquisition({ projectId: project, ip: clientIp(request), country: request.body.country ?? requestCountry(request),
          page: request.body.page as typeof ACQUISITION_PAGES[number], kind: 'navigation',
          classification: classifyRequest(headers, 'navigation'),
          attribution: attributionFromUrl(request.body.url ?? '/', request.body.referrer ?? '') });
      }
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
