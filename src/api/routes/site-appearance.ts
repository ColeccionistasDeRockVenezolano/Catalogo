import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import { CATALOG_THEMES, type CatalogTheme } from "../../shared/site-appearance.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { writeErrorResponses } from "../schemas.js";

const appearanceSchema = z.object({ catalogTheme: z.enum(CATALOG_THEMES), updatedAt: z.string().nullable() });

export async function registerSiteAppearanceRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  // Solo se expone la apariencia pública; la identidad de quien la guarda queda en la base.
  api.get("/site-appearance", { schema: { tags: ["Configuración"], response: { 200: appearanceSchema } } }, async (_request, reply) => {
    const result = await getPool().query<{ catalog_theme: CatalogTheme; updated_at: Date | null }>(
      "SELECT catalog_theme, updated_at FROM ingest.site_appearance WHERE singleton = true",
    );
    const row = result.rows[0];
    reply.header("Cache-Control", "no-store");
    return { catalogTheme: row?.catalog_theme ?? "current", updatedAt: row?.updated_at?.toISOString() ?? null };
  });
  // registerOperatorAuth protege todas las escrituras con rol admin, origen y CSRF.
  api.patch("/site-appearance", {
    schema: { tags: ["Configuración"], security: OPERATOR_SECURITY,
      body: z.object({ catalogTheme: z.enum(CATALOG_THEMES) }).strict(),
      response: { 200: appearanceSchema, ...writeErrorResponses },
    },
  }, async (request, reply) => {
    const result = await getPool().query<{ catalog_theme: CatalogTheme; updated_at: Date }>(
      `INSERT INTO ingest.site_appearance(singleton, catalog_theme, updated_at, updated_by)
       VALUES (true, $1, clock_timestamp(), $2)
       ON CONFLICT (singleton) DO UPDATE SET catalog_theme = EXCLUDED.catalog_theme,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
       RETURNING catalog_theme, updated_at`,
      [request.body.catalogTheme, request.operator],
    );
    const row = result.rows[0]!;
    reply.header("Cache-Control", "no-store");
    return { catalogTheme: row.catalog_theme, updatedAt: row.updated_at.toISOString() };
  });
}
