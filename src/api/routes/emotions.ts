// CRV · Emociones: artistas por emoción («música para tener sexo» → cachonda).
// Solo emociones CLARAS (tags con evidencia y Laya ≥ umbral); los dudosos viven
// en la base para la revisión editorial pero no se sirven.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginatedResponseSchema } from "../schemas.js";
import { EMOTION_VALUES, emotionArtistCount, emotionArtists } from "../repositories/emotions.js";
import { ApiError } from "../http-errors.js";

export const emotionSchema = z.enum(EMOTION_VALUES);

export const emotionArtistSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  emotion: emotionSchema,
  score: z.number().describe("Suma de los pesos (0–100) de los tags que sustentan la emoción."),
  evidence: z.number().int().describe("Cuántos tags la sustentan."),
  listeners: z.number().int(),
  tags: z.array(z.object({ tag: z.string(), weight: z.number().int() })),
});

const emotionArtistsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function registerEmotionRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/emotions/:emotion/artists", {
    schema: {
      tags: ["emotions"],
      summary: "Artistas del catálogo con esa emoción clara, mejor evidencia y más oyentes primero.",
      params: z.object({ emotion: emotionSchema }),
      querystring: emotionArtistsQuerySchema,
      response: { 200: paginatedResponseSchema(emotionArtistSchema) },
    },
  }, async (request) => {
    const { emotion } = request.params;
    const { limit, offset } = request.query;
    const [data, total] = await Promise.all([
      emotionArtists(emotion, limit, offset),
      emotionArtistCount(emotion),
    ]);
    if (total === 0) throw new ApiError(404, "emotion_empty", `Todavía no hay artistas con «${emotion}»`);
    return { data, pagination: { limit, offset, total } };
  });
}
