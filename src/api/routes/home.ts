import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { publicGenreSchema } from "../schemas.js";
import { caracasToday, getHomeData } from "../repositories/home.js";
import { dailyCycleSchema, dailyDateSchema } from "../daily-cycle.js";

const homeAlbumSchema = z.object({
  id: z.number().int(), title: z.string(), releaseYear: z.number().int().nullable(), albumType: z.string(),
  artistId: z.number().int(), artistName: z.string(), coverUrl: z.string().nullable(), genres: z.array(publicGenreSchema),
});
const refSchema = (label: "title" | "name") => z.object({ id: z.number().int(), [label]: z.string() });

const homeSchema = z.object({
  dailyCycle: dailyCycleSchema,
  date: z.string(),
  wall: z.array(homeAlbumSchema),
  channel: z.object({ url: z.string(), checkedAt: z.string().nullable(), stale: z.boolean() }),
  stats: z.object({
    artists: z.number().int(), albums: z.number().int(), tracks: z.number().int(), persons: z.number().int(),
    firstYear: z.number().int().nullable(), lastYear: z.number().int().nullable(),
  }),
  eras: z.array(z.object({
    decade: z.number().int(), total: z.number().int(), albums: z.array(homeAlbumSchema),
  })),
  videos: z.array(z.object({
    videoId: z.string(), title: z.string().nullable(), publishedAt: z.string().nullable(), thumbnailUrl: z.string().nullable(),
    album: refSchema("title").nullable(), artist: refSchema("name").nullable(),
  })),
  featuredArtist: z.object({
    id: z.number().int(), name: z.string(), artistType: z.string(), pictureUrl: z.string().nullable(), excerpt: z.string(),
    originCity: z.string().nullable(), startYear: z.number().int().nullable(), albumCount: z.number().int(),
    genre: z.string().nullable(), primaryGenre: publicGenreSchema.nullable(), album: homeAlbumSchema.nullable(),
    similar: z.array(z.object({ id: z.number().int(), name: z.string(), pictureUrl: z.string().nullable() })),
  }).nullable(),
  listen: z.array(homeAlbumSchema.extend({ links: z.array(z.object({ platform: z.string(), url: z.string() })) })),
  labels: z.array(z.object({
    id: z.number().int(), name: z.string(), pictureUrl: z.string().nullable(), albumCount: z.number().int(),
    fromYear: z.number().int().nullable(), toYear: z.number().int().nullable(),
  })),
});

export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get("/home", {
    schema: {
      tags: ["search"],
      summary: "Portada: cifras, épocas, canal, artista del día, disco para escuchar y sellos",
      querystring: z.object({
        // Solo para pruebas y vistas previas; sin ella manda la fecha de Caracas.
        date: dailyDateSchema.optional(),
      }),
      response: { 200: homeSchema },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return getHomeData(request.query.date ?? caracasToday());
  });
}
