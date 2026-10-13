// CRV · Índice de fichas públicas para el sitemap del gateway (web/server.mjs).
// El catálogo es abierto: esto solo enumera los ids para que los buscadores lo
// recorran sin adivinar. Se cachea una hora — los ids cambian al ritmo de las
// altas y un sitemap no necesita frescura de segundos.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";

const TTL_MS = 60 * 60 * 1000;

export async function registerSitemapRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  let cached: { value: { artists: number[]; albums: number[]; persons: number[] }; expiresAt: number } | undefined;

  server.get("/sitemap-ids", {
    schema: {
      tags: ["catalog"],
      summary: "Ids de las fichas públicas (artistas, discos, personas) para el sitemap",
      response: {
        200: z.object({
          artists: z.array(z.number().int()),
          albums: z.array(z.number().int()),
          persons: z.array(z.number().int()),
        }),
      },
    },
  }, async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    // `persons.id` llega como string (bigint): se normaliza a número en los tres.
    const [artists, albums, persons] = await Promise.all([
      getPool().query<{ id: number | string }>("SELECT id FROM public.artists ORDER BY id"),
      getPool().query<{ id: number | string }>("SELECT id FROM public.albums ORDER BY id"),
      getPool().query<{ id: number | string }>("SELECT id FROM public.persons ORDER BY id"),
    ]);
    const value = {
      artists: artists.rows.map((row) => Number(row.id)),
      albums: albums.rows.map((row) => Number(row.id)),
      persons: persons.rows.map((row) => Number(row.id)),
    };
    cached = { value, expiresAt: Date.now() + TTL_MS };
    return value;
  });
}
