// CRV · Invitaciones y activaciones (Fase 1).
//
// Invitación: enlace multiuso y revocable para auto-registro; la cuenta nace
// PENDIENTE y un administrador la aprueba. Activación: enlace de un solo uso
// atado a una colaboración ya creada (aceptar una candidatura); la persona
// elige usuario y clave al abrirlo.
import { getPool } from "../../db/client.js";
import { ApiError } from "../http-errors.js";
import {
  hashAccessCode, hashToken, newToken, isStrongAccessCode, validUsername,
  normalizePersonName, ACTIVATION_TTL_DAYS, INVITE_TTL_MINUTES, MAX_REGISTRATIONS_PER_DAY,
} from "./validation.js";
import { withTransaction, isUniqueViolation, usernameTakenByAdmin } from "./store.js";

const UTC_NOW = "to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')";
const UTC_EXPIRY_DAYS = (placeholder: string) =>
  `to_char(timezone('UTC', statement_timestamp()) + (${placeholder} || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS')`;

export interface ActivationInfo {
  id: number; user_id: number; first_name: string | null; last_name: string | null; name: string;
  expires_at: string;
}

async function validActivation(project: number, token: string, forUpdate = false): Promise<ActivationInfo> {
  if (!token || token.length > 200) throw new ApiError(404, "activation_not_found", "El enlace de activación no es válido.");
  const { rows } = await getPool().query<ActivationInfo>(
    `SELECT at.id, at.user_id, u.first_name, u.last_name, u.name::text AS name, at.expires_at
       FROM auth.activation_tokens at
       JOIN auth.users u ON u.id = at.user_id
      WHERE at.token_hash = $1 AND at.project_id = $2
        AND at.used_at IS NULL AND at.revoked_at IS NULL
        AND at.expires_at > ${UTC_NOW}
        AND u.status = 'approved'
      ${forUpdate ? "FOR UPDATE OF at" : ""}`, [hashToken(token), project]);
  const row = rows[0];
  if (!row) throw new ApiError(404, "activation_not_found", "El enlace de activación no es válido o ya expiró.");
  return row;
}

export async function activationInfo(project: number, token: string): Promise<ActivationInfo> {
  return validActivation(project, token);
}

export async function createActivation(
  project: number, userId: number, createdBy: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const { rows } = await getPool().query<{ expires_at: string }>(
    `WITH revoked AS (
       UPDATE auth.activation_tokens SET revoked_at = ${UTC_NOW}
        WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL
     )
     INSERT INTO auth.activation_tokens (project_id, user_id, token_hash, expires_at, created_by)
     VALUES ($2, $1, $3, ${UTC_EXPIRY_DAYS("$4")}, $5)
     RETURNING expires_at`,
    [userId, project, hashToken(token), String(ACTIVATION_TTL_DAYS), createdBy]);
  return { token, expiresAt: rows[0]!.expires_at };
}

export interface ActivationListRow {
  id: number; user_id: number; name: string; first_name: string | null; last_name: string | null;
  created_at: string; expires_at: string; created_by: string;
}

export async function listActivations(project: number): Promise<ActivationListRow[]> {
  const { rows } = await getPool().query<ActivationListRow>(
    `SELECT at.id, at.user_id, u.name::text AS name, u.first_name, u.last_name,
            at.created_at, at.expires_at, at.created_by
       FROM auth.activation_tokens at
       JOIN auth.users u ON u.id = at.user_id
      WHERE at.project_id = $1 AND at.used_at IS NULL AND at.revoked_at IS NULL
        AND at.expires_at > ${UTC_NOW}
      ORDER BY at.created_at DESC`, [project]);
  return rows;
}

export async function revokeActivation(project: number, id: number): Promise<void> {
  const { rowCount } = await getPool().query(
    `UPDATE auth.activation_tokens SET revoked_at = ${UTC_NOW}
      WHERE id = $1 AND project_id = $2 AND used_at IS NULL AND revoked_at IS NULL`, [id, project]);
  if (rowCount === 0) throw new ApiError(404, "activation_not_found", "El enlace ya no existe o fue usado.");
}

export async function activateUser(
  project: number, token: string, name: string, accessCode: string,
): Promise<{ id: number; name: string }> {
  const username = name.trim();
  if (!validUsername(username)) throw new ApiError(400, "invalid_name", "El nombre de usuario no es válido.");
  if (!isStrongAccessCode(accessCode, username)) {
    throw new ApiError(400, "weak_access_code", "La clave no cumple los requisitos mínimos.");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query<ActivationInfo>(
      `SELECT at.id, at.user_id, u.first_name, u.last_name, u.name::text AS name, at.expires_at
         FROM auth.activation_tokens at
         JOIN auth.users u ON u.id = at.user_id
        WHERE at.token_hash = $1 AND at.project_id = $2
          AND at.used_at IS NULL AND at.revoked_at IS NULL
          AND at.expires_at > ${UTC_NOW} AND u.status = 'approved'
        FOR UPDATE OF at`, [hashToken(token), project]);
    const activation = rows[0];
    if (!activation) throw new ApiError(404, "activation_not_found", "El enlace de activación no es válido o ya expiró.");
    if (await usernameTakenByAdmin(username, client)) {
      throw new ApiError(409, "username_taken", "Ese nombre de usuario pertenece a una cuenta administradora.");
    }
    try {
      await client.query(
        `UPDATE auth.users SET name = $1, access_code_hash = $2,
                session_version = session_version + 1,
                updated_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')
          WHERE id = $3 AND project_id = $4`,
        [username, hashAccessCode(accessCode), activation.user_id, project]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, "username_taken", "Ese nombre de usuario ya está en uso.");
      throw error;
    }
    await client.query(`UPDATE auth.activation_tokens SET used_at = ${UTC_NOW} WHERE id = $1`, [activation.id]);
    return { id: activation.user_id, name: username };
  });
}

// ---------------------------------------------------------------------------
// Invitaciones (registro multiuso)
// ---------------------------------------------------------------------------

export interface InviteRow {
  id: number; created_at: string; expires_at: string; created_by: string; use_count: number;
}

export async function createInvite(project: number, createdBy: string): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const { rows } = await getPool().query<{ expires_at: string }>(
    `INSERT INTO auth.registration_tokens (project_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, to_char(timezone('UTC', statement_timestamp()) + ($3 || ' minutes')::interval,
                            'YYYY-MM-DD HH24:MI:SS'), $4)
     RETURNING expires_at`, [project, hashToken(token), String(INVITE_TTL_MINUTES), createdBy]);
  return { token, expiresAt: rows[0]!.expires_at };
}

export async function listInvites(project: number): Promise<InviteRow[]> {
  const { rows } = await getPool().query<InviteRow>(
    `SELECT id, created_at, expires_at, created_by, use_count
       FROM auth.registration_tokens
      WHERE project_id = $1 AND revoked_at IS NULL AND expires_at > ${UTC_NOW}
      ORDER BY created_at DESC`, [project]);
  return rows;
}

export async function revokeInvite(project: number, id: number): Promise<void> {
  const { rowCount } = await getPool().query(
    `UPDATE auth.registration_tokens SET revoked_at = ${UTC_NOW}
      WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL`, [id, project]);
  if (rowCount === 0) throw new ApiError(404, "invite_not_found", "La invitación ya no existe.");
}

export async function inviteInfo(project: number, token: string): Promise<{ valid: boolean; expiresAt: string | null }> {
  if (!token) return { valid: false, expiresAt: null };
  const { rows } = await getPool().query<{ expires_at: string }>(
    `SELECT expires_at FROM auth.registration_tokens
      WHERE token_hash = $1 AND project_id = $2 AND revoked_at IS NULL AND expires_at > ${UTC_NOW}`,
    [hashToken(token), project]);
  return rows[0] ? { valid: true, expiresAt: rows[0].expires_at } : { valid: false, expiresAt: null };
}

export async function registerWithInvite(
  project: number, token: string, input: { name: string; firstName: string; lastName: string; accessCode: string },
  _sourceAddr: string | null,
): Promise<{ id: number; name: string }> {
  const username = input.name.trim();
  const firstName = normalizePersonName(input.firstName);
  const lastName = normalizePersonName(input.lastName);
  if (!firstName || !lastName) throw new ApiError(400, "invalid_person_name", "Nombre y apellido son obligatorios.");
  if (!validUsername(username)) throw new ApiError(400, "invalid_name", "El nombre de usuario no es válido.");
  if (!isStrongAccessCode(input.accessCode, username)) {
    throw new ApiError(400, "weak_access_code", "La clave no cumple los requisitos mínimos.");
  }
  return withTransaction(async (client) => {
    const invite = await client.query<{ id: number }>(
      `SELECT id FROM auth.registration_tokens
        WHERE token_hash = $1 AND project_id = $2 AND revoked_at IS NULL AND expires_at > ${UTC_NOW}
        FOR UPDATE`, [hashToken(token), project]);
    if (!invite.rows[0]) throw new ApiError(404, "invite_invalid", "La invitación no es válida o expiró.");
    const today = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth.users
        WHERE project_id = $1 AND signup_source = 'self'
          AND left(created_at, 10) = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD')`, [project]);
    if (today.rows[0]!.n >= MAX_REGISTRATIONS_PER_DAY) {
      throw new ApiError(429, "registration_limit", "Se alcanzó el límite diario de registros. Inténtalo mañana.");
    }
    if (await usernameTakenByAdmin(username, client)) {
      throw new ApiError(409, "username_taken", "Ese nombre de usuario pertenece a una cuenta administradora.");
    }
    const person = await client.query<{ id: number }>(
      "INSERT INTO auth.people (first_name, last_name) VALUES ($1, $2) RETURNING id", [firstName, lastName]);
    let userId: number;
    try {
      const user = await client.query<{ id: number }>(
        `INSERT INTO auth.users
           (person_id, project_id, name, first_name, last_name, access_code_hash, status, signup_source)
         VALUES ($1,$2,$3,$4,$5,$6,'pending','self') RETURNING id`,
        [person.rows[0]!.id, project, username, firstName, lastName, hashAccessCode(input.accessCode)]);
      userId = user.rows[0]!.id;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, "username_taken", "Ese nombre de usuario ya está en uso.");
      throw error;
    }
    await client.query(
      "UPDATE auth.registration_tokens SET use_count = use_count + 1 WHERE id = $1", [invite.rows[0].id]);
    return { id: userId, name: username };
  });
}
