// CRV · Roadmap: lectura pública, lectura de administración y escritura (Fase 2).
//
// El progreso nunca se guarda: se deriva de los estados reales. El orden vive
// en `sort_order` y replica la regla de Herra: primero lo abierto, al pie lo
// completado por fecha de finalización; una actividad movida a mano queda
// anclada (`order_pinned = 1`).
import type { PoolClient } from "pg";
import { getPool } from "../../db/client.js";
import { ApiError } from "../http-errors.js";
import { withTransaction } from "../community/store.js";
import { localizeRow, parseTranslations, serializeTranslations, type RowTranslations } from "./translations.js";

const NOW = "to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')";
const COLORS = ["red", "amber", "violet", "teal"] as const;
export type TaskStatus = "pending" | "in_progress" | "completed";
export type Lang = "es" | "en";

export interface Progress { total: number; completed: number; percentage: number }
export interface AssignedUser { id: number; name: string; displayName: string }
export interface TaskView {
  id: number; categoryId: number; title: string; status: TaskStatus; sortOrder: number;
  orderPinned: boolean; completedAt: string | null; updatedAt: string;
  i18n: RowTranslations; assignedUsers: AssignedUser[];
}
export interface CategoryView {
  id: number; slug: string; title: string; colorKey: string;
  i18n: RowTranslations; progress: Progress; tasks: TaskView[];
}
export interface RoadmapView {
  visibility: string; overall: Progress; categories: CategoryView[]; lastUpdated: string | null;
}
export interface PublicTask { id: number; title: string; status: TaskStatus; completedAt: string | null; updatedAt: string }
export interface PublicCategory { id: number; slug: string; title: string; colorKey: string; progress: Progress; tasks: PublicTask[] }
export interface PublicRoadmap { visibility: string; overall: Progress; categories: PublicCategory[]; lastUpdated: string | null; collaborators: number }
export interface AssignableUser { id: number; name: string; displayName: string }

interface CategoryRow { id: number; slug: string; title: string; color_key: string; i18n_json: string | null }
interface TaskRow {
  id: number; category_id: number; title: string; status: TaskStatus; sort_order: number;
  order_pinned: number; assigned_user_id: number | null; completed_at: string | null;
  updated_at: string; i18n_json: string | null;
}
interface UserRow { id: number; name: string; first_name: string | null; last_name: string | null }

function pct(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (completed / total) * 100));
}

function displayName(row: UserRow): string {
  const full = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return full || row.name;
}

function requireTitle(title: string, field = "título"): string {
  const clean = title.trim();
  if (!clean || clean.length > 300) throw new ApiError(422, "invalid_title", `El ${field} es obligatorio y admite hasta 300 caracteres.`);
  return clean;
}

function slugBase(title: string): string {
  const base = title.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 60);
  return base || "etapa";
}

export async function projectVisibility(projectId: number): Promise<string> {
  const { rows } = await getPool().query<{ visibility_mode: string }>(
    "SELECT visibility_mode FROM auth.projects WHERE id = $1", [projectId]);
  if (!rows[0]) throw new ApiError(404, "project_not_found", "No existe el proyecto.");
  return rows[0].visibility_mode;
}

async function readRoadmap(projectId: number, lang: Lang | null): Promise<RoadmapView> {
  const pool = getPool();
  const [visibility, categoriesResult, tasksResult, assignmentsResult, usersResult] = await Promise.all([
    projectVisibility(projectId),
    pool.query<CategoryRow>("SELECT id, slug, title, color_key, i18n_json FROM auth.categories WHERE project_id = $1 ORDER BY sort_order ASC, id ASC", [projectId]),
    pool.query<TaskRow>(`SELECT id, category_id, title, status, sort_order, order_pinned, assigned_user_id,
      completed_at, updated_at, i18n_json FROM auth.tasks WHERE project_id = $1
      ORDER BY category_id ASC, sort_order ASC, id ASC`, [projectId]),
    pool.query<{ task_id: number; id: number; name: string; first_name: string | null; last_name: string | null }>(
      `SELECT ta.task_id, u.id, u.name::text AS name, u.first_name, u.last_name
         FROM auth.task_assignees ta
         JOIN auth.users u ON u.id = ta.user_id
         JOIN auth.tasks t ON t.id = ta.task_id
        WHERE t.project_id = $1
        ORDER BY ta.task_id ASC, u.name::text ASC, u.id ASC`, [projectId]),
    pool.query<UserRow>("SELECT id, name::text AS name, first_name, last_name FROM auth.users WHERE project_id = $1", [projectId]),
  ]);
  const users = new Map(usersResult.rows.map((row) => [row.id, row]));
  const byTask = new Map<number, AssignedUser[]>();
  for (const row of assignmentsResult.rows) {
    const list = byTask.get(row.task_id) ?? [];
    list.push({ id: row.id, name: row.name, displayName: displayName(row) });
    byTask.set(row.task_id, list);
  }
  const tasks: TaskView[] = tasksResult.rows.map((row) => {
    const assigned = byTask.get(row.id)
      ?? (row.assigned_user_id !== null && users.has(row.assigned_user_id)
        ? [{ id: row.assigned_user_id, name: users.get(row.assigned_user_id)!.name, displayName: displayName(users.get(row.assigned_user_id)!) }]
        : []);
    return {
      id: row.id,
      categoryId: row.category_id,
      title: lang ? localizeRow(row.i18n_json, row.title, lang) : row.title,
      status: row.status,
      sortOrder: row.sort_order,
      orderPinned: row.order_pinned === 1,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
      i18n: parseTranslations(row.i18n_json),
      assignedUsers: assigned,
    };
  });
  const categories: CategoryView[] = categoriesResult.rows.map((row) => {
    const list = tasks.filter((task) => task.categoryId === row.id);
    const completed = list.filter((task) => task.status === "completed").length;
    return {
      id: row.id,
      slug: row.slug,
      title: lang ? localizeRow(row.i18n_json, row.title, lang) : row.title,
      colorKey: row.color_key,
      i18n: parseTranslations(row.i18n_json),
      progress: { total: list.length, completed, percentage: pct(completed, list.length) },
      tasks: list,
    };
  });
  const all = tasks.length;
  const done = tasks.filter((task) => task.status === "completed").length;
  const lastUpdated = tasks.reduce<string | null>((latest, task) => (!latest || task.updatedAt > latest ? task.updatedAt : latest), null);
  return {
    visibility,
    overall: { total: all, completed: done, percentage: pct(done, all) },
    categories,
    lastUpdated,
  };
}

async function countCollaborators(projectId: number): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    "SELECT count(*)::int AS n FROM auth.users WHERE project_id = $1 AND status = 'approved'",
    [projectId],
  );
  return rows[0]?.n ?? 0;
}

/** Vista pública: aplica la política de visibilidad del proyecto y quita responsables. */
export async function publicRoadmap(projectId: number, lang: Lang, authenticated = false): Promise<PublicRoadmap> {
  const full = await readRoadmap(projectId, lang);
  if (full.visibility === "hidden" && !authenticated) {
    throw new ApiError(404, "roadmap_hidden", "El roadmap de este proyecto no está disponible.");
  }
  let categories = full.categories;
  let lastUpdated = full.lastUpdated;
  if (!authenticated && full.visibility === "progress") {
    categories = [];
    lastUpdated = null;
  } else if (!authenticated && full.visibility === "completed") {
    categories = full.categories
      .filter((category) => category.progress.completed > 0)
      .map((category) => ({ ...category, tasks: category.tasks.filter((task) => task.status === "completed") }));
  }
  return {
    visibility: full.visibility,
    overall: full.overall,
    collaborators: await countCollaborators(projectId),
    categories: categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      title: category.title,
      colorKey: category.colorKey,
      progress: category.progress,
      tasks: category.tasks.map((task) => ({
        id: task.id, title: task.title, status: task.status,
        completedAt: task.completedAt, updatedAt: task.updatedAt,
      })),
    })),
    lastUpdated,
  };
}

/** Vista de administración: originales, traducciones crudas y responsables. */
export async function adminRoadmap(projectId: number): Promise<RoadmapView & { users: AssignableUser[] }> {
  const view = await readRoadmap(projectId, null);
  return { ...view, users: await listAssignableUsers(projectId) };
}

export async function listAssignableUsers(projectId: number): Promise<AssignableUser[]> {
  const { rows } = await getPool().query<UserRow>(
    "SELECT id, name::text AS name, first_name, last_name FROM auth.users WHERE project_id = $1 AND status = 'approved' ORDER BY name::text ASC, id ASC",
    [projectId]);
  return rows.map((row) => ({ id: row.id, name: row.name, displayName: displayName(row) }));
}

async function ensureCategory(client: PoolClient, projectId: number, id: number): Promise<void> {
  const { rowCount } = await client.query("SELECT 1 FROM auth.categories WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw new ApiError(404, "category_not_found", "No existe esa etapa.");
}

async function ensureUsers(client: PoolClient, projectId: number, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const { rows } = await client.query<{ id: number }>(
    "SELECT id FROM auth.users WHERE project_id = $1 AND id = ANY($2::int[])", [projectId, ids]);
  if (rows.length !== new Set(ids).size) throw new ApiError(422, "invalid_assignee", "Alguna persona asignada no pertenece al proyecto.");
}

async function uniqueCategorySlug(client: PoolClient, projectId: number, title: string): Promise<string> {
  const base = slugBase(title);
  let slug = base;
  let suffix = 2;
  while ((await client.query("SELECT 1 FROM auth.categories WHERE project_id = $1 AND slug = $2", [projectId, slug])).rowCount) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

async function normalizeCategories(client: PoolClient, projectId: number): Promise<void> {
  const { rows } = await client.query<{ id: number }>(
    "SELECT id FROM auth.categories WHERE project_id = $1 ORDER BY sort_order ASC, id ASC", [projectId]);
  let position = 1;
  for (const row of rows) {
    await client.query("UPDATE auth.categories SET sort_order = $1 WHERE id = $2", [position, row.id]);
    position += 1;
  }
}

async function moveCategory(client: PoolClient, projectId: number, id: number, position: number): Promise<void> {
  const { rows } = await client.query<{ sort_order: number }>("SELECT sort_order FROM auth.categories WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rows[0] || rows[0].sort_order === position) return;
  const current = rows[0].sort_order;
  if (current < position) {
    await client.query("UPDATE auth.categories SET sort_order = sort_order - 1 WHERE project_id = $1 AND sort_order > $2 AND sort_order <= $3", [projectId, current, position]);
  } else {
    await client.query("UPDATE auth.categories SET sort_order = sort_order + 1 WHERE project_id = $1 AND sort_order >= $2 AND sort_order < $3", [projectId, position, current]);
  }
  await client.query("UPDATE auth.categories SET sort_order = $1 WHERE id = $2", [position, id]);
}

async function applyOrderRules(client: PoolClient, categoryId: number): Promise<void> {
  const { rows } = await client.query<{ id: number; status: TaskStatus; order_pinned: number; completed_at: string | null }>(
    "SELECT id, status, order_pinned, completed_at FROM auth.tasks WHERE category_id = $1 ORDER BY sort_order ASC, id ASC", [categoryId]);
  if (rows.length === 0) return;
  const slots: Array<number | null> = new Array(rows.length).fill(null);
  rows.forEach((row, index) => { if (row.order_pinned === 1) slots[index] = row.id; });
  const free = slots.map((value, index) => (value === null ? index : -1)).filter((index) => index >= 0);
  const movable = rows.filter((row) => row.order_pinned !== 1);
  const open = movable.filter((row) => row.status !== "completed");
  const finished = movable.filter((row) => row.status === "completed")
    .sort((a, b) => (a.completed_at ?? "").localeCompare(b.completed_at ?? "") || a.id - b.id);
  [...open, ...finished].forEach((row, index) => { slots[free[index]!] = row.id; });
  let position = 1;
  for (const id of slots) {
    if (id !== null) await client.query("UPDATE auth.tasks SET sort_order = $1 WHERE id = $2", [position, id]);
    position += 1;
  }
}

async function syncCompletedAt(client: PoolClient, id: number, status: TaskStatus): Promise<void> {
  if (status === "completed") {
    await client.query(`UPDATE auth.tasks SET completed_at = COALESCE(completed_at, ${NOW}) WHERE id = $1`, [id]);
  } else {
    await client.query("UPDATE auth.tasks SET completed_at = NULL WHERE id = $1", [id]);
  }
}

async function moveWithinCategory(client: PoolClient, id: number, position: number): Promise<void> {
  const { rows } = await client.query<{ category_id: number; sort_order: number }>(
    "SELECT category_id, sort_order FROM auth.tasks WHERE id = $1", [id]);
  if (!rows[0] || rows[0].sort_order === position) return;
  const { category_id: categoryId, sort_order: current } = rows[0];
  if (current < position) {
    await client.query("UPDATE auth.tasks SET sort_order = sort_order - 1 WHERE category_id = $1 AND sort_order > $2 AND sort_order <= $3", [categoryId, current, position]);
  } else {
    await client.query("UPDATE auth.tasks SET sort_order = sort_order + 1 WHERE category_id = $1 AND sort_order >= $2 AND sort_order < $3", [categoryId, position, current]);
  }
  await client.query("UPDATE auth.tasks SET sort_order = $1 WHERE id = $2", [position, id]);
}

async function normalizeCategory(client: PoolClient, categoryId: number): Promise<void> {
  const { rows } = await client.query<{ id: number }>(
    "SELECT id FROM auth.tasks WHERE category_id = $1 ORDER BY sort_order ASC, id ASC", [categoryId]);
  let position = 1;
  for (const row of rows) {
    await client.query("UPDATE auth.tasks SET sort_order = $1 WHERE id = $2", [position, row.id]);
    position += 1;
  }
}

async function touchTask(client: PoolClient, id: number): Promise<void> {
  await client.query(`UPDATE auth.tasks SET updated_at = ${NOW} WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------- categorías

export async function createCategory(projectId: number, title: string, translations: unknown): Promise<void> {
  const clean = requireTitle(title, "título de la etapa");
  await withTransaction(async (client) => {
    const stats = (await client.query<{ n: number; max: number }>(
      "SELECT count(*)::int AS n, coalesce(max(sort_order), 0)::int AS max FROM auth.categories WHERE project_id = $1", [projectId])).rows[0];
    const count = stats?.n ?? 0;
    const slug = await uniqueCategorySlug(client, projectId, clean);
    const color = COLORS[count % COLORS.length]!;
    await client.query(
      "INSERT INTO auth.categories (project_id, slug, title, sort_order, color_key, i18n_json) VALUES ($1, $2, $3, $4, $5, $6)",
      [projectId, slug, clean, (stats?.max ?? 0) + 1, color, serializeTranslations(translations)]);
    await normalizeCategories(client, projectId);
  });
}

export async function updateCategory(
  projectId: number, id: number,
  patch: { title?: string | undefined; position?: number | undefined; translations?: unknown },
): Promise<void> {
  await withTransaction(async (client) => {
    await ensureCategory(client, projectId, id);
    if (patch.position !== undefined) {
      const total = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM auth.categories WHERE project_id = $1", [projectId])).rows[0]?.n ?? 0;
      const position = Math.min(Math.max(1, patch.position), Math.max(1, total));
      await moveCategory(client, projectId, id, position);
      await normalizeCategories(client, projectId);
    }
    if (patch.title !== undefined) {
      await client.query("UPDATE auth.categories SET title = $1 WHERE id = $2 AND project_id = $3",
        [requireTitle(patch.title, "título de la etapa"), id, projectId]);
    }
    if (patch.translations !== undefined) {
      await client.query("UPDATE auth.categories SET i18n_json = $1 WHERE id = $2 AND project_id = $3",
        [serializeTranslations(patch.translations), id, projectId]);
    }
  });
}

export async function deleteCategory(projectId: number, id: number, force: boolean): Promise<void> {
  await withTransaction(async (client) => {
    await ensureCategory(client, projectId, id);
    const tasks = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM auth.tasks WHERE category_id = $1", [id])).rows[0]?.n ?? 0;
    if (tasks > 0 && !force) {
      throw new ApiError(409, "category_has_tasks", `La etapa tiene ${tasks} actividades. Confirma el borrado en cascada.`);
    }
    await client.query("DELETE FROM auth.categories WHERE id = $1 AND project_id = $2", [id, projectId]);
    await normalizeCategories(client, projectId);
  });
}

// ------------------------------------------------------------------- tareas

export async function createTask(projectId: number, input: {
  categoryId: number; title: string; status: TaskStatus; position?: number | undefined;
  assignedUserIds?: number[] | undefined; translations?: unknown;
}): Promise<void> {
  const title = requireTitle(input.title, "título de la actividad");
  const assigned = [...new Set(input.assignedUserIds ?? [])];
  await withTransaction(async (client) => {
    await ensureCategory(client, projectId, input.categoryId);
    await ensureUsers(client, projectId, assigned);
    const count = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM auth.tasks WHERE category_id = $1", [input.categoryId])).rows[0]?.n ?? 0;
    let position = input.position ?? count + 1;
    if (position < 1 || position > count + 1) position = count + 1;
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO auth.tasks (project_id, category_id, title, i18n_json, status, sort_order, assigned_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [projectId, input.categoryId, title, serializeTranslations(input.translations), input.status, count + 1, assigned[0] ?? null]);
    const id = inserted.rows[0]!.id;
    for (const userId of assigned) {
      await client.query("INSERT INTO auth.task_assignees (task_id, user_id) VALUES ($1, $2)", [id, userId]);
    }
    if (position <= count) await moveWithinCategory(client, id, position);
    await syncCompletedAt(client, id, input.status);
    await applyOrderRules(client, input.categoryId);
  });
}

export async function updateTask(projectId: number, id: number, patch: {
  title?: string | undefined; status?: TaskStatus | undefined; categoryId?: number | undefined;
  position?: number | undefined; assignedUserIds?: number[] | undefined; pinned?: boolean | undefined;
  completedAt?: string | null | undefined;
  translations?: unknown;
}): Promise<void> {
  await withTransaction(async (client) => {
    const current = (await client.query<{ category_id: number; sort_order: number }>(
      "SELECT category_id, sort_order FROM auth.tasks WHERE id = $1 AND project_id = $2 FOR UPDATE", [id, projectId])).rows[0];
    if (!current) throw new ApiError(404, "task_not_found", "No existe esa actividad.");
    if (patch.categoryId !== undefined) await ensureCategory(client, projectId, patch.categoryId);
    const assigned = patch.assignedUserIds === undefined ? undefined : [...new Set(patch.assignedUserIds)];
    if (assigned) await ensureUsers(client, projectId, assigned);

    const targetCategory = patch.categoryId ?? current.category_id;
    if (patch.categoryId !== undefined && patch.categoryId !== current.category_id) {
      await client.query("UPDATE auth.tasks SET sort_order = sort_order - 1 WHERE category_id = $1 AND sort_order > $2", [current.category_id, current.sort_order]);
      const destCount = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM auth.tasks WHERE category_id = $1", [patch.categoryId])).rows[0]?.n ?? 0;
      await client.query("UPDATE auth.tasks SET category_id = $1, sort_order = $2 WHERE id = $3", [patch.categoryId, destCount + 1, id]);
      let position = patch.position ?? destCount + 1;
      if (position < 1 || position > destCount + 1) position = destCount + 1;
      if (position <= destCount) await moveWithinCategory(client, id, position);
      await normalizeCategory(client, current.category_id);
    } else if (patch.position !== undefined) {
      const siblings = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM auth.tasks WHERE category_id = $1", [current.category_id])).rows[0]?.n ?? 0;
      const position = Math.min(Math.max(1, patch.position), Math.max(1, siblings));
      await moveWithinCategory(client, id, position);
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) { fields.push(`title = $${values.length + 1}`); values.push(requireTitle(patch.title, "título de la actividad")); }
    if (patch.translations !== undefined) { fields.push(`i18n_json = $${values.length + 1}`); values.push(serializeTranslations(patch.translations)); }
    if (patch.status !== undefined) { fields.push(`status = $${values.length + 1}`); values.push(patch.status); }
    if (assigned !== undefined) {
      fields.push(`assigned_user_id = $${values.length + 1}`);
      values.push(assigned[0] ?? null);
      await client.query("DELETE FROM auth.task_assignees WHERE task_id = $1", [id]);
      for (const userId of assigned) {
        await client.query("INSERT INTO auth.task_assignees (task_id, user_id) VALUES ($1, $2)", [id, userId]);
      }
    }
    fields.push(`updated_at = ${NOW}`);
    values.push(id);
    await client.query(`UPDATE auth.tasks SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    if (patch.pinned !== undefined) {
      await client.query("UPDATE auth.tasks SET order_pinned = $1 WHERE id = $2", [patch.pinned ? 1 : 0, id]);
    } else if (patch.position !== undefined) {
      // Solo un movimiento explícito de posición ancla. Cambiar de etapa deja
      // que la regla de cola coloque la actividad (abiertas primero).
      await client.query("UPDATE auth.tasks SET order_pinned = 1 WHERE id = $1", [id]);
    }
    if (patch.status !== undefined) await syncCompletedAt(client, id, patch.status);
    if (patch.completedAt !== undefined) await client.query("UPDATE auth.tasks SET completed_at = $1 WHERE id = $2", [patch.completedAt, id]);
    await applyOrderRules(client, current.category_id);
    if (targetCategory !== current.category_id) await applyOrderRules(client, targetCategory);
  });
}

export async function deleteTask(projectId: number, id: number): Promise<void> {
  await withTransaction(async (client) => {
    const row = (await client.query<{ category_id: number }>(
      "SELECT category_id FROM auth.tasks WHERE id = $1 AND project_id = $2", [id, projectId])).rows[0];
    if (!row) throw new ApiError(404, "task_not_found", "No existe esa actividad.");
    await client.query("DELETE FROM auth.tasks WHERE id = $1", [id]);
    await applyOrderRules(client, row.category_id);
  });
}

export async function moveTask(projectId: number, id: number, direction: "up" | "down"): Promise<void> {
  await withTransaction(async (client) => {
    const task = (await client.query<{ category_id: number; sort_order: number }>(
      "SELECT category_id, sort_order FROM auth.tasks WHERE id = $1 AND project_id = $2 FOR UPDATE", [id, projectId])).rows[0];
    if (!task) throw new ApiError(404, "task_not_found", "No existe esa actividad.");
    const target = direction === "up" ? task.sort_order - 1 : task.sort_order + 1;
    if (target < 1) return;
    const max = (await client.query<{ m: number | null }>("SELECT max(sort_order) AS m FROM auth.tasks WHERE category_id = $1", [task.category_id])).rows[0]?.m ?? 0;
    if (target > max) return;
    await moveWithinCategory(client, id, target);
    await client.query("UPDATE auth.tasks SET order_pinned = 1 WHERE id = $1", [id]);
    await applyOrderRules(client, task.category_id);
    await touchTask(client, id);
  });
}

export async function moveTaskToCategory(projectId: number, id: number, categoryId: number): Promise<void> {
  await updateTask(projectId, id, { categoryId });
}

export interface MyTask {
  id: number; categoryId: number; title: string; status: TaskStatus;
  completedAt: string | null; updatedAt: string;
}

const MY_TASK_WHERE = `t.project_id = $1 AND (
  EXISTS (SELECT 1 FROM auth.task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $2)
  OR t.assigned_user_id = $2
)`;

/** Actividades asignadas a una cuenta de colaborador, sin exponer las demás. */
export async function assignedTasks(projectId: number, userId: number, lang: Lang): Promise<MyTask[]> {
  const { rows } = await getPool().query<{
    id: number; category_id: number; title: string; i18n_json: string | null;
    status: TaskStatus; completed_at: string | null; updated_at: string;
  }>(
    `SELECT t.id, t.category_id, t.title, t.i18n_json, t.status, t.completed_at, t.updated_at
       FROM auth.tasks t
      WHERE ${MY_TASK_WHERE}
      ORDER BY t.category_id ASC, t.sort_order ASC, t.id ASC`,
    [projectId, userId],
  );
  return rows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    title: localizeRow(row.i18n_json, row.title, lang),
    status: row.status,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Cambio de estado por una persona asignada. No permite tocar títulos,
 * responsables ni otras actividades: solo el estado de lo suyo.
 */
export async function updateAssignedTaskStatus(
  projectId: number, userId: number, taskId: number, status: TaskStatus,
): Promise<MyTask> {
  const task = await withTransaction(async (client) => {
    const current = (await client.query<{ category_id: number }>(
      `SELECT t.category_id FROM auth.tasks t WHERE t.id = $3 AND ${MY_TASK_WHERE} FOR UPDATE`,
      [projectId, userId, taskId],
    )).rows[0];
    if (!current) {
      throw new ApiError(403, "task_not_assigned", "Solo puedes cambiar el estado de tus actividades.");
    }
    await client.query(`UPDATE auth.tasks SET status = $1, updated_at = ${NOW} WHERE id = $2`,
      [status, taskId]);
    await syncCompletedAt(client, taskId, status);
    await applyOrderRules(client, current.category_id);
    const updated = (await client.query<{
      id: number; category_id: number; title: string; i18n_json: string | null;
      status: TaskStatus; completed_at: string | null; updated_at: string;
    }>(
      `SELECT id, category_id, title, i18n_json, status, completed_at, updated_at
         FROM auth.tasks WHERE id = $1 AND project_id = $2`, [taskId, projectId],
    )).rows[0];
    if (!updated) throw new ApiError(404, "task_not_found", "No existe esa actividad.");
    return updated;
  });
  return {
    id: task.id,
    categoryId: task.category_id,
    title: task.title,
    status: task.status,
    completedAt: task.completed_at,
    updatedAt: task.updated_at,
  };
}

export async function saveTranslations(
  projectId: number,
  input: { categories?: Record<string, unknown> | undefined; tasks?: Record<string, unknown> | undefined },
): Promise<{ categories: number; tasks: number }> {
  return withTransaction(async (client) => {
    let categories = 0;
    let tasks = 0;
    for (const [rawId, translations] of Object.entries(input.categories ?? {})) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      const result = await client.query("UPDATE auth.categories SET i18n_json = $1 WHERE id = $2 AND project_id = $3",
        [serializeTranslations(translations), id, projectId]);
      categories += result.rowCount ?? 0;
    }
    for (const [rawId, translations] of Object.entries(input.tasks ?? {})) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      const result = await client.query(`UPDATE auth.tasks SET i18n_json = $1, updated_at = ${NOW} WHERE id = $2 AND project_id = $3`,
        [serializeTranslations(translations), id, projectId]);
      tasks += result.rowCount ?? 0;
    }
    return { categories, tasks };
  });
}
