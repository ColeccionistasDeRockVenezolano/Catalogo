// CRV · Moderación del chat en PostgreSQL.
//
// Cada acción deja una fila en chat.moderation_log dentro de la misma
// transacción que la ejecuta: no hay sanción sin auditoría ni auditoría de
// algo que no ocurrió. `moderator` es la cuenta de CRV que actuó, o
// «detector» / «ia» / «reportes» cuando la acción es automática.
import type { PoolClient } from "pg";
import { getPool } from "../../db/client.js";
import { ChatError } from "../repository.js";

export type ModerationAction =
  | "delete" | "restore" | "mute" | "unmute" | "kick" | "ban" | "unban" | "ip_ban" | "ip_unban"
  | "slow_mode" | "report_resolve" | "auto_mute" | "auto_hide";

export type ReportSource = "user" | "ai" | "detector" | "filter";
export type ReportStatus = "open" | "dismissed" | "actioned";

/** Reportes de usuarios distintos que ocultan un mensaje a la espera de revisión. */
export const AUTO_HIDE_REPORTS = 3;

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface LogEntry {
  action: ModerationAction;
  moderator: string;
  targetActor?: string | null;
  messageId?: number | null;
  ip?: string | null;
  reason?: string;
  details?: Record<string, unknown>;
}

async function log(client: PoolClient, entry: LogEntry): Promise<void> {
  await client.query(
    `INSERT INTO chat.moderation_log (action, moderator, target_actor, message_id, ip, reason, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [entry.action, entry.moderator, entry.targetActor ?? null, entry.messageId ?? null, entry.ip ?? null,
      (entry.reason ?? "").slice(0, 500), JSON.stringify(entry.details ?? {})],
  );
}

export async function logModeration(entry: LogEntry): Promise<void> {
  await inTransaction((client) => log(client, entry));
}

// ── Mensajes ───────────────────────────────────────────────────────────────

export interface MessageRef { id: number; roomId: number; roomSlug: string; actorId: string | null; body: string }

export async function messageRef(id: number): Promise<MessageRef | null> {
  const { rows } = await getPool().query<{ id: string; room_id: number; slug: string; actor_id: string | null; body: string }>(
    `SELECT m.id, m.room_id, r.slug, m.actor_id, m.body FROM chat.messages m
     JOIN chat.rooms r ON r.id = m.room_id WHERE m.id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), roomId: Number(row.room_id), roomSlug: row.slug, actorId: row.actor_id, body: row.body } : null;
}

/** Oculta un mensaje (borrado lógico): sale del historial, queda para la auditoría. */
export async function hideMessage(input: {
  messageId: number; moderator: string; reason: string; action?: "delete" | "auto_hide";
}): Promise<MessageRef> {
  const ref = await messageRef(input.messageId);
  if (!ref) throw new ChatError("message_not_found", "Ese mensaje no existe.", 404);
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE chat.messages SET deleted_at = COALESCE(deleted_at, now()), deleted_by = $2, moderation = 'hidden'
       WHERE id = $1`,
      [input.messageId, input.moderator],
    );
    await log(client, {
      action: input.action ?? "delete", moderator: input.moderator, targetActor: ref.actorId,
      messageId: input.messageId, reason: input.reason,
    });
  });
  return ref;
}

export async function restoreMessage(messageId: number, moderator: string, reason: string): Promise<MessageRef> {
  const ref = await messageRef(messageId);
  if (!ref) throw new ChatError("message_not_found", "Ese mensaje no existe.", 404);
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE chat.messages SET deleted_at = NULL, deleted_by = NULL, moderation = NULL WHERE id = $1`,
      [messageId],
    );
    await log(client, { action: "restore", moderator, targetActor: ref.actorId, messageId, reason });
  });
  return ref;
}

// ── Actores ────────────────────────────────────────────────────────────────

async function assertActor(client: PoolClient, actorId: string): Promise<{ created_ip: string | null; last_ip: string | null }> {
  const { rows } = await client.query<{ created_ip: string | null; last_ip: string | null }>(
    `SELECT created_ip, last_ip FROM chat.actors WHERE id = $1 FOR UPDATE`, [actorId],
  );
  const row = rows[0];
  if (!row) throw new ChatError("actor_not_found", "Ese usuario del chat no existe.", 404);
  return row;
}

export async function muteActor(input: {
  actorId: string; minutes: number; moderator: string; reason: string; automatic?: boolean;
}): Promise<Date> {
  return inTransaction(async (client) => {
    await assertActor(client, input.actorId);
    const { rows } = await client.query<{ muted_until: Date }>(
      `UPDATE chat.actors SET muted_until = GREATEST(COALESCE(muted_until, now()), now() + ($2::int * interval '1 minute'))
       WHERE id = $1 RETURNING muted_until`,
      [input.actorId, input.minutes],
    );
    await log(client, {
      action: input.automatic ? "auto_mute" : "mute", moderator: input.moderator, targetActor: input.actorId,
      reason: input.reason, details: { minutes: input.minutes },
    });
    return rows[0]!.muted_until;
  });
}

export async function unmuteActor(actorId: string, moderator: string, reason: string): Promise<void> {
  await inTransaction(async (client) => {
    await assertActor(client, actorId);
    await client.query(`UPDATE chat.actors SET muted_until = NULL WHERE id = $1`, [actorId]);
    await log(client, { action: "unmute", moderator, targetActor: actorId, reason });
  });
}

export async function logKick(actorId: string, moderator: string, reason: string): Promise<void> {
  await inTransaction(async (client) => {
    await assertActor(client, actorId);
    await log(client, { action: "kick", moderator, targetActor: actorId, reason });
  });
}

/**
 * Banea la cuenta: sube token_version (todos sus tokens dejan de valer) y,
 * si se pide, banea también las IP de creación y de la última conexión.
 */
/**
 * Solo se banean IPs públicas. Loopback, redes privadas y el rango de
 * Tailscale (100.64/10) son las del propio proxy: banear una de ellas
 * dejaría fuera a todo el mundo si una cabecera X-Forwarded-For faltara.
 */
export function isBannableIp(ip: string): boolean {
  const value = ip.trim().toLowerCase().replace(/^::ffff:/u, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(value);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  if (value.includes(":")) return !(value === "::1" || value === "::" || /^f[cd]/u.test(value) || /^fe[89ab]/u.test(value));
  return false;
}

export async function banActor(input: {
  actorId: string; moderator: string; reason: string; banIp: boolean; days?: number | null;
}): Promise<{ ips: string[] }> {
  return inTransaction(async (client) => {
    const actor = await assertActor(client, input.actorId);
    await client.query(
      `UPDATE chat.actors SET banned_at = now(), ban_reason = $2, token_version = token_version + 1
       WHERE id = $1`,
      [input.actorId, input.reason.slice(0, 500)],
    );
    await log(client, { action: "ban", moderator: input.moderator, targetActor: input.actorId, reason: input.reason });
    const ips = input.banIp ? [...new Set([actor.created_ip, actor.last_ip].filter((ip): ip is string => typeof ip === "string" && isBannableIp(ip)))] : [];
    for (const ip of ips) {
      await client.query(
        `INSERT INTO chat.ip_bans (ip, reason, actor_id, created_by, expires_at)
         VALUES ($1,$2,$3,$4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5::int * interval '1 day') END)
         ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, actor_id = EXCLUDED.actor_id,
           created_by = EXCLUDED.created_by, created_at = now(), expires_at = EXCLUDED.expires_at`,
        [ip, input.reason.slice(0, 500), input.actorId, input.moderator, input.days ?? null],
      );
      await log(client, { action: "ip_ban", moderator: input.moderator, targetActor: input.actorId, ip, reason: input.reason });
    }
    return { ips };
  });
}

export async function unbanActor(actorId: string, moderator: string, reason: string): Promise<void> {
  await inTransaction(async (client) => {
    await assertActor(client, actorId);
    await client.query(`UPDATE chat.actors SET banned_at = NULL, ban_reason = NULL WHERE id = $1`, [actorId]);
    const { rows } = await client.query<{ ip: string }>(`DELETE FROM chat.ip_bans WHERE actor_id = $1 RETURNING ip`, [actorId]);
    await log(client, { action: "unban", moderator, targetActor: actorId, reason, details: { ips: rows.map((row) => row.ip) } });
  });
}

export async function unbanIp(ip: string, moderator: string, reason: string): Promise<boolean> {
  return inTransaction(async (client) => {
    const { rowCount } = await client.query(`DELETE FROM chat.ip_bans WHERE ip = $1`, [ip]);
    if (rowCount) await log(client, { action: "ip_unban", moderator, ip, reason });
    return Boolean(rowCount);
  });
}

export async function setSlowMode(slug: string, seconds: number, moderator: string): Promise<void> {
  await inTransaction(async (client) => {
    const { rowCount } = await client.query(`UPDATE chat.rooms SET slow_mode_seconds = $2 WHERE slug = $1`, [slug, seconds]);
    if (!rowCount) throw new ChatError("room_not_found", "Esa sala no existe.", 404);
    await log(client, { action: "slow_mode", moderator, reason: "", details: { room: slug, seconds } });
  });
}

// ── Reportes ───────────────────────────────────────────────────────────────

export interface ReportInput {
  source: ReportSource;
  messageId?: number | null;
  targetActor?: string | null;
  reporter?: string | null;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * Crea un reporte. Un usuario reporta un mensaje una sola vez (índice
 * único); devuelve cuántos usuarios distintos lo han reportado ya.
 */
export async function createReport(input: ReportInput): Promise<{ id: number | null; created: boolean; userReports: number }> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO chat.reports (source, message_id, target_actor, reporter, reason, details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT DO NOTHING RETURNING id`,
    [input.source, input.messageId ?? null, input.targetActor ?? null, input.reporter ?? null,
      input.reason.slice(0, 500), JSON.stringify(input.details ?? {})],
  );
  let userReports = 0;
  if (input.messageId) {
    const { rows: counted } = await getPool().query<{ n: string }>(
      `SELECT count(DISTINCT reporter)::text AS n FROM chat.reports WHERE message_id = $1 AND source = 'user'`,
      [input.messageId],
    );
    userReports = Number(counted[0]?.n ?? 0);
  }
  const id = rows[0]?.id;
  return { id: id ? Number(id) : null, created: Boolean(id), userReports };
}

export interface ReportView {
  id: number; source: ReportSource; status: ReportStatus; reason: string; details: Record<string, unknown>;
  createdAt: string; resolvedAt: string | null; resolvedBy: string | null;
  message: { id: number; body: string; createdAt: string; hidden: boolean; moderation: string | null } | null;
  target: ActorSummary | null;
  reporter: { id: string; displayName: string } | null;
  reports: number;
}

export interface ActorSummary {
  id: string; handle: string; displayName: string; kind: string; createdAt: string;
  mutedUntil: string | null; bannedAt: string | null; lastIp: string | null; createdIp: string | null;
  messages: number;
}

/** Cola de revisión: abiertos primero, agrupando los reportes de un mismo mensaje. */
export async function listReports(status: ReportStatus | "all", limit = 100): Promise<ReportView[]> {
  const { rows } = await getPool().query<{
    id: string; source: ReportSource; status: ReportStatus; reason: string; details: Record<string, unknown>;
    created_at: Date; resolved_at: Date | null; resolved_by: string | null;
    message_id: string | null; body: string | null; message_at: Date | null; deleted_at: Date | null; moderation: string | null;
    target_id: string | null; target_handle: string | null; target_name: string | null; target_kind: string | null;
    target_created: Date | null; muted_until: Date | null; banned_at: Date | null; last_ip: string | null; created_ip: string | null;
    target_messages: string | null; reporter_id: string | null; reporter_name: string | null; reports: string;
  }>(
    `SELECT r.id, r.source, r.status, r.reason, r.details, r.created_at, r.resolved_at, r.resolved_by,
            m.id AS message_id, m.body, m.created_at AS message_at, m.deleted_at, m.moderation,
            t.id AS target_id, t.handle AS target_handle, t.display_name AS target_name, t.kind AS target_kind,
            t.created_at AS target_created, t.muted_until, t.banned_at, t.last_ip, t.created_ip,
            (SELECT count(*) FROM chat.messages x WHERE x.actor_id = t.id)::text AS target_messages,
            p.id AS reporter_id, p.display_name AS reporter_name,
            (SELECT count(*) FROM chat.reports y WHERE y.message_id = r.message_id AND r.message_id IS NOT NULL)::text AS reports
     FROM chat.reports r
     LEFT JOIN chat.messages m ON m.id = r.message_id
     LEFT JOIN chat.actors t ON t.id = COALESCE(r.target_actor, m.actor_id)
     LEFT JOIN chat.actors p ON p.id = r.reporter
     WHERE ($1 = 'all' OR r.status = $1)
     ORDER BY (r.status = 'open') DESC, r.created_at DESC
     LIMIT $2`,
    [status, Math.min(Math.max(limit, 1), 500)],
  );
  return rows.map((row) => ({
    id: Number(row.id), source: row.source, status: row.status, reason: row.reason, details: row.details,
    createdAt: row.created_at.toISOString(), resolvedAt: row.resolved_at?.toISOString() ?? null, resolvedBy: row.resolved_by,
    message: row.message_id ? {
      id: Number(row.message_id), body: row.body ?? "", createdAt: row.message_at?.toISOString() ?? "",
      hidden: row.deleted_at !== null, moderation: row.moderation,
    } : null,
    target: row.target_id ? {
      id: row.target_id, handle: row.target_handle ?? "", displayName: row.target_name ?? "", kind: row.target_kind ?? "guest",
      createdAt: row.target_created?.toISOString() ?? "", mutedUntil: row.muted_until?.toISOString() ?? null,
      bannedAt: row.banned_at?.toISOString() ?? null, lastIp: row.last_ip, createdIp: row.created_ip,
      messages: Number(row.target_messages ?? 0),
    } : null,
    reporter: row.reporter_id ? { id: row.reporter_id, displayName: row.reporter_name ?? "" } : null,
    reports: Number(row.reports ?? 0),
  }));
}

/** Cierra un reporte y los demás abiertos del mismo mensaje. */
export async function resolveReport(id: number, status: "dismissed" | "actioned", moderator: string, reason: string): Promise<number> {
  return inTransaction(async (client) => {
    const { rows } = await client.query<{ message_id: string | null; target_actor: string | null }>(
      `SELECT message_id, target_actor FROM chat.reports WHERE id = $1 FOR UPDATE`, [id],
    );
    const report = rows[0];
    if (!report) throw new ChatError("report_not_found", "Ese reporte no existe.", 404);
    const { rowCount } = await client.query(
      `UPDATE chat.reports SET status = $2, resolved_at = now(), resolved_by = $3
       WHERE status = 'open' AND (id = $1 OR ($4::bigint IS NOT NULL AND message_id = $4))`,
      [id, status, moderator, report.message_id],
    );
    await log(client, {
      action: "report_resolve", moderator, targetActor: report.target_actor,
      messageId: report.message_id ? Number(report.message_id) : null, reason, details: { report: id, status },
    });
    return rowCount ?? 0;
  });
}

export interface LogView {
  id: number; action: ModerationAction; moderator: string; targetActor: string | null; targetName: string | null;
  messageId: number | null; ip: string | null; reason: string; details: Record<string, unknown>; createdAt: string;
}

export async function listModerationLog(limit = 100): Promise<LogView[]> {
  const { rows } = await getPool().query<{
    id: string; action: ModerationAction; moderator: string; target_actor: string | null; display_name: string | null;
    message_id: string | null; ip: string | null; reason: string; details: Record<string, unknown>; created_at: Date;
  }>(
    `SELECT l.id, l.action, l.moderator, l.target_actor, a.display_name, l.message_id, l.ip, l.reason, l.details, l.created_at
     FROM chat.moderation_log l LEFT JOIN chat.actors a ON a.id = l.target_actor
     ORDER BY l.id DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows.map((row) => ({
    id: Number(row.id), action: row.action, moderator: row.moderator, targetActor: row.target_actor,
    targetName: row.display_name, messageId: row.message_id ? Number(row.message_id) : null, ip: row.ip,
    reason: row.reason, details: row.details, createdAt: row.created_at.toISOString(),
  }));
}

// ── Limpieza de invitados vacíos ───────────────────────────────────────────

/**
 * Borra invitados sin rastro: sin mensajes, sin compras ni más movimientos
 * que la bienvenida, sin inventario, sin reclamar, sin sanción y sin visitar
 * en `days` días. Los bots de un ataque que nunca llegaron a escribir
 * desaparecen solos; nadie con historia se toca.
 */
export async function cleanupEmptyGuests(days = 7, batch = 1000): Promise<number> {
  const { rowCount } = await getPool().query(
    `DELETE FROM chat.actors a
     WHERE a.id IN (
       SELECT a2.id FROM chat.actors a2
       WHERE a2.kind = 'guest' AND a2.claimed_user_id IS NULL AND a2.banned_at IS NULL
         AND a2.last_seen_at < now() - ($1::int * interval '1 day')
         AND NOT EXISTS (SELECT 1 FROM chat.messages m WHERE m.actor_id = a2.id)
         AND NOT EXISTS (SELECT 1 FROM chat.effect_inventory i WHERE i.actor_id = a2.id)
         AND NOT EXISTS (SELECT 1 FROM chat.ledger l WHERE l.actor_id = a2.id
                         AND NOT (l.reason = 'grant' AND l.ref = 'bienvenida'))
         AND NOT EXISTS (SELECT 1 FROM chat.reports r WHERE r.target_actor = a2.id OR r.reporter = a2.id)
         AND NOT EXISTS (SELECT 1 FROM chat.moderation_log g WHERE g.target_actor = a2.id)
       ORDER BY a2.last_seen_at
       LIMIT $2
     )`,
    [days, batch],
  );
  return rowCount ?? 0;
}

// ── Cola de la clasificación con IA ────────────────────────────────────────

export interface PendingMessage { id: number; roomSlug: string; actorId: string | null; displayName: string | null; body: string }

/** Mensajes de chat de la última hora aún sin revisar por la IA. */
export async function pendingAiMessages(limit = 25): Promise<PendingMessage[]> {
  const { rows } = await getPool().query<{ id: string; slug: string; actor_id: string | null; display_name: string | null; body: string }>(
    `SELECT m.id, r.slug, m.actor_id, a.display_name, m.body
     FROM chat.messages m JOIN chat.rooms r ON r.id = m.room_id LEFT JOIN chat.actors a ON a.id = m.actor_id
     WHERE m.ai_checked_at IS NULL AND m.kind = 'chat' AND m.deleted_at IS NULL
       AND m.created_at > now() - interval '1 hour'
     ORDER BY m.id LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: Number(row.id), roomSlug: row.slug, actorId: row.actor_id, displayName: row.display_name, body: row.body,
  }));
}

export async function markAiChecked(ids: number[], review: number[] = []): Promise<void> {
  if (ids.length === 0) return;
  await getPool().query(
    `UPDATE chat.messages SET ai_checked_at = now(),
       moderation = CASE WHEN id = ANY($2::bigint[]) AND moderation IS DISTINCT FROM 'hidden' THEN 'review' ELSE moderation END
     WHERE id = ANY($1::bigint[])`,
    [ids, review],
  );
}
