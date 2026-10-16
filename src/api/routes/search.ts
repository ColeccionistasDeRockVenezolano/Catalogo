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
});

const searchQuerySchema = z.object({
  // Sin mínimo de letras (hay fichas de una o dos: «C4», «SS», «pm»); el tope evita consultas absurdas.
  q: z.string().trim().min(1, "q es obligatorio").max(100, "q admite hasta 100 caracteres"),
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
  const total = createWindowLimiter({ max: SEARCHES_PER_MINUTE, windowMs: 60_000, maxKeys: 1 });
  // Lo pendiente no espera al próximo volcado si la API se apaga.
  app.addHook("onClose", async () => { await flushSearchMisses(); });

  server.get("/search", {
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
    const result = await globalSearch(q, limit, (requestedTypes as typeof ALL_SEARCH_TYPES | undefined) ?? ALL_SEARCH_TYPES);
    // Intención emocional: «música para tener sexo» → artistas con «cachonda».
    const intent = requestedTypes ? null : detectEmotionIntent(q);
    const emotion = intent ? { emotion: intent, artists: await emotionArtists(intent, limit) } : null;
    // Solo el buscador principal (sin `types`) y solo el público: los
    // administradores y los scripts no son la señal que se quiere medir.
    if (!requestedTypes && request.viewer?.role !== "admin" && !isLocalRequest(request)
      && ALL_SEARCH_TYPES.every((type) => result[type].length === 0)
      && !(emotion && emotion.artists.length > 0)) recordSearchMiss(q);
    return { ...result, emotion };
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
