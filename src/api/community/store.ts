// CRV · Acceso a las tablas de comunidad (Fase 1).
//
// Escrituras directas sobre `auth` con SQL parametrizado. El catálogo sigue
// leyendo el mismo esquema; durante la Fase 1 esta es la única capa que crea y
// modifica colaboradores. Todas las operaciones multi-tabla van en transacción.
import type { Pool, PoolClient } from "pg";
import { getPool } from "../../db/client.js";
import { getEnv } from "../../config/env.js";
import { ApiError } from "../http-errors.js";
import type { AccountRole } from "./roles.js";
import {
  hashAccessCode, isStrongAccessCode, normalizePersonName, validUsername,
  MAX_FIELD, MIN_USER_NAME,
} from "./validation.js";

export interface CollaboratorRow {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  status: "pending" | "approved" | "rejected";
  signup_source: string;
  session_version: number;
  created_at: string;
  person_id: number | null;
  email: string | null;
  whatsapp_phone: string | null;
  city: string | null;
  country: string | null;
  terms: string;
  has_access_code: boolean;
}

export interface AdminRow {
  id: number;
  username: string;
  role: string;
  project_id: number | null;
  user_id: number | null;
  session_version: number;
  created_at: string;
  person_name: string | null;
}

let projectCache: { slug: string; id: number } | undefined;

/** Id del proyecto único de CRV. El slug viene del entorno compartido. */
export async function projectId(pool: Pool = getPool()): Promise<number> {
  const slug = getEnv().CRV_HERRA_PROJECT_SLUG;
  if (projectCache?.slug === slug) return projectCache.id;
  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM auth.projects WHERE lower(slug::text) = lower($1)", [slug]);
  const id = rows[0]?.id;
  if (!id) throw new ApiError(500, "project_missing", "No existe el proyecto de CRV en la base de cuentas.");
  projectCache = { slug, id };
  return id;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => { /* la conexión se descarta igual */ });
    throw error;
  } finally {
    client.release();
  }
}

const COLLABORATOR_FIELDS = `
  u.id, u.name::text AS name, u.first_name, u.last_name, u.status, u.signup_source,
  u.session_version, u.created_at, u.person_id,
  (u.access_code_hash IS NOT NULL) AS has_access_code,
  p.email, p.whatsapp_phone, p.city, p.country,
  coalesce(t.terms, '') AS terms`;

const COLLABORATOR_JOINS = `
  FROM auth.users u
  LEFT JOIN auth.people p ON p.id = u.person_id
  LEFT JOIN LATERAL (
    SELECT string_agg(ct.label, ', ' ORDER BY ct.label) AS terms
      FROM auth.person_catalog_terms pct
      JOIN auth.catalog_terms ct ON ct.id = pct.term_id
     WHERE pct.person_id = u.person_id
  ) t ON true`;

export async function listCollaborators(
  project: number, filters: { status?: string | undefined; search?: string | undefined } = {},
): Promise<CollaboratorRow[]> {
  const status = filters.status && ["pending", "approved", "rejected"].includes(filters.status) ? filters.status : "";
  const search = (filters.search ?? "").trim().slice(0, 80);
  const { rows } = await getPool().query<CollaboratorRow>(
    `SELECT ${COLLABORATOR_FIELDS} ${COLLABORATOR_JOINS}
      WHERE u.project_id = $1
        AND ($2 = '' OR u.status = $2)
        AND ($3 = '' OR u.name::text ILIKE '%' || $3 || '%'
             OR coalesce(u.first_name, '') ILIKE '%' || $3 || '%'
             OR coalesce(u.last_name, '') ILIKE '%' || $3 || '%'
             OR coalesce(p.email, '') ILIKE '%' || $3 || '%')
      ORDER BY (u.status = 'pending') DESC, u.name::text
      LIMIT 500`, [project, status, search]);
  return rows;
}

export async function getCollaborator(project: number, id: number): Promise<CollaboratorRow | undefined> {
  const { rows } = await getPool().query<CollaboratorRow>(
    `SELECT ${COLLABORATOR_FIELDS} ${COLLABORATOR_JOINS}
      WHERE u.project_id = $1 AND u.id = $2`, [project, id]);
  return rows[0];
}

export interface CreateCollaboratorInput {
  name: string; firstName: string; lastName?: string | undefined; accessCode: string;
}

export async function createCollaborator(project: number, input: CreateCollaboratorInput): Promise<CollaboratorRow> {
  const name = input.name.trim();
  const first = normalizePersonName(input.firstName);
  const last = normalizePersonName(input.lastName ?? "");
  if (!validUsername(name)) {
    throw new ApiError(400, "invalid_name", `El usuario debe tener entre ${MIN_USER_NAME} y 80 caracteres.`);
  }
  if (!first) throw new ApiError(400, "invalid_first_name", "El nombre es obligatorio.");
  if (!isStrongAccessCode(input.accessCode, name)) {
    throw new ApiError(400, "weak_access_code", "La clave no cumple los requisitos mínimos.");
  }
  let userId: number;
  try {
    userId = await withTransaction(async (client) => {
      const person = await client.query<{ id: number }>(
        "INSERT INTO auth.people (first_name, last_name) VALUES ($1, $2) RETURNING id",
        [first, last || null]);
      const personId = person.rows[0]!.id;
      const user = await client.query<{ id: number }>(
        `INSERT INTO auth.users
           (person_id, project_id, name, first_name, last_name, access_code_hash, status, signup_source)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', 'admin')
         RETURNING id`,
        [personId, project, name, first, last || null, hashAccessCode(input.accessCode)]);
      return user.rows[0]!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, "username_taken", "Ya existe una cuenta con ese nombre de usuario.");
    throw error;
  }
  const created = await getCollaborator(project, userId);
  if (!created) throw new ApiError(500, "collaborator_missing", "La cuenta se creó pero no se pudo leer.");
  return created;
}

const STATUSES = ["pending", "approved", "rejected"] as const;

export async function updateCollaborator(
  project: number, id: number, input: { firstName?: string | undefined; lastName?: string | undefined; status?: string | undefined },
): Promise<CollaboratorRow> {
  const first = input.firstName === undefined ? undefined : normalizePersonName(input.firstName);
  const last = input.lastName === undefined ? undefined : normalizePersonName(input.lastName);
  const status = input.status === undefined ? undefined : input.status;
  if (status !== undefined && !STATUSES.includes(status as typeof STATUSES[number])) {
    throw new ApiError(400, "invalid_status", "Estado de colaborador no válido.");
  }
  if (first !== undefined && !first) throw new ApiError(400, "invalid_first_name", "El nombre no puede quedar vacío.");
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (sql: string, value: unknown) => { assignments.push(sql); values.push(value); };
  if (first !== undefined) set(`first_name = $${values.length + 1}`, first);
  if (last !== undefined) set(`last_name = $${values.length + 1}`, last || null);
  if (status !== undefined) {
    set(`status = $${values.length + 1}`, status);
    // Cualquier cambio de estado invalida las sesiones abiertas: aprobar,
    // rechazar o reactivar no puede dejar viva una sesión anterior.
    assignments.push("session_version = session_version + 1");
  }
  if (assignments.length === 0) throw new ApiError(400, "empty_update", "No hay cambios que guardar.");
  assignments.push("updated_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')");
  values.push(id, project);
  const { rows } = await getPool().query<{ id: number }>(
    `UPDATE auth.users SET ${assignments.join(", ")}
      WHERE id = $${values.length - 1} AND project_id = $${values.length} RETURNING id`, values);
  if (!rows[0]) throw new ApiError(404, "collaborator_not_found", "No existe esa cuenta en el proyecto.");
  if (status !== undefined) await deleteSessionsForUser(id);
  const updated = await getCollaborator(project, id);
  if (!updated) throw new ApiError(404, "collaborator_not_found", "No existe esa cuenta en el proyecto.");
  return updated;
}

export async function setAccessCode(project: number, id: number, accessCode: string): Promise<void> {
  const current = await getCollaborator(project, id);
  if (!current) throw new ApiError(404, "collaborator_not_found", "No existe esa cuenta en el proyecto.");
  if (!isStrongAccessCode(accessCode, current.name)) {
    throw new ApiError(400, "weak_access_code", "La clave no cumple los requisitos mínimos.");
  }
  const { rowCount } = await getPool().query(
    `UPDATE auth.users SET access_code_hash = $1, session_version = session_version + 1,
       updated_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $2 AND project_id = $3`, [hashAccessCode(accessCode), id, project]);
  if (rowCount === 0) throw new ApiError(404, "collaborator_not_found", "No existe esa cuenta en el proyecto.");
  await deleteSessionsForUser(id);
}

/** Revoca el acceso: sube session_version y borra las sesiones ya emitidas. */
export async function revokeCollaborator(project: number, id: number): Promise<void> {
  const { rowCount } = await getPool().query(
    `UPDATE auth.users SET session_version = session_version + 1,
       updated_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $1 AND project_id = $2`, [id, project]);
  if (rowCount === 0) throw new ApiError(404, "collaborator_not_found", "No existe esa cuenta en el proyecto.");
  await deleteSessionsForUser(id);
}

async function deleteSessionsForUser(userId: number): Promise<void> {
  await getPool().query(
    `DELETE FROM auth.sessions
      WHERE audience = 'crv'
        AND payload->'herra'->>'kind' = 'user'
        AND (payload->'herra'->>'id')::int = $1`, [userId]);
}

export async function listAdmins(project: number): Promise<AdminRow[]> {
  const { rows } = await getPool().query<AdminRow>(
    `SELECT a.id, a.username::text AS username, a.role, a.project_id, a.user_id,
            a.session_version, a.created_at, u.name::text AS person_name
       FROM auth.admins a
       LEFT JOIN auth.users u ON u.id = a.user_id
      WHERE a.project_id = $1 OR a.role = 'superadmin'
      ORDER BY a.role, a.username::text`, [project]);
  return rows;
}

export async function adminByUsername(username: string): Promise<{ id: number; role: string } | undefined> {
  const { rows } = await getPool().query<{ id: number; role: string }>(
    "SELECT id, role FROM auth.admins WHERE lower(username::text) = lower($1)", [username]);
  return rows[0];
}

export async function setAdminRole(
  project: number, id: number, role: "admin" | "curator" | "community",
): Promise<AdminRow> {
  if (!["admin", "curator", "community"].includes(role)) {
    throw new ApiError(400, "invalid_role", "Rol no válido.");
  }
  const { rows } = await getPool().query<{ id: number }>(
    `UPDATE auth.admins SET role = $1, session_version = session_version + 1,
       updated_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $2 AND project_id = $3 AND role <> 'superadmin' RETURNING id`, [role, id, project]);
  if (!rows[0]) throw new ApiError(404, "admin_not_found", "No existe ese administrador en el proyecto.");
  const admins = await listAdmins(project);
  const updated = admins.find((admin) => admin.id === id);
  if (!updated) throw new ApiError(404, "admin_not_found", "No existe ese administrador en el proyecto.");
  return updated;
}

export interface FormOption { id: number; type: string; label: string }

export async function formOptions(): Promise<FormOption[]> {
  const { rows } = await getPool().query<FormOption>(
    `SELECT id, type, label FROM auth.catalog_terms
      WHERE archived_at IS NULL AND type IN ('skill', 'contribution_area', 'link_type')
      ORDER BY type, label`);
  return rows;
}

export async function recordAudit(entry: {
  actorType: string; actorId: number; project: number; action: string;
  method: string; path: string; status: number; sourceAddr: string | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO auth.audit_log (actor_type, actor_id, project_id, action, method, path, status, source_addr)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [entry.actorType, entry.actorId, entry.project, entry.action.slice(0, 200),
     entry.method, entry.path.slice(0, 300), entry.status, entry.sourceAddr]);
}

export function roleFromDb(value: string): AccountRole {
  if (value === "curator" || value === "community") return value;
  if (value === "admin" || value === "superadmin") return "admin";
  return "reader";
}

export { MAX_FIELD };
