// CRV · Rutas del roadmap y de las visitas (Fase 2).
//
// Públicas: lectura del roadmap según la visibilidad del proyecto, contador de
// visitas y su widget. Privadas: CRUD de etapas/actividades, traducciones y
// métricas de visitas. Las privadas viven bajo /community/admin para heredar
// el guardián de rol (admin total o comunidad) y la auditoría de comunidad.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../http-errors.js";
import { clientIp } from "../auth.js";
import { createWindowLimiter } from "../rate-limit.js";
import { idParamSchema } from "../schemas.js";
import {
  adminRoadmap, publicRoadmap, createCategory, updateCategory, deleteCategory,
  createTask, updateTask, deleteTask, moveTask, moveTaskToCategory, saveTranslations,
  assignedTasks, updateAssignedTaskStatus,
} from "../roadmap/store.js";
import { adminVisits, normalizeCountry, recordVisit, visitStats } from "../roadmap/visits.js";
import { projectId } from "../community/store.js";

const langQuery = z.object({ lang: z.enum(["es", "en"]).optional() });
const translations = z.object({ en: z.string().max(600).optional() }).strict();
const status = z.enum(["pending", "in_progress", "completed"]);

const categoryBody = z.object({ title: z.string().trim().min(1).max(300), translations: translations.optional() }).strict();
const categoryPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  position: z.number().int().positive().optional(),
  translations: translations.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar." });

const taskBody = z.object({
  categoryId: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  status: status.default("pending"),
  position: z.number().int().positive().optional(),
  assignedUserIds: z.array(z.number().int().positive()).max(50).optional(),
  translations: translations.optional(),
}).strict();

const taskPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  status: status.optional(),
  categoryId: z.number().int().positive().optional(),
  position: z.number().int().positive().optional(),
  assignedUserIds: z.array(z.number().int().positive()).max(50).optional(),
  pinned: z.boolean().optional(),
  translations: translations.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar." });

const moveBody = z.object({ direction: z.enum(["up", "down"]) }).strict();
const categoryMoveBody = z.object({ categoryId: z.number().int().positive() }).strict();
const translationsBody = z.object({
  categories: z.record(z.string(), translations).optional(),
  tasks: z.record(z.string(), translations).optional(),
}).strict();

function requestCountry(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = request.headers["cf-ipcountry"] ?? request.headers["x-vercel-ip-country"]
    ?? request.headers["x-country"] ?? request.headers["x-geo-country"];
  return Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
}

export async function registerRoadmapRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const visitLimiter = createWindowLimiter({ max: 40, windowMs: 60_000, maxKeys: 5_000 });

  // ------------------------------------------------------------------ público
  api.get("/roadmap", { schema: { tags: ["Roadmap"], querystring: langQuery } }, async (request) => {
    const project = await projectId();
    return publicRoadmap(project, request.query.lang ?? "es", request.viewer !== null);
  });

  // Actividades asignadas a la cuenta que tiene sesión en este navegador. Es la
  // vista que usa el roadmap estático para ofrecer el cambio de estado.
  api.get("/roadmap/me", { schema: { tags: ["Roadmap"], querystring: langQuery } }, async (request, reply) => {
    if (request.account?.kind !== "user") {
      throw new ApiError(401, "collaborator_required", "Inicia sesión con tu cuenta de colaborador.");
    }
    const project = await projectId();
    reply.header("Cache-Control", "no-store");
    return {
      user: { name: request.viewer?.name ?? "" },
      csrf: request.csrfToken,
      tasks: await assignedTasks(project, request.account.id, request.query.lang ?? "es"),
    };
  });

  api.patch("/roadmap/tasks/:id/status", {
    schema: {
      tags: ["Roadmap"], params: idParamSchema,
      body: z.object({ status }).strict(),
    },
  }, async (request) => {
    if (request.account?.kind !== "user") {
      throw new ApiError(403, "task_not_assigned", "Solo una cuenta de colaborador puede cambiar sus actividades.");
    }
    const project = await projectId();
    return updateAssignedTaskStatus(project, request.account.id, request.params.id, request.body.status);
  });

  api.get("/roadmap/visits", { schema: { tags: ["Roadmap"], querystring: langQuery } }, async (request) => {
    const project = await projectId();
    return visitStats(project, request.query.lang ?? "es");
  });

  api.post("/roadmap/visit", { schema: { tags: ["Roadmap"] } }, async (request) => {
    if (!visitLimiter.take(clientIp(request))) {
      throw new ApiError(429, "rate_limited", "Demasiadas visitas desde esta conexión.");
    }
    const project = await projectId();
    const userAgent = request.headers["user-agent"];
    await recordVisit(project, {
      ip: clientIp(request),
      country: normalizeCountry(requestCountry(request)),
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });
    return visitStats(project, (request.query as { lang?: string }).lang === "en" ? "en" : "es");
  });

  // ------------------------------------------------------------- administración
  api.get("/community/admin/roadmap", { schema: { tags: ["Roadmap"] } }, async () => {
    const project = await projectId();
    return adminRoadmap(project);
  });

  api.post("/community/admin/roadmap/categories", {
    schema: { tags: ["Roadmap"], body: categoryBody },
  }, async (request, reply) => {
    const project = await projectId();
    await createCategory(project, request.body.title, request.body.translations);
    return reply.status(201).send({ roadmap: await adminRoadmap(project) });
  });

  api.patch("/community/admin/roadmap/categories/:id", {
    schema: { tags: ["Roadmap"], params: idParamSchema, body: categoryPatch },
  }, async (request) => {
    const project = await projectId();
    await updateCategory(project, request.params.id, request.body);
    return { roadmap: await adminRoadmap(project) };
  });

  api.delete("/community/admin/roadmap/categories/:id", {
    schema: { tags: ["Roadmap"], params: idParamSchema, querystring: z.object({ force: z.enum(["true", "false"]).optional() }) },
  }, async (request, reply) => {
    const project = await projectId();
    await deleteCategory(project, request.params.id, request.query.force === "true");
    return reply.status(204).send();
  });

  api.post("/community/admin/roadmap/tasks", {
    schema: { tags: ["Roadmap"], body: taskBody },
  }, async (request, reply) => {
    const project = await projectId();
    await createTask(project, request.body);
    return reply.status(201).send({ roadmap: await adminRoadmap(project) });
  });

  api.patch("/community/admin/roadmap/tasks/:id", {
    schema: { tags: ["Roadmap"], params: idParamSchema, body: taskPatch },
  }, async (request) => {
    const project = await projectId();
    await updateTask(project, request.params.id, request.body);
    return { roadmap: await adminRoadmap(project) };
  });

  api.delete("/community/admin/roadmap/tasks/:id", {
    schema: { tags: ["Roadmap"], params: idParamSchema },
  }, async (request, reply) => {
    const project = await projectId();
    await deleteTask(project, request.params.id);
    return reply.status(204).send();
  });

  api.post("/community/admin/roadmap/tasks/:id/move", {
    schema: { tags: ["Roadmap"], params: idParamSchema, body: moveBody },
  }, async (request) => {
    const project = await projectId();
    await moveTask(project, request.params.id, request.body.direction);
    return { roadmap: await adminRoadmap(project) };
  });

  api.post("/community/admin/roadmap/tasks/:id/category", {
    schema: { tags: ["Roadmap"], params: idParamSchema, body: categoryMoveBody },
  }, async (request) => {
    const project = await projectId();
    await moveTaskToCategory(project, request.params.id, request.body.categoryId);
    return { roadmap: await adminRoadmap(project) };
  });

  api.post("/community/admin/roadmap/translations", {
    schema: { tags: ["Roadmap"], body: translationsBody },
  }, async (request) => {
    const project = await projectId();
    const counts = await saveTranslations(project, request.body);
    return { ...counts, roadmap: await adminRoadmap(project) };
  });

  api.get("/community/admin/visits", {
    schema: { tags: ["Roadmap"], querystring: z.object({
      days: z.coerce.number().int().min(1).max(90).optional(),
      lang: z.enum(["es", "en"]).optional(),
    }) },
  }, async (request) => {
    const project = await projectId();
    return adminVisits(project, request.query.days ?? 30, request.query.lang ?? "es");
  });
}
