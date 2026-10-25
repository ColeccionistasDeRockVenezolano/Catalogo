import { decideKnowledge, knowledgeDecisionSchema, knowledgeReviewDetail, publishedKnowledge } from "../../search/knowledge-publication.js";
import { knowledgeAdministration } from "../../search/knowledge-administration.js";
import { searchAdministration } from "../../search/administration.js";
import { randomUUID } from "node:crypto";
import { searchCollector, confirmationSchema, retainSearchAnalytics, type SearchSnapshot } from "../../search/observability.js";
import { INTENTION_VERSION, OBSERVABILITY_VERSION } from "../../search/contracts.js";
import { searchSample } from "../../search/privacy.js";
import { searchIndexVersion } from "../search-index.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ALL_SEARCH_TYPES, searchEntityTypeSchema } from "../schemas.js";
import { globalSearch } from "../repositories/search.js";
import { detectEmotionIntent, emotionArtists } from "../repositories/emotions.js";
import { emotionArtistSchema, emotionSchema } from "./emotions.js";
import { ApiError, badRequest } from "../http-errors.js";
import { clientIp, isLocalRequest } from "../auth.js";
import { createWindowLimiter } from "../rate-limit.js";
import { flushSearchMisses, listSearchMisses, recordSearchMiss } from "../search-misses.js";

const searchHitSchema = z.object({
  type: searchEntityTypeSchema,
  id: z.number().int(),
  label: z.string(),
  context: z.string().nullable(),
  albumId: z.number().int().nullable(),
  /** Portada, foto o logo para la miniatura del resultado; null si la ficha no tiene. */
  imageUrl: z.string().nullable().optional(),
});

const searchQuerySchema = z.object({
  // Sin mínimo de letras (hay fichas de una o dos: «C4», «SS», «pm»); el tope evita consultas absurdas.
  q: z.string().trim().min(1, "q es obligatorio").max(1000, "q admite hasta 1000 caracteres"),
  types: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

// Techo de búsquedas por IP y por minuto, aparte del general del gateway
// (1.200 solicitudes de todo tipo). Escribiendo sin parar, con la espera de
// 250 ms entre teclas, una persona no pasa de ~4 por segundo y nunca durante un
// minuto entero; 180 deja holgura y corta un barrido automático. El total
// protege a la API de muchas IPs a la vez. El tráfico local (scripts,
// pruebas) queda fuera, igual que en el inicio de sesión.
const SEARCHES_PER_IP_PER_MINUTE = 180;
const SEARCHES_PER_MINUTE = 6_000;

const missesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
  days: z.coerce.number().int().positive().max(365).default(30),
});

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const perIp = createWindowLimiter({ max: SEARCHES_PER_IP_PER_MINUTE, windowMs: 60_000, maxKeys: 5_000 });
  const confirmations = createWindowLimiter({ max: 240, windowMs: 60_000, maxKeys: 5000 });
  const total = createWindowLimiter({ max: SEARCHES_PER_MINUTE, windowMs: 60_000, maxKeys: 1 });
  // Lo pendiente no espera al próximo volcado si la API se apaga.
  const flushTimer = setInterval(() => { void searchCollector.flush(); }, 5000).unref();
  const retentionTimer = setInterval(() => { void retainSearchAnalytics().catch(() => app.log.warn({ code: "search_retention_failed" }, "falló la retención de analítica")); }, 60 * 60_000).unref();
  app.addHook("onClose", async () => {
    clearInterval(flushTimer); clearInterval(retentionTimer);
    await searchCollector.flush();
    for (let i = 0; i < 20 && searchCollector.status().pending; i++) {
      const failed = searchCollector.quality.failed;
      await searchCollector.flush();
      if (searchCollector.quality.failed > failed) break;
    }
    await flushSearchMisses();
  });

  server.post("/search/confirmations", { bodyLimit: 2048, schema: { body: confirmationSchema } }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!request.headers.origin) throw new ApiError(403, "origin_required", "La confirmación requiere un origen de navegador permitido");
    if (!eligible(request) || !confirmations.take(clientIp(request))) {
      searchCollector.quality.excluded++;
      return { status: "excluded" };
    }
    return { status: searchCollector.confirm(request.body) };
  });

  server.get("/search", {
    onError: async (request, reply, error) => {
      // Failures in authentication/rate limiting can happen before the search handler.
      if (reply.getHeader("x-crv-search-receipt") || !eligible(request)) return;
      const parsed = searchQuerySchema.safeParse(request.query);
      if (!parsed.success) return;
      const snapshot = initialSnapshot(parsed.data.q);
      snapshot.incident = incidentFor(error);
      snapshot.timings["server"] = reply.elapsedTime;
      const receipt = searchCollector.issue(parsed.data.q, snapshot);
      if (receipt) reply.header("x-crv-search-receipt", receipt);
    },
    schema: {
      tags: ["search"],
      summary: "Búsqueda global (artista, persona, disco, pista, organización); los alias participan.",
      querystring: searchQuerySchema,
      response: {
        200: z.object({
          artist: z.array(searchHitSchema),
          person: z.array(searchHitSchema),
          album: z.array(searchHitSchema),
          track: z.array(searchHitSchema),
          organization: z.array(searchHitSchema),
          emotion: z.object({ emotion: emotionSchema, artists: z.array(emotionArtistSchema) }).nullable()
            .describe("Intención emocional de la consulta («música para tener sexo» → cachonda). Solo en la búsqueda principal."),
        }),
      },
    },
  }, async (request, reply) => {
    const started = performance.now();
    const snapshot = initialSnapshot(request.query.q);
    try {
      if (!isLocalRequest(request) && (!perIp.take(clientIp(request)) || !total.take("all"))) {
        reply.header("retry-after", "60");
        throw new ApiError(429, "rate_limited", "Demasiadas búsquedas seguidas; espera un momento");
      }
      const { q, types, limit } = request.query;
      const requestedTypes = types
        ? types.split(",").map((value) => value.trim()).filter(Boolean)
        : undefined;
      if (requestedTypes) {
        for (const value of requestedTypes) {
          if (!searchEntityTypeSchema.safeParse(value).success) {
            throw badRequest(`tipo de búsqueda desconocido: ${value} (válidos: ${ALL_SEARCH_TYPES.join(", ")})`);
          }
        }
      }
      const recoveryStarted = performance.now();
      const result = await globalSearch(q, limit, (requestedTypes as typeof ALL_SEARCH_TYPES | undefined) ?? ALL_SEARCH_TYPES, cache => { snapshot.cache = cache; });
      snapshot.timings["retrieval"] = performance.now() - recoveryStarted;
      snapshot.versions["index"] = String(searchIndexVersion());
      // Intención emocional: «música para tener sexo» → artistas con «cachonda».
      const interpretationStarted = performance.now();
      const intent = requestedTypes ? null : detectEmotionIntent(q);
      snapshot.timings["interpretation"] = performance.now() - interpretationStarted;
      const emotionStarted = performance.now();
      const emotion = intent ? { emotion: intent, artists: await emotionArtists(intent, limit) } : null;
      snapshot.timings["emotion_retrieval"] = performance.now() - emotionStarted;
      // Solo el buscador principal (sin `types`) y solo el público: los
      // administradores y los scripts no son la señal que se quiere medir.
      if (!requestedTypes && request.viewer?.role !== "admin" && !isLocalRequest(request)
        && ALL_SEARCH_TYPES.every((type) => result[type].length === 0)
        && !(emotion && emotion.artists.length > 0)) recordSearchMiss(q);
      snapshot.counts = Object.fromEntries(ALL_SEARCH_TYPES.map(type => [type, result[type].length]));
      snapshot.counts["emotional_artists"] = emotion?.artists.length ?? 0;
      snapshot.entities = ALL_SEARCH_TYPES.flatMap(type => result[type].map(hit => ({ type, id: hit.id })));
      snapshot.outcome = Object.values(snapshot.counts).some(n => n > 0) ? "results" : "empty";
      snapshot.resultReason = snapshot.outcome === "empty" ? "legacy_literal_no_matches" : "legacy_matches_without_full_constraint_validation";
      snapshot.intention.interpretation = intent ? "partial" : "unrecognized";
      // Legacy categories mix activities and emotion. Keep their match as an
      // observation, never count it as a verified semantic request type.
      snapshot.legacyMatch = { emotion: intent };
      snapshot.intention.capabilities = [];
      // Preserve the whole sanitized request as pending: legacy matching cannot prove full semantic understanding.
      snapshot.intention.pending = [{ text: searchSample(q).sample, reason: "legacy_interpreter_no_full_plan" }];
      return { ...result, emotion };
    } catch (error) {
      snapshot.incident = incidentFor(error);
      throw error;
    } finally {
      snapshot.timings["server"] = performance.now() - started;
      if (eligible(request)) {
        const receipt = searchCollector.issue(request.query.q, snapshot);
        if (receipt) reply.header("x-crv-search-receipt", receipt);
      } else searchCollector.quality.excluded++;
      reply.header("cache-control", "no-store");
    }
  });

  server.get("/search/knowledge/:kind/:id", { schema: { params: z.object({ kind: z.enum(["artist", "album", "track"]), id: z.coerce.number().int().positive() }) } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { evidence: await publishedKnowledge(request.params.kind, request.params.id) };
  });
  server.get("/search/administration/knowledge/reviews/:id", { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return knowledgeReviewDetail(request.params.id);
  });
  server.post("/search/administration/knowledge/reviews/:id/decision", {
    schema: { params: z.object({ id: z.coerce.number().int().positive() }), body: knowledgeDecisionSchema },
  }, async request => decideKnowledge(request.params.id, request.body, request.operator));

  server.get("/search/administration/knowledge", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return knowledgeAdministration();
  });

  server.get("/search/administration", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return searchAdministration();
  });

  server.get("/search/misses", {
    schema: {
      tags: ["search"],
      summary: "Búsquedas públicas sin resultados (agregadas, sin IP ni usuario). Solo administradores.",
      querystring: missesQuerySchema,
      response: {
        200: z.array(z.object({ query: z.string(), sample: z.string(), misses: z.number().int(), firstSeen: z.string(), lastSeen: z.string() })),
      },
    },
  }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return listSearchMisses(request.query.limit, request.query.days);
  });
}

function eligible(request: import("fastify").FastifyRequest): boolean {
  return request.viewer?.role !== "admin" && !request.headers.authorization && !request.headers["x-crv-test"]
    && !(request.headers.cookie?.includes("crv_session=") && !request.viewer)
    && !isLocalRequest(request) && !/bot|crawler|spider|headless|playwright|selenium|curl|wget/iu.test(request.headers["user-agent"] ?? "");
}

function initialSnapshot(q: string): SearchSnapshot {
  return {
      attemptId: randomUUID(), at: new Date().toISOString(),
      intention: { version: INTENTION_VERSION, capabilities: [], interpretation: "unavailable", entities: [], conditions: [],
        pending: [{ text: searchSample(q).sample, reason: "legacy_interpreter" }], engine: "legacy" },
      entityResolution: "undetermined", resultReason: "technical_unavailable",
      counts: {}, entities: [], outcome: "technical_failure", incident: null, timings: {}, cache: "unknown", cold: searchIndexVersion() === 0,
      versions: { instrument: OBSERVABILITY_VERSION, intention: INTENTION_VERSION, index: String(searchIndexVersion()), model: "none", questions: "none", rules: "legacy-v1", dictionary: "legacy-emotions-v1", correspondence: "none", evidence: "legacy-catalog-v1" },
    };
}

function incidentFor(error: unknown): SearchSnapshot["incident"] {
  const status = (error as { statusCode?: number })?.statusCode;
  return status === 429 ? "rate_limit" : status === 503 ? "overload" : status === 408 || status === 504 ? "timeout"
    : status !== undefined && status < 500 ? "client" : "database";
}
