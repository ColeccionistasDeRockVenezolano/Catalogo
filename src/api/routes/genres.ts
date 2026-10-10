// CRV · Géneros públicos para los filtros de las listas de discos y artistas:
// familias y subgéneros con cuántas fichas tienen cada uno (solo asignaciones
// confirmadas, PLAN_GENEROS §5) y cuántas no tienen género.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import { decideGenre, GenreCurationError } from "../../genres/curation.js";
import { ApiError } from "../http-errors.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { noteSchema } from "./catalog-writes.js";
import { writeErrorResponses } from "../schemas.js";
import { genreFacets, type GenreFacets } from "../../genres/public.js";

const facetSchema = z.object({
  slug: z.string(),
  name: z.string(),
  count: z.number().int().describe("Fichas con este género confirmado; en una familia, también sus subgéneros."),
  relatedCount: z.number().int()
    .describe("Fichas sin género propio que entran por la relación (disco → su artista; artista → sus discos)."),
});

const facetsSchema = z.object({
  total: z.number().int(),
  withoutGenre: z.number().int().describe("Fichas sin ningún género confirmado."),
  families: z.array(facetSchema.extend({
    genres: z.array(facetSchema.extend({ subgenres: z.array(facetSchema).optional() })),
  })),
});

/** Los conteos recorren todas las asignaciones: se recalculan como mucho cada minuto. */
const FACETS_TTL_MS = 60_000;

export async function registerGenreRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get("/genres/vocabulary", {
    schema: { tags: ["genres"], response: { 200: z.array(z.object({ slug: z.string(), name: z.string(), level: z.string() })) } },
  }, async () => (await getPool().query<{ slug: string; name: string; level: string }>(
    "SELECT slug,name,level::text FROM ingest.genres WHERE active ORDER BY name")).rows);
  server.post("/genres/:kind/:id/decision", {
    schema: { tags: ["genres:write"], security: OPERATOR_SECURITY,
      params: z.object({ kind: z.enum(["artist", "album"]), id: z.coerce.number().int().positive() }),
      body: z.object({ action: z.enum(["confirm_primary", "add_secondary", "reject"]), genreSlug: z.string().trim().min(1).max(100), note: noteSchema }).strict(),
      response: { 200: z.object({ runId: z.number().int() }), ...writeErrorResponses } },
  }, async (request) => {
    try {
      const result = await decideGenre({ kind: request.params.kind, entityId: request.params.id,
        action: request.body.action, genreSlug: request.body.genreSlug, actor: request.operator, reason: request.body.note });
      cache.clear();
      return { runId: result.runId };
    } catch (error) {
      if (error instanceof GenreCurationError) throw new ApiError(error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 422, error.code, error.message);
      throw error;
    }
  });
  const cache = new Map<"album" | "artist", { at: number; value: Promise<GenreFacets> }>();

  function cachedFacets(kind: "album" | "artist"): Promise<GenreFacets> {
    const hit = cache.get(kind);
    if (hit && Date.now() - hit.at < FACETS_TTL_MS) return hit.value;
    const value = genreFacets(kind);
    cache.set(kind, { at: Date.now(), value });
    // Un fallo no se queda en caché: la siguiente petición lo reintenta.
    value.catch(() => { if (cache.get(kind)?.value === value) cache.delete(kind); });
    return value;
  }

  server.get("/genres/facets", {
    schema: {
      tags: ["genres"],
      querystring: z.object({ kind: z.enum(["album", "artist"]) }),
      response: { 200: facetsSchema },
    },
  }, async (request, reply) => {
    // Iguales para todos los visitantes y cambian poco: una caché corta basta.
    reply.header("cache-control", "public, max-age=120");
    return cachedFacets(request.query.kind);
  });
}
