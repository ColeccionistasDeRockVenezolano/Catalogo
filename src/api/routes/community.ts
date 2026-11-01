// CRV · Rutas de comunidad (Fase 1).
//
// Públicas: formulario de candidatura, registro por invitación y activación.
// Privadas: colaboradores, candidaturas, invitaciones, activaciones y roles.
// El guardián global de auth.ts ya exige sesión y rol para /community/admin;
// aquí solo se añade la comprobación de rol total para cambiar roles.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import { ApiError } from "../http-errors.js";
import { clientIp } from "../auth.js";
import { createWindowLimiter } from "../rate-limit.js";
import { idParamSchema } from "../schemas.js";
import {
  projectId, listCollaborators, getCollaborator, createCollaborator, updateCollaborator,
  setAccessCode, revokeCollaborator, listAdmins, adminByUsername, setAdminRole,
  formOptions, recordAudit,
} from "../community/store.js";
import {
  createApplication, listApplications, getApplication, setApplicationStatus, acceptApplication,
} from "../community/applications.js";
import { applicationsOpen } from "../project/config.js";
import {
  createActivation, listActivations, revokeActivation, activationInfo, activateUser,
  createInvite, listInvites, revokeInvite, inviteInfo, registerWithInvite,
} from "../community/tokens.js";
import { passwordRequirementsText } from "../community/validation.js";

const UTC_NOW = "to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')";

const applicationBody = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  birthDate: z.string().trim().max(10).optional(),
  whatsappPhone: z.string().trim().max(200).optional(),
  email: z.string().trim().max(200).optional(),
  city: z.string().trim().max(200).optional(),
  country: z.string().trim().max(200).optional(),
  contactPreference: z.enum(["whatsapp", "email", "both"]).optional(),
  experience: z.string().max(4000).optional(),
  contributionText: z.string().max(4000).optional(),
  idea: z.string().max(4000).optional(),
  ideaReason: z.string().max(4000).optional(),
  wantsToImplement: z.enum(["yes", "maybe", "share_only"]).optional(),
  availability: z.string().trim().max(200).optional(),
  skillIds: z.array(z.number().int().positive()).max(40).optional(),
  areaIds: z.array(z.number().int().positive()).max(40).optional(),
  links: z.array(z.object({
    type: z.string().trim().max(200).optional(),
    label: z.string().trim().max(200).optional(),
    url: z.string().trim().max(500),
  })).max(10).optional(),
}).strict();

const registerBody = z.object({
  token: z.string().min(10).max(200),
  name: z.string().trim().min(2).max(80),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  accessCode: z.string().min(12).max(200),
}).strict();

const activateBody = z.object({
  token: z.string().min(10).max(200),
  name: z.string().trim().min(2).max(80),
  accessCode: z.string().min(12).max(200),
}).strict();

const collaboratorBody = z.object({
  name: z.string().trim().min(2).max(80),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  accessCode: z.string().min(12).max(200),
}).strict();

const collaboratorPatch = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
}).strict();

const accessCodeBody = z.object({ accessCode: z.string().min(12).max(200) }).strict();

const applicationStatusBody = z.object({
  status: z.enum(["new", "reviewing", "contact", "rejected", "archived"]),
}).strict();

const acceptBody = z.object({ existingPersonId: z.number().int().positive().optional() }).strict();

export async function registerCommunityRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  // Auditoría única de todo lo que cambia en comunidad. Se registra antes de
  // las rutas para que el hook alcance a todas ellas. Los GET no se auditan.
  app.addHook("onResponse", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (!path.startsWith("/community") || request.method === "GET") return;
    try {
      const project = await projectId();
      const account = request.account;
      await recordAudit({
        actorType: account?.kind ?? "public",
        actorId: account?.id ?? 0,
        project,
        action: `${request.method} ${path}`,
        method: request.method,
        path,
        status: reply.statusCode,
        sourceAddr: clientIp(request),
      });
    } catch (error) {
      request.log.warn({ err: error }, "no se pudo registrar la auditoría de comunidad");
    }
  });

  // ---------------------------------------------------------------- público
  const applicationLimiter = createWindowLimiter({ max: 5, windowMs: 10 * 60_000, maxKeys: 5_000 });
  const registerLimiter = createWindowLimiter({ max: 5, windowMs: 60 * 60_000, maxKeys: 5_000 });
  const activateLimiter = createWindowLimiter({ max: 10, windowMs: 60 * 60_000, maxKeys: 5_000 });

  api.get("/community/form-options", { schema: { tags: ["Comunidad"] } }, async () => {
    const options = await formOptions();
    return {
      skills: options.filter((option) => option.type === "skill").map(({ id, label }) => ({ id, label })),
      areas: options.filter((option) => option.type === "contribution_area").map(({ id, label }) => ({ id, label })),
      linkTypes: options.filter((option) => option.type === "link_type").map(({ id, label }) => ({ id, label })),
      accessCodeRequirements: passwordRequirementsText(),
    };
  });

  api.post("/community/applications", {
    schema: { tags: ["Comunidad"], body: applicationBody },
  }, async (request) => {
    if (!applicationLimiter.take(clientIp(request))) {
      throw new ApiError(429, "rate_limited", "Demasiados envíos desde esta conexión. Espera unos minutos.");
    }
    if (!(await applicationsOpen())) {
      throw new ApiError(409, "applications_closed", "Las candidaturas están cerradas en este momento.");
    }
    const project = await projectId();
    const { id } = await createApplication(project, request.body, clientIp(request));
    return { ok: true as const, id };
  });

  api.get("/community/invite/:token", { schema: { tags: ["Comunidad"], params: z.object({ token: z.string().max(200) }) } },
    async (request) => {
      const project = await projectId();
      const info = await inviteInfo(project, request.params.token);
      return { valid: info.valid, expiresAt: info.expiresAt };
    });

  api.post("/community/register", {
    schema: { tags: ["Comunidad"], body: registerBody },
  }, async (request) => {
    if (!registerLimiter.take(clientIp(request))) {
      throw new ApiError(429, "rate_limited", "Demasiados registros desde esta conexión. Espera una hora.");
    }
    const project = await projectId();
    const user = await registerWithInvite(project, request.body.token, request.body, clientIp(request));
    return { ok: true as const, name: user.name };
  });

  api.get("/community/activate/:token", { schema: { tags: ["Comunidad"], params: z.object({ token: z.string().max(200) }) } },
    async (request) => {
      const project = await projectId();
      try {
        const info = await activationInfo(project, request.params.token);
        return { valid: true as const, name: info.name, firstName: info.first_name, lastName: info.last_name, expiresAt: info.expires_at };
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 404) {
          return { valid: false as const, name: null, firstName: null, lastName: null, expiresAt: null };
        }
        throw error;
      }
    });

  api.post("/community/activate", {
    schema: { tags: ["Comunidad"], body: activateBody },
  }, async (request) => {
    if (!activateLimiter.take(clientIp(request))) {
      throw new ApiError(429, "rate_limited", "Demasiados intentos desde esta conexión. Espera unos minutos.");
    }
    const project = await projectId();
    const user = await activateUser(project, request.body.token, request.body.name, request.body.accessCode);
    return { ok: true as const, name: user.name };
  });

  // -------------------------------------------------------------- administración
  api.get("/community/admin/overview", { schema: { tags: ["Comunidad"] } }, async () => {
    const project = await projectId();
    const { rows } = await getPool().query<{
      pending_applications: number; collaborators: number; pending_collaborators: number;
      pending_activations: number; active_invites: number;
    }>(`SELECT
      (SELECT count(*)::int FROM auth.applications WHERE project_id=$1 AND status IN ('new','reviewing','contact')) AS pending_applications,
      (SELECT count(*)::int FROM auth.users WHERE project_id=$1 AND status='approved') AS collaborators,
      (SELECT count(*)::int FROM auth.users WHERE project_id=$1 AND status='pending') AS pending_collaborators,
      (SELECT count(*)::int FROM auth.activation_tokens at JOIN auth.users u ON u.id=at.user_id
        WHERE at.project_id=$1 AND at.used_at IS NULL AND at.revoked_at IS NULL AND at.expires_at > ${UTC_NOW}
          AND u.status='approved') AS pending_activations,
      (SELECT count(*)::int FROM auth.registration_tokens
        WHERE project_id=$1 AND revoked_at IS NULL AND expires_at > ${UTC_NOW}) AS active_invites`, [project]);
    return rows[0]!;
  });

  api.get("/community/admin/collaborators", {
    schema: { tags: ["Comunidad"], querystring: z.object({ status: z.string().optional(), search: z.string().optional() }) },
  }, async (request) => {
    const project = await projectId();
    return { data: await listCollaborators(project, request.query) };
  });

  api.get("/community/admin/collaborators/:id", { schema: { tags: ["Comunidad"], params: idParamSchema } },
    async (request) => {
      const project = await projectId();
      const collaborator = await getCollaborator(project, request.params.id);
      if (!collaborator) throw new ApiError(404, "collaborator_not_found", "No existe esa cuenta en el proyecto.");
      return collaborator;
    });

  api.post("/community/admin/collaborators", {
    schema: { tags: ["Comunidad"], body: collaboratorBody },
  }, async (request, reply) => {
    const project = await projectId();
    const created = await createCollaborator(project, request.body);
    return reply.status(201).send(created);
  });

  api.patch("/community/admin/collaborators/:id", {
    schema: { tags: ["Comunidad"], params: idParamSchema, body: collaboratorPatch },
  }, async (request) => {
    const project = await projectId();
    return updateCollaborator(project, request.params.id, request.body);
  });

  api.post("/community/admin/collaborators/:id/access-code", {
    schema: { tags: ["Comunidad"], params: idParamSchema, body: accessCodeBody },
  }, async (request, reply) => {
    const project = await projectId();
    await setAccessCode(project, request.params.id, request.body.accessCode);
    return reply.status(204).send();
  });

  api.post("/community/admin/collaborators/:id/revoke", {
    schema: { tags: ["Comunidad"], params: idParamSchema },
  }, async (request, reply) => {
    const project = await projectId();
    await revokeCollaborator(project, request.params.id);
    return reply.status(204).send();
  });

  api.get("/community/admin/applications", {
    schema: { tags: ["Comunidad"], querystring: z.object({ status: z.string().optional(), search: z.string().optional() }) },
  }, async (request) => {
    const project = await projectId();
    return { data: await listApplications(project, request.query) };
  });

  api.get("/community/admin/applications/:id", { schema: { tags: ["Comunidad"], params: idParamSchema } },
    async (request) => {
      const project = await projectId();
      return getApplication(project, request.params.id);
    });

  api.patch("/community/admin/applications/:id", {
    schema: { tags: ["Comunidad"], params: idParamSchema, body: applicationStatusBody },
  }, async (request) => {
    const project = await projectId();
    const admin = await adminByUsername(request.operator);
    return setApplicationStatus(project, request.params.id, request.body.status, admin?.id ?? null);
  });

  api.post("/community/admin/applications/:id/accept", {
    schema: { tags: ["Comunidad"], params: idParamSchema, body: acceptBody },
  }, async (request, reply) => {
    const project = await projectId();
    const admin = await adminByUsername(request.operator);
    const result = await acceptApplication(
      project, request.params.id, admin?.id ?? null, request.operator, request.body.existingPersonId);
    return reply.status(201).send({
      application: result.application,
      personId: result.personId,
      userId: result.userId,
      createdPerson: result.createdPerson,
      activationToken: result.activationToken,
      activationExpiresAt: result.activationExpiresAt,
      activationPath: `activar?token=${encodeURIComponent(result.activationToken)}`,
    });
  });

  api.get("/community/admin/invites", { schema: { tags: ["Comunidad"] } }, async () => {
    const project = await projectId();
    return { data: await listInvites(project) };
  });

  api.post("/community/admin/invites", { schema: { tags: ["Comunidad"] } },
    async (request, reply) => {
      const project = await projectId();
      const invite = await createInvite(project, request.operator);
      return reply.status(201).send({ ...invite, invitePath: `registro?token=${encodeURIComponent(invite.token)}` });
    });

  api.delete("/community/admin/invites/:id", { schema: { tags: ["Comunidad"], params: idParamSchema } },
    async (request, reply) => {
      const project = await projectId();
      await revokeInvite(project, request.params.id);
      return reply.status(204).send();
    });

  api.get("/community/admin/activations", { schema: { tags: ["Comunidad"] } }, async () => {
    const project = await projectId();
    return { data: await listActivations(project) };
  });

  api.delete("/community/admin/activations/:id", { schema: { tags: ["Comunidad"], params: idParamSchema } },
    async (request, reply) => {
      const project = await projectId();
      await revokeActivation(project, request.params.id);
      return reply.status(204).send();
    });

  api.get("/community/admin/admins", { schema: { tags: ["Comunidad"] } }, async () => {
    const project = await projectId();
    return { data: await listAdmins(project) };
  });

  api.patch("/community/admin/admins/:id/role", {
    schema: { tags: ["Comunidad"], params: idParamSchema,
      body: z.object({ role: z.enum(["admin", "curator", "community"]) }).strict() },
  }, async (request) => {
    // Cambiar roles es la única operación que exige el rol total: un
    // administrador de comunidad no puede nombrar administradores.
    if (request.viewer?.role !== "admin") {
      throw new ApiError(403, "admin_required", "Solo una cuenta de administración total puede cambiar roles.");
    }
    const project = await projectId();
    return setAdminRole(project, request.params.id, request.body.role);
  });

  // Alta directa de una activación desde la ficha de una colaboración ya
  // creada (por ejemplo, si el enlace anterior expiró).
  api.post("/community/admin/collaborators/:id/activation", {
    schema: { tags: ["Comunidad"], params: idParamSchema },
  }, async (request, reply) => {
    const project = await projectId();
    const collaborator = await getCollaborator(project, request.params.id);
    if (!collaborator) throw new ApiError(404, "collaborator_not_found", "No existe esa cuenta en el proyecto.");
    if (collaborator.status !== "approved") {
      throw new ApiError(409, "not_approved", "Solo una colaboración aprobada puede activarse.");
    }
    const activation = await createActivation(project, collaborator.id, request.operator);
    return reply.status(201).send({
      ...activation,
      activationPath: `activar?token=${encodeURIComponent(activation.token)}`,
    });
  });
}
