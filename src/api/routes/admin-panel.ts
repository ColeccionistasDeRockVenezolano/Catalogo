// CRV · API del panel /curaduria/roadmap (el /admin de Herra 1.1.39).
//
// `web/public/landing/admin.js` y `metrics.js` son los de Herra y hablan con estas
// rutas con sus mismos caminos, cuerpos y respuestas. Viven bajo /community/admin:
// el guardián de `src/api/auth.ts` exige sesión, rol y CSRF antes de llegar aquí.
// Los errores van como `{ error: "texto" }`, que es lo que el guion pinta.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../http-errors.js";
import { projectId, createCollaborator, deleteCollaborator, isLinkedAdmin, setAccessCode, setUsername, updateCollaborator } from "../community/store.js";
import { acceptApplication, setApplicationStatus } from "../community/applications.js";
import { createActivation, createInvite, listActivations, listInvites, revokeActivation, revokeInvite } from "../community/tokens.js";
import { createProfileTerm } from "../project/collaborate-config.js";
import { updateProjectConfig } from "../project/config.js";
import { deleteAsset } from "../project/identity.js";
import { changeOwnPassword } from "../account/store.js";
import {
  createCategory, createTask, deleteCategory, deleteTask, moveTask, moveTaskToCategory, updateCategory, updateTask,
} from "../roadmap/store.js";
import { parseMetricsRange, trafficReport } from "../../traffic/report.js";
import { getPool } from "../../db/client.js";
import { campaignLinks, createCampaignLink } from '../../traffic/acquisition.js';
import { settleTraffic } from '../../traffic/record.js';
import {
  applicationDetail, brandingPayload, catalogGroups, countOpenApplications, getPersonProfile, getRoadmap, getUsers,
  i18nPayload, listApplicationRows, listPendingUsers, listProjectCollaborations, personOfProject, projectAssets, projectRow,
  saveAssetFromDataUrl, saveContentTranslations, setProjectColumn, translatableContent, updatePersonFromBody, usersPayload,
} from "../../landing/admin-panel.js";
import { parseBrandingOverrides } from "../../landing/herra/branding.js";
import { parseCollaborateOverrides, resolveCollaborateForm } from "../../landing/herra/collaborate-form.js";
import { isTranslationsInput } from "../../landing/herra/content-i18n.js";
import { TRANSLATABLE_LANGS } from "../../landing/herra/i18n.js";
import { parseProjectI18nOverrides } from "../../landing/herra/project-i18n.js";
import { parseThemeOverrides } from "../../landing/herra/theme.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos libres: se validan a mano como en Herra. */
type Body = Record<string, any>;
const PREFIX = "/community/admin/panel";
const MAX_TITLE = 300;
const MAX_JSON = 20_000;

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const parsePosition = (value: unknown): number | null => (value === undefined || value === null || value === "" ? null : parseId(value));
const parseStatus = (value: unknown): "pending" | "in_progress" | "completed" | null =>
  (value === "pending" || value === "in_progress" || value === "completed" ? value : null);
function parseAssigned(body: Body): number[] | undefined {
  const raw = body["assignedUserIds"];
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return [];
  const ids = (Array.isArray(raw) ? raw : [raw]).map(Number);
  return ids.some((id) => !Number.isInteger(id) || id <= 0) ? undefined : [...new Set(ids)];
}
const fail = (status: number, message: string): ApiError => new ApiError(status, "panel_error", message);
const langOf = (request: FastifyRequest): "es" | "en" => ((request.query as { lang?: string }).lang === "en" ? "en" : "es");

/** `community` no gestiona la cuenta de un administrador: su clave también abre la administración. */
async function assertManageable(request: FastifyRequest, project: number, userId: number): Promise<void> {
  if (request.viewer?.role === "community" && await isLinkedAdmin(project, userId)) {
    throw fail(403, "Esa cuenta está vinculada a un administrador; solo un admin puede gestionarla.");
  }
}

function requireFullAdmin(request: FastifyRequest): void {
  if (request.viewer?.role !== "admin") throw fail(403, "Solo una cuenta de administración total puede cambiar esto.");
}

/** Dirección pública de la página: el gateway dice bajo qué prefijo sirve. */
function publicUrl(request: FastifyRequest, path: string): string {
  const header = (name: string): string | undefined => {
    const raw = request.headers[name];
    return typeof raw === "string" && raw ? raw.split(",")[0]!.trim() : undefined;
  };
  const prefix = (header("x-crv-base-path") ?? "").replace(/\/$/u, "");
  const origin = header("origin") ?? `${header("x-forwarded-proto") ?? request.protocol}://${header("x-forwarded-host") ?? request.headers.host}`;
  return `${origin}${prefix}/${path}`;
}

type Handler = (request: FastifyRequest, reply: FastifyReply, project: number, body: Body) => Promise<unknown>;

export async function registerAdminPanelRoutes(app: FastifyInstance): Promise<void> {
  const wrap = (handler: Handler) => async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    reply.header("Cache-Control", "no-store");
    try {
      return await handler(request, reply, await projectId(), (request.body ?? {}) as Body);
    } catch (error) {
      if (error instanceof ApiError) return reply.status(error.statusCode).send({ error: error.message });
      throw error;
    }
  };
  const params = (request: FastifyRequest): Record<string, string> => request.params as Record<string, string>;
  const route = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, handler: Handler, bodyLimit?: number): void => {
    app.route({ method, url: `${PREFIX}${path}`, schema: { tags: ["Panel"] }, ...(bodyLimit ? { bodyLimit } : {}), handler: wrap(handler) });
  };
  const idOf = (request: FastifyRequest): number => {
    const id = parseId(params(request)["id"]);
    if (!id) throw fail(400, "ID inválido.");
    return id;
  };
  const adminId = (request: FastifyRequest): number | null => (request.account?.kind === "admin" ? request.account.id : null);

  // -------------------------------------------------------------- candidaturas
  route("GET", "/applications", async (request, _reply, project) => {
    const query = request.query as { status?: string; search?: string; termId?: string };
    const known = ["new", "reviewing", "contact", "accepted", "rejected", "archived", "open"];
    const termId = parseId(query.termId) ?? undefined;
    return {
      applications: await listApplicationRows(project, {
        status: query.status && known.includes(query.status) ? query.status : undefined, search: query.search, termId,
      }),
      openApplications: await countOpenApplications(project),
    };
  });
  route("GET", "/applications/:id", async (request, _reply, project) => {
    const detail = await applicationDetail(project, idOf(request));
    if (!detail) throw fail(404, "Candidatura no encontrada.");
    return detail;
  });
  route("PATCH", "/applications/:id/status", async (request, _reply, project, body) => {
    const status = body["status"];
    if (!["new", "reviewing", "contact", "rejected", "archived"].includes(status)) throw fail(400, "Estado inválido. Para aceptar, usa la acción de aceptación.");
    const id = idOf(request);
    await setApplicationStatus(project, id, status, adminId(request));
    const detail = await applicationDetail(project, id);
    return { application: detail?.["application"], applications: await listApplicationRows(project, { status: "open" }), openApplications: await countOpenApplications(project) };
  });
  route("POST", "/applications/:id/accept", async (request, reply, project, body) => {
    const hasPerson = body["personId"] !== undefined && body["personId"] !== "";
    const personId = hasPerson ? parseId(body["personId"]) : undefined;
    if (hasPerson && !personId) throw fail(400, "Persona inválida.");
    const result = await acceptApplication(project, idOf(request), adminId(request), request.operator, personId ?? undefined);
    return reply.status(201).send({
      personId: result.personId, userId: result.userId, createdPerson: result.createdPerson,
      activationUrl: publicUrl(request, `activar?token=${encodeURIComponent(result.activationToken)}`),
      activationExpiresAt: result.activationExpiresAt,
      applications: await listApplicationRows(project, { status: "open" }),
      openApplications: await countOpenApplications(project), users: await getUsers(project),
    });
  });

  // ------------------------------------------------------- enlaces de activación
  route("POST", "/users/:id/activation", async (request, reply, project) => {
    await assertManageable(request, project, idOf(request));
    const activation = await createActivation(project, idOf(request), request.operator);
    return reply.status(201).send({
      url: publicUrl(request, `activar?token=${encodeURIComponent(activation.token)}`),
      expiresAt: activation.expiresAt, activations: await listActivations(project),
    });
  });
  route("POST", "/activations/:id/revoke", async (request, _reply, project) => {
    await revokeActivation(project, idOf(request));
    return { ok: true, activations: await listActivations(project) };
  });

  // ------------------------------------------------------------------- personas
  route("GET", "/collaborations", async (_request, _reply, project) => ({ collaborations: await listProjectCollaborations(project) }));
  route("GET", "/people/:id", async (request, _reply, project) => {
    const id = idOf(request);
    if (!(await personOfProject(project, id))) throw fail(404, "Persona no encontrada.");
    return getPersonProfile(id, langOf(request));
  });
  route("PATCH", "/people/:id", async (request, _reply, project, body) => {
    const id = idOf(request);
    if (!(await personOfProject(project, id))) throw fail(404, "Persona no encontrada.");
    await updatePersonFromBody(id, body);
    return { profile: await getPersonProfile(id, langOf(request)), collaborations: await listProjectCollaborations(project) };
  });

  // ------------------------------------------------------------------- catálogo
  route("GET", "/catalog", async (request) => catalogGroups(langOf(request)));
  route("POST", "/catalog", async (request, reply, _project, body) => {
    const { type } = body;
    if (type !== "skill" && type !== "contribution_area" && type !== "link_type") throw fail(400, "Tipo de categoría inválido.");
    const label = typeof body["label"] === "string" ? body["label"].trim() : "";
    if (!label || label.length > 80) throw fail(400, "La etiqueta es obligatoria y debe tener como máximo 80 caracteres.");
    const pool = getPool();
    const found = (await pool.query<Body>("SELECT * FROM auth.catalog_terms WHERE type = $1 AND lower(label) = lower($2)", [type, label])).rows[0];
    if (found?.["archived_at"]) await pool.query("UPDATE auth.catalog_terms SET archived_at = NULL WHERE id = $1", [found["id"]]);
    const id: number = found ? found["id"] : (await createProfileTerm(type, label)).id;
    const term = (await pool.query<Body>("SELECT * FROM auth.catalog_terms WHERE id = $1", [id])).rows[0];
    return reply.status(found ? 200 : 201).send({ term, existing: Boolean(found), catalog: await catalogGroups(langOf(request)) });
  });

  // ----------------------------------------------------------------- actividades
  const taskOf = async (project: number, id: number): Promise<{ task: Body | undefined; roadmap: Body }> => {
    const roadmap = await getRoadmap(project);
    const task = (roadmap["categories"] as Body[]).flatMap((category) => category["tasks"] as Body[]).find((item) => item["id"] === id);
    return { task, roadmap };
  };
  route("GET", "/tasks", async (_request, _reply, project) => getRoadmap(project));
  route("POST", "/tasks", async (_request, reply, project, body) => {
    const title = typeof body["title"] === "string" ? body["title"].trim() : "";
    const status = parseStatus(body["status"]);
    const categoryId = parseId(body["categoryId"]);
    const assigned = parseAssigned(body);
    if (!title || title.length > MAX_TITLE) throw fail(400, `El título es obligatorio y debe tener como máximo ${MAX_TITLE} caracteres.`);
    if (!status) throw fail(400, "Estado inválido.");
    if (!categoryId) throw fail(400, "Categoría inválida.");
    if (body["assignedUserIds"] !== undefined && assigned === undefined) throw fail(400, "Usuario asignado inválido.");
    if (body["translations"] !== undefined && !isTranslationsInput(body["translations"])) throw fail(400, "Traducción inválida.");
    const position = parsePosition(body["position"]);
    await createTask(project, {
      categoryId, title, status, ...(position ? { position } : {}), assignedUserIds: assigned ?? [],
      ...(body["translations"] !== undefined ? { translations: body["translations"] } : {}),
    });
    const created = (await getPool().query<{ id: number }>("SELECT id FROM auth.tasks WHERE project_id = $1 AND category_id = $2 AND title = $3 ORDER BY id DESC LIMIT 1", [project, categoryId, title])).rows[0];
    return reply.status(201).send(await taskOf(project, created?.id ?? 0));
  });
  route("PATCH", "/tasks/:id", async (request, _reply, project, body) => {
    const id = idOf(request);
    const patch: Parameters<typeof updateTask>[2] = {};
    if (body["translations"] !== undefined) {
      if (!isTranslationsInput(body["translations"])) throw fail(400, "Traducción inválida.");
      patch.translations = body["translations"];
    }
    if (body["title"] !== undefined) {
      const title = typeof body["title"] === "string" ? body["title"].trim() : "";
      if (!title || title.length > MAX_TITLE) throw fail(400, "Título inválido.");
      patch.title = title;
    }
    if (body["status"] !== undefined) {
      const status = parseStatus(body["status"]);
      if (!status) throw fail(400, "Estado inválido.");
      patch.status = status;
    }
    if (body["categoryId"] !== undefined) {
      const category = parseId(body["categoryId"]);
      if (!category) throw fail(400, "Categoría inválida.");
      patch.categoryId = category;
    }
    if (body["position"] !== undefined) {
      const position = parsePosition(body["position"]);
      if (position === null) throw fail(400, "Posición inválida.");
      patch.position = position;
    }
    if (body["assignedUserIds"] !== undefined) {
      const assigned = parseAssigned(body);
      if (assigned === undefined) throw fail(400, "Usuarios asignados inválidos.");
      patch.assignedUserIds = assigned;
    }
    if (body["pinned"] !== undefined) {
      if (typeof body["pinned"] !== "boolean") throw fail(400, "Anclaje inválido.");
      patch.pinned = body["pinned"];
    }
    if (Object.keys(patch).length === 0) throw fail(400, "Nada que actualizar.");
    await updateTask(project, id, patch);
    return taskOf(project, id);
  });
  route("DELETE", "/tasks/:id", async (request, _reply, project) => {
    await deleteTask(project, idOf(request));
    return { ok: true, roadmap: await getRoadmap(project) };
  });
  route("POST", "/tasks/:id/move", async (request, _reply, project, body) => {
    const direction = body["direction"];
    if (direction !== "up" && direction !== "down") throw fail(400, "Dirección inválida (up|down).");
    const id = idOf(request);
    await moveTask(project, id, direction);
    return taskOf(project, id);
  });
  route("POST", "/tasks/:id/category", async (request, _reply, project, body) => {
    const id = idOf(request);
    const category = parseId(body["categoryId"]);
    if (!category) throw fail(400, "Parámetros inválidos.");
    await moveTaskToCategory(project, id, category);
    return taskOf(project, id);
  });

  // --------------------------------------------------------------------- etapas
  const categoryOf = async (project: number, id: number): Promise<{ category: Body | undefined; roadmap: Body }> => {
    const roadmap = await getRoadmap(project);
    return { category: (roadmap["categories"] as Body[]).find((item) => item["id"] === id), roadmap };
  };
  route("PATCH", "/categories/:id", async (request, _reply, project, body) => {
    const id = idOf(request);
    const patch: Parameters<typeof updateCategory>[2] = {};
    if (body["title"] !== undefined) {
      const title = typeof body["title"] === "string" ? body["title"].trim() : "";
      if (!title || title.length > MAX_TITLE) throw fail(400, "Título de categoría inválido.");
      patch.title = title;
    }
    if (body["translations"] !== undefined) {
      if (!isTranslationsInput(body["translations"])) throw fail(400, "Traducción inválida.");
      patch.translations = body["translations"];
    }
    if (body["position"] !== undefined) {
      const position = parsePosition(body["position"]);
      if (position === null) throw fail(400, "Posición inválida.");
      patch.position = position;
    }
    if (Object.keys(patch).length === 0) throw fail(400, "Nada que actualizar.");
    await updateCategory(project, id, patch);
    return categoryOf(project, id);
  });
  route("POST", "/categories", async (_request, reply, project, body) => {
    const title = typeof body["title"] === "string" ? body["title"].trim() : "";
    if (!title || title.length > MAX_TITLE) throw fail(400, "Título de categoría inválido.");
    if (body["translations"] !== undefined && !isTranslationsInput(body["translations"])) throw fail(400, "Traducción inválida.");
    await createCategory(project, title, body["translations"]);
    const created = (await getPool().query<{ id: number }>("SELECT id FROM auth.categories WHERE project_id = $1 AND title = $2 ORDER BY id DESC LIMIT 1", [project, title])).rows[0];
    return reply.status(201).send(await categoryOf(project, created?.id ?? 0));
  });
  route("DELETE", "/categories/:id", async (request, _reply, project) => {
    await deleteCategory(project, idOf(request), true);
    return { ok: true, roadmap: await getRoadmap(project) };
  });

  // --------------------------------------------------------------- colaboradores
  route("GET", "/users", async (_request, _reply, project) => usersPayload(project));
  route("POST", "/users", async (_request, reply, project, body) => {
    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    const firstName = typeof body["firstName"] === "string" ? body["firstName"] : "";
    const lastName = typeof body["lastName"] === "string" ? body["lastName"] : "";
    const accessCode = typeof body["accessCode"] === "string" ? body["accessCode"] : "";
    if (!firstName.trim() || !lastName.trim()) throw fail(400, "Nombre y apellido son obligatorios.");
    const user = await createCollaborator(project, { name, firstName, lastName, accessCode });
    return reply.status(201).send({ user, ...(await usersPayload(project)) });
  });
  route("PATCH", "/users/:id", async (request, _reply, project, body) => {
    const id = idOf(request);
    if (body["name"] === undefined && body["accessCode"] === undefined) throw fail(400, "Nada que actualizar.");
    await assertManageable(request, project, id);
    if (body["name"] !== undefined) await setUsername(project, id, typeof body["name"] === "string" ? body["name"].trim() : "");
    if (body["accessCode"] !== undefined) await setAccessCode(project, id, typeof body["accessCode"] === "string" ? body["accessCode"] : "");
    const payload = await usersPayload(project);
    return { user: (payload["users"] as Body[]).find((item) => item["id"] === id), ...payload };
  });
  route("DELETE", "/users/:id", async (request, _reply, project) => {
    await assertManageable(request, project, idOf(request));
    await deleteCollaborator(project, idOf(request));
    return { ok: true, ...(await usersPayload(project)), roadmap: await getRoadmap(project) };
  });
  const decide = (status: "approved" | "rejected"): Handler => async (request, _reply, project) => {
    const id = idOf(request);
    await assertManageable(request, project, id);
    await updateCollaborator(project, id, { status });
    const payload = await usersPayload(project);
    return { user: (payload["collaborations"] as Body[]).find((item) => item["id"] === id), ...payload, pendingUsers: await listPendingUsers(project) };
  };
  route("PATCH", "/users/:id/approve", decide("approved"));
  route("PATCH", "/users/:id/reject", decide("rejected"));
  route("GET", "/pending-users", async (_request, _reply, project) => ({ pendingUsers: await listPendingUsers(project) }));

  // --------------------------------------------------------- enlaces de registro
  route("GET", "/invites", async (_request, _reply, project) => ({ invites: await listInvites(project) }));
  route("POST", "/invites", async (request, reply, project) => {
    const invite = await createInvite(project, request.operator);
    const invites = await listInvites(project);
    return reply.status(201).send({
      id: invites[0]?.id, url: publicUrl(request, `registro?token=${encodeURIComponent(invite.token)}`),
      expiresAt: invite.expiresAt, invites,
    });
  });
  route("POST", "/invites/:id/revoke", async (request, _reply, project) => {
    await revokeInvite(project, idOf(request));
    return { ok: true, invites: await listInvites(project) };
  });

  // --------------------------------------------------- ajustes, tema e identidad
  route("PUT", "/settings", async (request, _reply, project, body) => {
    requireFullAdmin(request);
    const visibility = body["visibilityMode"];
    if (!["hidden", "progress", "completed", "full"].includes(visibility)) throw fail(400, "Modo de visibilidad inválido.");
    const defaultLang = body["defaultLang"];
    if (defaultLang !== "es" && defaultLang !== "en" && defaultLang !== "system") throw fail(400, "Idioma por defecto inválido.");
    const current = await projectRow(project);
    const flag = (value: unknown): boolean => value === true || value === "true";
    const keep = (value: unknown, now: unknown): boolean => (value === undefined ? now === 1 : flag(value));
    await updateProjectConfig({
      name: typeof body["name"] === "string" ? body["name"] : "", visibility, defaultLang,
      acceptsApplications: flag(body["acceptsApplications"]),
      showLogin: keep(body["showLogin"], current["show_login"]),
      visitorCounter: keep(body["visitorCounter"], current["visitor_counter"]),
    });
    return { ok: true, project: await projectRow(project) };
  });
  route("PUT", "/theme", async (request, _reply, project, body) => {
    requireFullAdmin(request);
    const raw = typeof body["themeJson"] === "string" ? body["themeJson"] : "";
    if (raw.length > MAX_JSON) throw fail(400, "El tema es demasiado grande.");
    const parsed = parseThemeOverrides(raw);
    if (!parsed.ok) throw fail(400, parsed.error);
    if ("projectName" in parsed.value) throw fail(400, "El nombre se configura en Configuración general.");
    const updated = await setProjectColumn(project, "theme_json", raw.trim() === "" ? null : JSON.stringify(parsed.value, null, 2));
    return { ok: true, themeJson: updated["theme_json"] ?? "" };
  });
  route("GET", "/collaborate-form", async (_request, _reply, project) => {
    const row = await projectRow(project);
    const parsed = parseCollaborateOverrides(row["collaborate_json"] ?? "");
    return { form: resolveCollaborateForm(row), overrides: parsed.ok ? parsed.value : {} };
  });
  route("PUT", "/collaborate-form", async (_request, _reply, project, body) => {
    const raw = typeof body["collaborateJson"] === "string" ? body["collaborateJson"] : "";
    if (raw.length > MAX_JSON) throw fail(400, "La configuración es demasiado grande.");
    const parsed = parseCollaborateOverrides(raw);
    if (!parsed.ok) throw fail(400, parsed.error);
    const clean = Object.keys(parsed.value).length === 0 ? null : JSON.stringify(parsed.value, null, 2);
    const updated = await setProjectColumn(project, "collaborate_json", clean);
    return { ok: true, form: resolveCollaborateForm(updated), overrides: parsed.value };
  });
  route("GET", "/branding", async (_request, _reply, project) => brandingPayload(await projectRow(project)));
  route("PUT", "/branding", async (request, _reply, project, body) => {
    requireFullAdmin(request);
    const raw = typeof body["brandingJson"] === "string" ? body["brandingJson"] : "";
    if (raw.length > MAX_JSON) throw fail(400, "La configuración es demasiado grande.");
    const parsed = parseBrandingOverrides(raw);
    if (!parsed.ok) throw fail(400, parsed.error);
    const clean = Object.keys(parsed.value).length === 0 ? null : JSON.stringify(parsed.value, null, 2);
    return { ok: true, ...(await brandingPayload(await setProjectColumn(project, "branding_json", clean))) };
  });
  route("GET", "/i18n", async (_request, _reply, project) => i18nPayload(await projectRow(project)));
  route("PUT", "/i18n", async (request, _reply, project, body) => {
    requireFullAdmin(request);
    const raw = typeof body["i18nJson"] === "string" ? body["i18nJson"] : "";
    if (raw.length > MAX_JSON) throw fail(400, "La configuración es demasiado grande.");
    const parsed = parseProjectI18nOverrides(raw);
    if (!parsed.ok) throw fail(400, parsed.error);
    const clean = Object.keys(parsed.value).length === 0 ? null : JSON.stringify(parsed.value, null, 2);
    return { ok: true, ...i18nPayload(await setProjectColumn(project, "i18n_json", clean)) };
  });
  route("GET", "/content-i18n", async (_request, _reply, project) => ({ stages: translatableContent(await getRoadmap(project)), langs: TRANSLATABLE_LANGS }));
  route("PUT", "/content-i18n", async (_request, _reply, project, body) => {
    for (const group of [body["categories"], body["tasks"]]) {
      if (group === undefined) continue;
      if (typeof group !== "object" || group === null || Array.isArray(group)) throw fail(400, "Traducciones inválidas.");
      if (Object.keys(group as object).length > 500) throw fail(400, "Demasiadas traducciones en un solo envío.");
      for (const translations of Object.values(group as object)) {
        if (!isTranslationsInput(translations)) throw fail(400, "Traducción inválida.");
      }
    }
    const saved = await saveContentTranslations(project, body);
    return { ok: true, ...saved, stages: translatableContent(await getRoadmap(project)) };
  });
  const assetKind = (request: FastifyRequest): "favicon" | "share_image" => {
    const { kind } = params(request);
    if (kind !== "favicon" && kind !== "share_image") throw fail(400, "Tipo de imagen inválido.");
    return kind;
  };
  route("POST", "/assets/:kind", async (request, reply, project, body) => {
    requireFullAdmin(request);
    const saved = await saveAssetFromDataUrl(project, assetKind(request), body["dataUrl"]);
    return reply.status(201).send({ ok: true, ...saved });
  }, 5 * 1024 * 1024);
  route("DELETE", "/assets/:kind", async (request, _reply, project) => {
    requireFullAdmin(request);
    const kind = assetKind(request);
    if (!(await projectAssets(project))[kind]) throw fail(404, "Esa imagen no existe.");
    await deleteAsset(kind);
    return { ok: true, assets: await projectAssets(project) };
  });

  // --------------------------------------------------------- visitas y métricas
  route("DELETE", "/visits", async (request, _reply, project) => {
    requireFullAdmin(request);
    const pool = getPool();
    await pool.query("DELETE FROM auth.project_visit_stats WHERE project_id = $1", [project]);
    await pool.query("DELETE FROM auth.project_visits WHERE project_id = $1", [project]);
    return { ok: true };
  });
  route("GET", "/metrics", async (request, _reply, project) => {
    await settleTraffic();
    return trafficReport(project, parseMetricsRange((request.query as { days?: unknown }).days), langOf(request));
  });
  route('GET', '/metrics/links', async (_request, _reply, project) => ({ links: await campaignLinks(project) }));
  route('POST', '/metrics/links', async (request, reply, project, body) => {
    requireFullAdmin(request);
    return reply.status(201).send({ link: await createCampaignLink(project, body) });
  }, 4096);
  route('PATCH', '/metrics/links/:id', async (request, _reply, project, body) => {
    requireFullAdmin(request);
    if (typeof body['archived'] !== 'boolean' || Object.keys(body).some(key => key !== 'archived')) throw fail(400, 'Solo se puede cambiar el archivo del enlace.');
    const result = await getPool().query('UPDATE auth.traffic_links SET archived=$1 WHERE id=$2 AND project_id=$3 RETURNING id',
      [body['archived'], idOf(request), project]);
    if (!result.rowCount) throw fail(404, 'Ese enlace no existe.');
    return { ok: true };
  });

  // ------------------------------------------------------------ clave propia
  route("POST", "/account/password", async (request, _reply, _project, body) => {
    const account = request.account;
    if (!account) throw fail(401, "No autenticado");
    const current = typeof body["currentPassword"] === "string" ? body["currentPassword"] : "";
    const next = typeof body["newPassword"] === "string" ? body["newPassword"] : "";
    const result = await changeOwnPassword(account.kind, account.id, current, next);
    await request.server.restampSession(request, result.sessionVersion);
    return { ok: true };
  });
}
