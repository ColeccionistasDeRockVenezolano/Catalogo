import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCatalogOverview } from "../repositories/catalog-overview.js";

export async function registerCatalogOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get("/catalog/overview", {
    schema: { tags: ["catalog"], response: { 200: z.object({
      totals: z.record(z.number().int().nonnegative()),
      genres: z.array(z.object({ slug: z.string(), name: z.string() })),
      decades: z.array(z.number().int()),
    }) } },
  }, async () => getCatalogOverview());
}
