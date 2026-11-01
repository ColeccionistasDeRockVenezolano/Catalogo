// CRV · Rutas de configuración del proyecto.
//
// Público: GET /site-config, con solo los campos que el documento estático
// necesita (nunca datos de cuentas). Privado: GET/PUT /community/admin/project,
// este último reservado a administración total.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../http-errors.js";
import { getProjectConfig, getPublicProjectConfig, updateProjectConfig } from "../project/config.js";
import {
  readCollaborateConfig, saveCollaborateConfig, readProfileTerms, createProfileTerm, updateProfileTerm,
} from "../project/collaborate-config.js";
import { idParamSchema } from "../schemas.js";

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

const collaborateBody = z.object({ form: z.record(z.unknown()) }).strict();

const termBody = z.object({
  type: z.enum(["skill", "contribution_area", "link_type"]),
  label: z.string().trim().min(1).max(120),
}).strict();

const termPatch = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
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

  // Ventana 3.8 · Formulario de colaboración. Lo administran admin y
  // community (el guardián global ya exige /community/admin y rol); la
  // configuración del proyecto sigue siendo solo de administración total.
  api.get("/community/admin/collaborate-form", { schema: { tags: ["Comunidad"] } }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return readCollaborateConfig();
  });

  api.put("/community/admin/collaborate-form", {
    schema: { tags: ["Comunidad"], body: collaborateBody },
  }, async (request, reply) => {
    const config = await saveCollaborateConfig(request.body.form);
    reply.header("Cache-Control", "no-store");
    return config;
  });

  api.get("/community/admin/profile-terms", { schema: { tags: ["Comunidad"] } }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const terms = await readProfileTerms();
    return {
      data: terms,
      skills: terms.filter((term) => term.type === "skill"),
      areas: terms.filter((term) => term.type === "contribution_area"),
      linkTypes: terms.filter((term) => term.type === "link_type"),
    };
  });

  api.post("/community/admin/profile-terms", {
    schema: { tags: ["Comunidad"], body: termBody },
  }, async (request, reply) => {
    const term = await createProfileTerm(request.body.type, request.body.label);
    reply.status(201);
    return term;
  });

  api.patch("/community/admin/profile-terms/:id", {
    schema: { tags: ["Comunidad"], params: idParamSchema, body: termPatch },
  }, async (request) => {
    return updateProfileTerm(request.params.id, request.body);
  });
}
