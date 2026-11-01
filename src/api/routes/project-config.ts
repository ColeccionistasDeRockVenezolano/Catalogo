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
import { readIdentity, saveTheme, saveBranding, saveProjectI18n, saveAsset, deleteAsset } from "../project/identity.js";
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

  // Ventanas 3.10 Identidad y compartir, 3.11 Idiomas del proyecto y 3.12
  // Tema: solo administración total (community no ve identidad ni ajustes).
  api.get("/community/admin/identity", { schema: { tags: ["Configuración"] } }, async (request, reply) => {
    requireAdmin(request);
    reply.header("Cache-Control", "no-store");
    return readIdentity();
  });

  api.put("/community/admin/branding", {
    schema: { tags: ["Configuración"], body: z.object({ branding: z.record(z.unknown()) }).strict() },
  }, async (request, reply) => {
    requireAdmin(request);
    const data = await saveBranding(request.body.branding);
    reply.header("Cache-Control", "no-store");
    return data;
  });

  api.put("/community/admin/theme", {
    schema: { tags: ["Configuración"], body: z.object({ theme: z.record(z.unknown()) }).strict() },
  }, async (request, reply) => {
    requireAdmin(request);
    const data = await saveTheme(request.body.theme);
    reply.header("Cache-Control", "no-store");
    return data;
  });

  api.put("/community/admin/i18n", {
    schema: { tags: ["Configuración"], body: z.object({ i18n: z.record(z.unknown()) }).strict() },
  }, async (request, reply) => {
    requireAdmin(request);
    const data = await saveProjectI18n(request.body.i18n);
    reply.header("Cache-Control", "no-store");
    return data;
  });

  // Imágenes del proyecto: cuerpo binario, 2 MB y solo PNG/JPG/WebP. El
  // parser vive en un plugin encapsulado para no ampliar el resto de la API.
  await app.register(async (uploads) => {
    uploads.addContentTypeParser(["image/png", "image/jpeg", "image/webp"],
      { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 },
      (_request, body, done) => done(null, body));
    uploads.post<{ Params: { kind: string }; Body: Buffer }>("/community/admin/assets/:kind", {
      bodyLimit: 2 * 1024 * 1024,
      schema: { tags: ["Configuración"] },
    }, async (request, reply) => {
      requireAdmin(request);
      const body = request.body;
      if (!Buffer.isBuffer(body)) throw new ApiError(400, "invalid_image", "Falta el cuerpo binario de la imagen.");
      const data = await saveAsset(request.params.kind, body);
      reply.header("Cache-Control", "no-store");
      return data;
    });
  });

  api.delete("/community/admin/assets/:kind", {
    schema: { tags: ["Configuración"], params: z.object({ kind: z.string().max(40) }) },
  }, async (request, reply) => {
    requireAdmin(request);
    const data = await deleteAsset(request.params.kind);
    reply.header("Cache-Control", "no-store");
    return data;
  });
}
