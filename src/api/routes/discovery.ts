import type { FastifyInstance } from "fastify";
import { createHmac, randomBytes } from "node:crypto";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { searchSuggestions } from "../../discovery/suggestions.js";
import { collectMetric, metricEventSchema, metricsReady, suggestionTicket } from "../../discovery/metrics.js";
import { trendPrototype, trendPrototypeSchema } from "../../discovery/trends.js";
import { createWindowLimiter } from "../rate-limit.js";
import { ApiError } from "../http-errors.js";
import { dailyCycleSchema, dailyDateSchema } from "../daily-cycle.js";
export async function registerDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  const perIp = createWindowLimiter({ max: 120, windowMs: 60_000, maxKeys: 2000 });
  const total = createWindowLimiter({ max: 10000, windowMs: 60_000, maxKeys: 1 });
  const rateSecret = randomBytes(32);
  app.withTypeProvider<ZodTypeProvider>().get("/discovery/search-suggestions", {
    schema: { tags: ["search"], summary: "Ejemplos editoriales aprobados del catálogo local",
      querystring: z.object({ date: dailyDateSchema.optional() }),
      response: { 200: z.object({ dailyCycle: dailyCycleSchema, enabled: z.boolean(), intervalMs: z.number(), refreshMs: z.number(), fallback: z.string(),
        groupPolicy: z.array(z.string()), metrics: z.object({ enabled: z.boolean(), visibleMs: z.number(), attributionMs: z.number() }),
        suggestions: z.array(z.object({ id: z.number(), name: z.string(),
          group: z.string(), priority: z.number(), validUntil: z.string().nullable(), metricTicket: z.string().optional() })) }) } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const data = await searchSuggestions(undefined, request.query.date);
    const unknownSession = request.viewer === null && /(?:^|;\s*)crv_session=/u.test(request.headers.cookie ?? "");
    const enabled = data.enabled && request.viewer?.role !== "admin" && !unknownSession && !request.headers.authorization && await metricsReady();
    const selection = JSON.stringify(data.suggestions.map(s => [s.id,s.name,s.group,s.priority]));
    return { ...data, metrics: { enabled, visibleMs: 1000, attributionMs: 900000 },
      suggestions: data.suggestions.map(s => ({ ...s, ...(enabled ? { metricTicket: suggestionTicket(s.id, s.group, s.priority, selection) } : {}) })) };
  });
  app.withTypeProvider<ZodTypeProvider>().post("/discovery/metrics/events", {
    bodyLimit: 4096,
    schema: { tags: ["search"], body: metricEventSchema,
      response: { 202: z.object({ status: z.string(), receipt: z.string().optional() }) } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const unknownSession = request.viewer === null && /(?:^|;\s*)crv_session=/u.test(request.headers.cookie ?? "");
    if (request.viewer?.role === "admin" || unknownSession || request.headers.authorization || !request.headers.origin
      || /bot|crawler|spider|headless|playwright|selenium/iu.test(request.headers["user-agent"] ?? "")) {
      return reply.code(202).send({ status: "excluded" });
    }
    const rateKey = createHmac("sha256",rateSecret).update(`${Math.floor(Date.now()/60000)}:${request.ip}`).digest("hex");
    if (!total.take("all") || !perIp.take(rateKey)) throw new ApiError(429, "rate_limited", "Límite de eventos por minuto");
    return reply.code(202).send(await collectMetric(request.body));
  });
  app.get("/discovery/metrics/prototype", { schema: { tags: ["search"], summary: "Prototipo interno, acceso administrativo", response: { 200: trendPrototypeSchema } } }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return trendPrototype();
  });
}
