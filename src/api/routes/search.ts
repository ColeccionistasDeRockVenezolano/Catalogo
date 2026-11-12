import { decideKnowledge, knowledgeDecisionSchema, knowledgeReviewDetail, publishedKnowledge } from "../../search/knowledge-publication.js";
import { knowledgeAdministration } from "../../search/knowledge-administration.js";
import { searchAdministration } from "../../search/administration.js";
import { activationRequestSchema, isLayaActive, layaAdministration, recordLayaActivation } from "../../search/laya-models.js";
import { gatedConfig, interpretShared } from "../../search/query-interpretation/gated-service.js";
import { decide, structuredFor } from "../../search/query-plan/service.js";
import { executeStructured, planMode, STRUCTURED_PLAN_VERSION } from "../../search/query-plan/structured.js";
import { GATED_MODE_VERSION } from "../../search/query-interpretation/gated.js";
import { randomUUID } from "node:crypto";
import { searchCollector, confirmationSchema, type SearchSnapshot } from "../../search/observability.js";
import { recordJob, SEARCH_JOBS } from "../../search/job-status.js";
import { didYouMean } from "../../search/did-you-mean-service.js";
import { DID_YOU_MEAN_VERSION, didYouMeanEnabled } from "../../search/did-you-mean.js";
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
import { getEnv } from "../../config/env.js";

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
  offset: z.coerce.number().int().min(0).max(200).default(0),
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
  // Lo pendiente no espera al próximo volcado si la API se apaga. En una
  // instancia sin trabajo de fondo (crv-api-landing) no se programan estos
  // temporizadores: la portada no sirve /search y la retención borraría
  // analítica que pertenece al catálogo.
  const backgroundJobs = getEnv().CRV_BACKGROUND_JOBS;
  const flushTimer = backgroundJobs ? setInterval(() => { void searchCollector.flush(); }, 5000).unref() : null;
  // La retención ya no vive aquí: la corre el timer crv-buscador-retencion (`crv search:retain`), con un solo dueño y
  // aunque la API esté parada. Esta instancia solo deja el latido del colector (cada 5 min, sin texto de consultas).
  let lastFailed = searchCollector.quality.failed;
  const heartbeatTimer = backgroundJobs
    ? setInterval(() => {
      const q = searchCollector.quality, failed = q.failed > lastFailed;
      lastFailed = q.failed;
      void recordJob("collector", failed ? { ok: false, code: "analytics_write_failed" }
        : { ok: true, detail: { pending: searchCollector.status().pending, lost: q.lost, persisted: q.persisted } });
    }, SEARCH_JOBS.collector.cadenceSecs * 1000).unref()
    : null;
  // El índice aproximado de «¿Quisiste decir…?» se construye la primera vez que hace falta (~0,3 s): se adelanta tras el arranque
  // para que no lo pague un visitante.
  if (backgroundJobs && didYouMeanEnabled()) setTimeout(() => { void didYouMean("precalentamiento del indice aproximado"); }, 20_000).unref();
  app.addHook("onClose", async () => {
    if (flushTimer) clearInterval(flushTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
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
          totals: z.object({
            artist: z.number().int().nonnegative(), person: z.number().int().nonnegative(),
            album: z.number().int().nonnegative(), track: z.number().int().nonnegative(),
            organization: z.number().int().nonnegative(),
          }).describe("Coincidencias conocidas por tipo (tope 200); la paginación se apoya en este número."),
          emotion: z.object({ emotion: emotionSchema, artists: z.array(emotionArtistSchema) }).nullable()
            .describe("Intención emocional de la consulta («música para tener sexo» → cachonda). Solo en la búsqueda principal."),
          didYouMean: z.array(searchHitSchema)
            .describe("«¿Quisiste decir…?»: nombres parecidos a una consulta sin resultados (errata de una a tres letras). Vacío si hay resultados, la bandera está apagada o nada se parece."),
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
      const { q, types, limit, offset } = request.query;
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
      const result = await globalSearch(q, limit, (requestedTypes as typeof ALL_SEARCH_TYPES | undefined) ?? ALL_SEARCH_TYPES, cache => { snapshot.cache = cache; }, offset);
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
      // «¿Quisiste decir…?»: solo si la búsqueda principal no encontró nada. Es una sugerencia aparte: la consulta sigue contando
      // como vacía (el resultado y el resumen no cambian) y quien la sigue hace una búsqueda nueva con el nombre sugerido.
      let suggestions: Awaited<ReturnType<typeof didYouMean>>["hits"] = [];
      if (didYouMeanEnabled() && !requestedTypes && snapshot.outcome === "empty") {
        const attempt = await didYouMean(q);
        suggestions = attempt.hits;
        snapshot.timings["did_you_mean"] = attempt.ms;
        snapshot.counts["did_you_mean"] = suggestions.length;
        snapshot.versions["did_you_mean"] = `${DID_YOU_MEAN_VERSION}:${suggestions.length ? "suggested" : "none"}`;
      }
      snapshot.resultReason = snapshot.outcome === "empty" ? "legacy_literal_no_matches" : "legacy_matches_without_full_constraint_validation";
      snapshot.intention.interpretation = intent ? "partial" : "unrecognized";
      // Legacy categories mix activities and emotion. Keep their match as an
      // observation, never count it as a verified semantic request type.
      snapshot.legacyMatch = { emotion: intent };
      snapshot.intention.capabilities = [];
      // Preserve the whole sanitized request as pending: legacy matching cannot prove full semantic understanding.
      snapshot.intention.pending = [{ text: searchSample(q).sample, reason: "legacy_interpreter_no_full_plan" }];
      return { ...result, emotion, didYouMean: suggestions.map(hit => ({ ...hit, imageUrl: null })) };
    } catch (error) {
      snapshot.incident = incidentFor(error);
      throw error;
    } finally {
      snapshot.timings["server"] = performance.now() - started;
      if (eligible(request)) {
        const receipt = searchCollector.issue(request.query.q, snapshot);
        if (receipt) reply.header("x-crv-search-receipt", receipt);
        // Modo «solo si coinciden»: no retrasa la respuesta. El plan se anota en el resumen (que solo se guarda al confirmar la búsqueda)
        // y solo si coinciden la 1.8.0 y el estudiante; si no, el resumen conserva «sin interpretar». No cambia los resultados.
        if (receipt && !request.query.types) void annotateGated(request.query.q, snapshot);
      } else searchCollector.quality.excluded++;
      reply.header("cache-control", "no-store");
    }
  });

  /**
   * Etapa 4 · parte estructurada. Segundo tiempo de la búsqueda: /search responde al instante y el cliente pide aquí, con la misma
   * consulta, los resultados del plan cuando hay acuerdo y solo género/década. Con CRV_QUERY_PLAN distinto de `on` responde `applied:false`.
   */
  const planHitSchema = searchHitSchema.extend({ type: z.enum(["artist", "album"]) });
  const unknownSchema = z.object({ artist: z.number().int(), album: z.number().int() });
  server.get("/search/plan", {
    schema: {
      tags: ["search"],
      summary: "Resultados del plan estructurado (género/década) cuando el modo «solo si coinciden» respondió; si no, applied=false.",
      querystring: searchQuerySchema.pick({ q: true, limit: true }),
      response: { 200: z.object({
        applied: z.boolean(), reason: z.string().optional(), version: z.string(),
        interpretation: z.object({ require: z.array(z.string()), exclude: z.array(z.string()), prefer: z.array(z.string()), anyOf: z.array(z.array(z.string())), decade: z.string().nullable() }).nullable(),
        artist: z.array(planHitSchema), album: z.array(planHitSchema),
        totals: z.object({ artist: z.number().int(), album: z.number().int() }),
        withoutData: z.object({ genre: unknownSchema.optional(), year: unknownSchema.optional() }),
      }) },
    },
  }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!isLocalRequest(request) && (!perIp.take(clientIp(request)) || !total.take("all"))) {
      reply.header("retry-after", "60");
      throw new ApiError(429, "rate_limited", "Demasiadas búsquedas seguidas; espera un momento");
    }
    const out = await structuredFor(request.query.q, request.query.limit);
    const none = { artist: [], album: [], totals: { artist: 0, album: 0 }, withoutData: {}, version: STRUCTURED_PLAN_VERSION, interpretation: null };
    return out.applied ? { applied: true, ...out.result } : { applied: false, reason: out.reason, ...none };
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

  server.get("/search/administration/laya", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return layaAdministration();
  });
  server.post("/search/administration/laya/activations", { schema: { body: activationRequestSchema } },
    async request => recordLayaActivation(request.body, request.operator));

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

const GATED_MODEL_ID = "crv-query-gated-1.10.0";
async function annotateGated(q: string, snapshot: SearchSnapshot): Promise<void> {
  try {
    const cfg = gatedConfig();
    if (!cfg || !(await isLayaActive("query_interpretation", GATED_MODEL_ID))) return;
    const r = await interpretShared(q, cfg);
    if (!r) return;
    snapshot.timings["gated_interpretation"] = r.ms;
    snapshot.versions["model"] = `${GATED_MODE_VERSION}:${r.outcome.answered ? "agree" : "abstain"}`;
    if (r.outcome.answered) snapshot.intention = r.legacyIntention;
    // Etapa 4 · parte estructurada: en `shadow` se ejecuta el plan y se anota qué habría devuelto (nadie lo ve); en `on` solo se anota si era servible.
    const mode = planMode();
    if (mode === "off") return;
    const d = decide(r);
    snapshot.versions["plan"] = `${STRUCTURED_PLAN_VERSION}:${d.servable ? "servable" : d.reason}`;
    if (d.servable && mode === "shadow") {
      const out = await executeStructured(d.plan, 20);
      if (!("refusal" in out)) {
        snapshot.counts["plan_artist"] = out.totals.artist; snapshot.counts["plan_album"] = out.totals.album;
        snapshot.timings["plan_retrieval"] = out.ms;
      }
    }
  } catch { /* la anotación es opcional */ }
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
