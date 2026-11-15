// CRV · Emociones: artistas por emoción («música para tener sexo» → cachonda).
// Solo emociones CLARAS (tags con evidencia y Laya ≥ umbral); los dudosos viven
// en la base para la revisión editorial pero no se sirven.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginatedResponseSchema } from "../schemas.js";
import { dailyDateSchema } from "../daily-cycle.js";
import { EMOTION_VALUES, emotionAlbumCount, emotionAlbums, emotionArtistCount, emotionArtists, emotionFallbackMode } from "../repositories/emotions.js";
import { ApiError } from "../http-errors.js";

export const emotionSchema = z.enum(EMOTION_VALUES);

export const emotionArtistSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  emotion: emotionSchema,
  score: z.number().describe("Suma de los pesos de los tags + comentarios que sustentan la emoción."),
  evidence: z.number().int().describe("Cuántas evidencias la sustentan (tags y comentarios)."),
  listeners: z.number().int(),
  tags: z.array(z.object({ tag: z.string(), weight: z.number().int() })),
  shouts: z.array(z.string()).describe("Comentarios de oyentes (shouts) que sustentan la emoción."),
});

export const emotionAlbumSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  artistId: z.number().int(),
  artistName: z.string(),
  emotion: emotionSchema,
  score: z.number().describe("Peso de la emoción en su capa (reseñas 1, descriptores RYM 0,9, género 0,4, género del artista 0,3)."),
  basis: z.enum(["resenas", "descriptor_rym", "genero", "genero_artista"]),
  typicalOfGenre: z.boolean().describe("La emoción es la típica de su género: no hay evidencia propia del disco."),
  traits: z.array(z.string()),
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

  server.get("/emotions/:emotion/albums", {
    schema: {
      tags: ["emotions"],
      summary: "Discos con esa emoción (respaldo por capas), barajados cada día; paginación de la búsqueda.",
      params: z.object({ emotion: emotionSchema }),
      // La fecha del ciclo diario fija el barajado: la página 2 sigue el orden de la página 1 aunque cambie el día.
      querystring: emotionArtistsQuerySchema.extend({ date: dailyDateSchema.optional() }),
      response: { 200: paginatedResponseSchema(emotionAlbumSchema) },
    },
  }, async (request) => {
    const { emotion } = request.params;
    const { limit, offset, date } = request.query;
    if (emotionFallbackMode() !== "on") return { data: [], pagination: { limit, offset, total: 0 } };
    const [data, total] = await Promise.all([emotionAlbums(emotion, limit, offset, date), emotionAlbumCount(emotion)]);
    return { data, pagination: { limit, offset, total } };
  });
}
