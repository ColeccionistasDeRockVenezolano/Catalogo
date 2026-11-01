// CRV · Rutas de configuración del proyecto.
//
// Público: GET /site-config, con solo los campos que el documento estático
// necesita (nunca datos de cuentas). Privado: GET/PUT /community/admin/project,
// este último reservado a administración total.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../http-errors.js";
import {
  getProjectConfig, getPublicProjectConfig, updateProjectConfig,
} from "../project/config.js";

const visibility = z.enum(["hidden", "progress", "completed", "full"]);
const lang = z.enum(["es", "en"]);

const projectBody = z.object({
  name: z.string().trim().min(1).max(120),
  visibility,
  defaultLang: lang,
  acceptsApplications: z.boolean(),
  showLogin: z.boolean(),
  visitorCounter: z.boolean(),
}).strict();

function requireAdmin(request: { viewer: { role: string } | null }): void {
  if (request.viewer?.role !== "admin") {
    throw new ApiError(403, "admin_required", "Solo una cuenta de administración total puede cambiar la configuración del proyecto.");
  }
}

export async function registerProjectConfigRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get("/site-config", { schema: { tags: ["Configuración"] } }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return getPublicProjectConfig();
  });

  api.get("/community/admin/project", { schema: { tags: ["Configuración"] } }, async (request, reply) => {
    requireAdmin(request);
    reply.header("Cache-Control", "no-store");
    return getProjectConfig();
  });

  api.patch("/community/admin/project", {
    schema: { tags: ["Configuración"], body: projectBody },
  }, async (request, reply) => {
    requireAdmin(request);
    const config = await updateProjectConfig(request.body);
    reply.header("Cache-Control", "no-store");
    return config;
  });
}
