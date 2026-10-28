// CRV · Repositorio del chat (PostgreSQL).
//
// Todo el SQL del chat vive aquí: las rutas y el WebSocket no escriben SQL.
// Los saldos se mueven siempre dentro de una transacción y con una entrada en
// el libro mayor; el inventario y las compras son idempotentes.
import { getPool } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { dailyDate, dailyIndex } from "../shared/daily-cycle.js";
import { EFFECT_CATALOG, isEquippable, type EffectKind } from "./effects-catalog.js";
import type { ChatEffect, ChatMessage, ChatRoom, Equipped, Wallet } from "./protocol.js";

export class ChatError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ChatError";
  }
}

const EMPTY_EQUIPPED: Equipped = { name: null, frame: null, background: null, ambient: null };
const EQUIPPED_SLOTS = ["name", "frame", "background", "ambient"] as const;
type EquippedSlot = typeof EQUIPPED_SLOTS[number];

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** Normaliza un apodo a handle válido (3-24, letras/números/._-). */
export function toHandle(value: string): string {
  const base = value
    .normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").replace(/^[-.]+|[-.]+$/gu, "");
  const trimmed = base.slice(0, 20);
  return trimmed.length >= 3 ? trimmed : `oyente-${Math.random().toString(36).slice(2, 8)}`;
}

export function equippedFromRows(rows: Array<{ slot: string; code: string }>): Equipped {
  const out: Equipped = { ...EMPTY_EQUIPPED };
  for (const row of rows) {
    if ((EQUIPPED_SLOTS as readonly string[]).includes(row.slot)) {
      out[row.slot as EquippedSlot] = row.code;
    }
  }
  return out;
}

// ── Catálogo ───────────────────────────────────────────────────────────────

/**
 * Sincroniza chat.effects con el catálogo del código. Es idempotente y corre
 * al arrancar el plugin: añadir un efecto es editar effects-catalog.ts, no
 * escribir SQL a mano. No borra efectos retirados (los inventarios viejos
 * conservan su referencia) — se desactivan con enabled=false.
 */
export async function syncEffectCatalog(): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const item of EFFECT_CATALOG) {
      await client.query(
        `INSERT INTO chat.effects
           (code, name, kind, description, manifest, price_coins, price_credits, duration_days, sort, enabled)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,true)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name, kind = EXCLUDED.kind, description = EXCLUDED.description,
           manifest = EXCLUDED.manifest, price_coins = EXCLUDED.price_coins,
           price_credits = EXCLUDED.price_credits, duration_days = EXCLUDED.duration_days,
           sort = EXCLUDED.sort, enabled = true, updated_at = now()`,
        [item.code, item.name, item.kind, item.description, JSON.stringify(item.manifest),
          item.priceCoins, item.priceCredits, item.durationDays, item.sort],
      );
    }
    // Un efecto retirado del código deja de venderse, pero su inventario
    // sigue vivo para quien ya lo compró (la fila no se borra).
    await client.query(
      `UPDATE chat.effects SET enabled = false, updated_at = now()
       WHERE enabled = true AND NOT (code = ANY($1::text[]))`,
      [EFFECT_CATALOG.map((item) => item.code)],
    );
    await client.query("COMMIT");
    return EFFECT_CATALOG.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Salas ──────────────────────────────────────────────────────────────────

interface RoomRow { id: number; slug: string; name: string; description: string; theme: Record<string, unknown> }

function toRoom(row: RoomRow): ChatRoom {
  return { id: asNumber(row.id), slug: row.slug, name: row.name, description: row.description, theme: row.theme };
}

export async function listRooms(): Promise<ChatRoom[]> {
  const { rows } = await getPool().query<RoomRow>(
    `SELECT id, slug, name, description, theme FROM chat.rooms
     WHERE archived_at IS NULL ORDER BY id`,
  );
  return rows.map(toRoom);
}

export async function roomBySlug(slug: string): Promise<ChatRoom | null> {
  const { rows } = await getPool().query<RoomRow>(
    `SELECT id, slug, name, description, theme FROM chat.rooms
     WHERE slug = $1 AND archived_at IS NULL`,
    [slug],
  );
  const row = rows[0];
  return row ? toRoom(row) : null;
}

// ── Actores ────────────────────────────────────────────────────────────────

interface ActorRow {
  id: string; kind: string; handle: string; display_name: string; avatar_seed: string;
  claimed_user_id: string | null; is_bot: boolean;
}

export interface Actor {
  id: string; kind: string; handle: string; displayName: string; avatarSeed: string;
  claimedUserId: string | null; isBot: boolean;
}

function toActor(row: ActorRow): Actor {
  return {
    id: row.id, kind: row.kind, handle: row.handle, displayName: row.display_name,
    avatarSeed: row.avatar_seed, claimedUserId: row.claimed_user_id, isBot: row.is_bot,
  };
}

export async function actorById(id: string): Promise<Actor | null> {
  const { rows } = await getPool().query<ActorRow>(
    `SELECT id, kind, handle, display_name, avatar_seed, claimed_user_id, is_bot
     FROM chat.actors WHERE id = $1`, [id],
  );
  const row = rows[0];
  return row ? toActor(row) : null;
}

export async function actorByHandle(handle: string): Promise<Actor | null> {
  const { rows } = await getPool().query<ActorRow>(
    `SELECT id, kind, handle, display_name, avatar_seed, claimed_user_id, is_bot
     FROM chat.actors WHERE lower(handle) = lower($1)`, [handle],
  );
  const row = rows[0];
  return row ? toActor(row) : null;
}

/**
 * Crea un actor invitado con saldo de bienvenida. Si el handle pedido está
 * ocupado prueba sufijos; nunca falla por colisión.
 */
export async function createGuestActor(displayName: string): Promise<Actor> {
  const cleanName = displayName.trim().slice(0, 40) || "Oyente";
  const base = toHandle(cleanName);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let actor: ActorRow | undefined;
    for (let attempt = 0; attempt < 40 && !actor; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const handle = `${base.slice(0, 24 - suffix.length)}${suffix}`;
      const { rows } = await client.query<ActorRow>(
        `INSERT INTO chat.actors (kind, handle, display_name, avatar_seed)
         VALUES ('guest', $1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id, kind, handle, display_name, avatar_seed, claimed_user_id, is_bot`,
        [handle, cleanName, base],
      );
      actor = rows[0];
    }
    if (!actor) throw new ChatError("handle_unavailable", "No se pudo asignar un apodo; prueba otro.", 409);

    const welcome = getEnv().CRV_CHAT_GUEST_COINS;
    await client.query(`INSERT INTO chat.accounts (actor_id, coins, credits) VALUES ($1, $2, 0)`, [actor.id, welcome]);
    if (welcome > 0) {
      await client.query(
        `INSERT INTO chat.ledger (actor_id, delta_coins, delta_credits, reason, ref, idempotency_key)
         VALUES ($1, $2, 0, 'grant', 'bienvenida', $3)`,
        [actor.id, welcome, `welcome:${actor.id}`],
      );
    }
    await client.query("COMMIT");
    return toActor(actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Cambia el apodo visible del actor (el handle estable no se toca). */
export async function updateDisplayName(actorId: string, displayName: string): Promise<Actor> {
  const clean = displayName.trim().slice(0, 40);
  if (clean.length < 2) throw new ChatError("name_too_short", "El apodo necesita al menos 2 caracteres.", 400);
  const { rows } = await getPool().query<ActorRow>(
    `UPDATE chat.actors SET display_name = $2 WHERE id = $1
     RETURNING id, kind, handle, display_name, avatar_seed, claimed_user_id, is_bot`,
    [actorId, clean],
  );
  const row = rows[0];
  if (!row) throw new ChatError("actor_missing", "Tu sesión de chat ya no existe.", 401);
  return toActor(row);
}

/** Reclama un actor para una cuenta de CRV (cuando exista el registro). */
export async function claimActor(actorId: string, userId: string): Promise<Actor> {
  const { rows } = await getPool().query<ActorRow>(
    `UPDATE chat.actors SET claimed_user_id = $2, kind = 'member'
     WHERE id = $1 AND (claimed_user_id IS NULL OR claimed_user_id = $2)
     RETURNING id, kind, handle, display_name, avatar_seed, claimed_user_id, is_bot`,
    [actorId, userId],
  );
  const row = rows[0];
  if (!row) throw new ChatError("already_claimed", "Ese actor ya pertenece a otra cuenta.", 409);
  return toActor(row);
}

// ── Inventario y equipado ──────────────────────────────────────────────────

export async function equippedFor(actorId: string): Promise<Equipped> {
  const { rows } = await getPool().query<{ slot: string; code: string }>(
    `SELECT q.slot, e.code FROM chat.equipped q JOIN chat.effects e ON e.id = q.effect_id
     WHERE q.actor_id = $1`, [actorId],
  );
  return equippedFromRows(rows);
}

async function equippedForMany(actorIds: string[]): Promise<Map<string, Equipped>> {
  const out = new Map<string, Equipped>();
  if (actorIds.length === 0) return out;
  const { rows } = await getPool().query<{ actor_id: string; slot: string; code: string }>(
    `SELECT q.actor_id, q.slot, e.code FROM chat.equipped q
     JOIN chat.effects e ON e.id = q.effect_id WHERE q.actor_id = ANY($1::uuid[])`,
    [actorIds],
  );
  for (const row of rows) {
    const current = out.get(row.actor_id) ?? { ...EMPTY_EQUIPPED };
    if ((EQUIPPED_SLOTS as readonly string[]).includes(row.slot)) current[row.slot as EquippedSlot] = row.code;
    out.set(row.actor_id, current);
  }
  return out;
}

export interface OwnedEffect { code: string; expiresAt: string | null }

/** ¿El actor tiene ese efecto vigente? Lo usan los efectos de mensaje. */
export async function ownsEffect(actorId: string, code: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM chat.effect_inventory i JOIN chat.effects e ON e.id = i.effect_id
     WHERE i.actor_id = $1 AND e.code = $2 AND e.enabled = true
       AND (i.expires_at IS NULL OR i.expires_at > now()) LIMIT 1`,
    [actorId, code],
  );
  return rows.length > 0;
}

export async function inventoryFor(actorId: string): Promise<OwnedEffect[]> {
  const { rows } = await getPool().query<{ code: string; expires_at: Date | null }>(
    `SELECT e.code, i.expires_at FROM chat.effect_inventory i
     JOIN chat.effects e ON e.id = i.effect_id
     WHERE i.actor_id = $1 AND (i.expires_at IS NULL OR i.expires_at > now())
     ORDER BY e.kind, e.sort`,
    [actorId],
  );
  return rows.map((row) => ({ code: row.code, expiresAt: row.expires_at ? row.expires_at.toISOString() : null }));
}

interface EffectRow {
  id: number; code: string; name: string; kind: string; description: string;
  manifest: Record<string, unknown>; price_coins: number; price_credits: number;
  duration_days: number | null; sort: number; enabled: boolean;
}

function toChatEffect(row: EffectRow, ownedCodes: Set<string>, equipped: Equipped): ChatEffect {
  return {
    code: row.code, name: row.name, kind: row.kind as ChatEffect["kind"], description: row.description,
    manifest: row.manifest,
    priceCoins: asNumber(row.price_coins), priceCredits: asNumber(row.price_credits),
    durationDays: row.duration_days === null ? null : asNumber(row.duration_days), sort: asNumber(row.sort),
    owned: ownedCodes.has(row.code),
    equipped: Object.values(equipped).includes(row.code),
  };
}

/**
 * Catálogo servido al cliente. Se lee de la base (no del array del código)
 * para que el editor de administración pueda publicar efectos nuevos sin
 * desplegar: chat.effects es la fuente de verdad en runtime.
 */
export async function effectsFor(actorId: string): Promise<ChatEffect[]> {
  const [owned, equipped, { rows }] = await Promise.all([
    inventoryFor(actorId),
    equippedFor(actorId),
    getPool().query<EffectRow>(
      `SELECT id, code, name, kind, description, manifest, price_coins, price_credits,
              duration_days, sort, enabled
       FROM chat.effects WHERE enabled = true ORDER BY kind, sort, id`,
    ),
  ]);
  const ownedCodes = new Set(owned.map((item) => item.code));
  return rows.map((row) => toChatEffect(row, ownedCodes, equipped));
}

/** Publica o actualiza un efecto desde el editor de administración. */
export async function upsertEffect(input: {
  code: string; name: string; kind: string; description: string;
  manifest: Record<string, unknown>; priceCoins: number; priceCredits: number;
  durationDays: number | null; sort: number; enabled: boolean;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO chat.effects
       (code, name, kind, description, manifest, price_coins, price_credits, duration_days, sort, enabled)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, kind = EXCLUDED.kind, description = EXCLUDED.description,
       manifest = EXCLUDED.manifest, price_coins = EXCLUDED.price_coins,
       price_credits = EXCLUDED.price_credits, duration_days = EXCLUDED.duration_days,
       sort = EXCLUDED.sort, enabled = EXCLUDED.enabled, updated_at = now()`,
    [input.code, input.name, input.kind, input.description, JSON.stringify(input.manifest),
      input.priceCoins, input.priceCredits, input.durationDays, input.sort, input.enabled],
  );
}

// ── Mensajes ───────────────────────────────────────────────────────────────

interface MessageRow {
  id: string; room_id: number; actor_id: string | null; body: string; kind: string;
  effect_code: string | null; created_at: Date; handle: string | null;
  display_name: string | null; avatar_seed: string | null;
}

export async function listMessages(roomId: number, limit = 50, beforeId?: number): Promise<ChatMessage[]> {
  const { rows } = await getPool().query<MessageRow>(
    `SELECT m.id, m.room_id, m.actor_id, m.body, m.kind, m.effect_code, m.created_at,
            a.handle, a.display_name, a.avatar_seed
     FROM chat.messages m LEFT JOIN chat.actors a ON a.id = m.actor_id
     WHERE m.room_id = $1 AND m.deleted_at IS NULL
       AND ($2::bigint IS NULL OR m.id < $2)
     ORDER BY m.id DESC LIMIT $3`,
    [roomId, beforeId ?? null, Math.min(Math.max(limit, 1), 100)],
  );
  const ordered = rows.reverse();
  const actors = [...new Set(ordered.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const equipped = await equippedForMany(actors);
  return ordered.map((row) => ({
    id: asNumber(row.id), roomId: asNumber(row.room_id), actorId: row.actor_id,
    handle: row.handle, displayName: row.display_name, kind: row.kind as ChatMessage["kind"],
    body: row.body, effectCode: row.effect_code,
    createdAt: row.created_at.toISOString(),
    equipped: row.actor_id ? (equipped.get(row.actor_id) ?? { ...EMPTY_EQUIPPED }) : null,
  }));
}

export async function insertMessage(input: {
  roomId: number; actorId: string; body: string; kind?: "chat" | "action" | "sticker"; effectCode?: string | null;
}): Promise<ChatMessage> {
  const actor = await actorById(input.actorId);
  if (!actor) throw new ChatError("actor_missing", "Tu sesión de chat ya no existe.", 401);
  const { rows } = await getPool().query<{ id: string; created_at: Date }>(
    `INSERT INTO chat.messages (room_id, actor_id, body, kind, effect_code)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
    [input.roomId, input.actorId, input.body, input.kind ?? "chat", input.effectCode ?? null],
  );
  const row = rows[0];
  if (!row) throw new ChatError("message_not_stored", "No se pudo guardar el mensaje.", 500);
  return {
    id: asNumber(row.id), roomId: input.roomId, actorId: actor.id, handle: actor.handle,
    displayName: actor.displayName, kind: input.kind ?? "chat", body: input.body,
    effectCode: input.effectCode ?? null, createdAt: row.created_at.toISOString(),
    equipped: await equippedFor(actor.id),
  };
}

// ── Monedas ────────────────────────────────────────────────────────────────

export async function walletFor(actorId: string): Promise<Wallet> {
  const { rows } = await getPool().query<{ coins: string; credits: string }>(
    `INSERT INTO chat.accounts (actor_id) VALUES ($1)
     ON CONFLICT (actor_id) DO UPDATE SET actor_id = EXCLUDED.actor_id
     RETURNING coins, credits`, [actorId],
  );
  const row = rows[0];
  return { coins: asNumber(row?.coins ?? 0), credits: asNumber(row?.credits ?? 0) };
}

export async function grantCoins(input: {
  actorId: string; coins: number; credits: number; reason?: "grant" | "reward" | "refund";
  ref?: string; idempotencyKey?: string;
}): Promise<Wallet> {
  if (input.coins === 0 && input.credits === 0) throw new ChatError("empty_grant", "El grant no mueve monedas.", 400);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO chat.accounts (actor_id) VALUES ($1) ON CONFLICT DO NOTHING`, [input.actorId]);
    const { rowCount } = await client.query(
      `INSERT INTO chat.ledger (actor_id, delta_coins, delta_credits, reason, ref, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`,
      [input.actorId, input.coins, input.credits, input.reason ?? "grant", input.ref ?? null, input.idempotencyKey ?? null],
    );
    if (rowCount === 0) {
      // Reintento del mismo grant: no se vuelve a abonar.
      const { rows } = await client.query<{ coins: string; credits: string }>(
        `SELECT coins, credits FROM chat.accounts WHERE actor_id = $1`, [input.actorId],
      );
      await client.query("COMMIT");
      return { coins: asNumber(rows[0]?.coins ?? 0), credits: asNumber(rows[0]?.credits ?? 0) };
    }
    const { rows } = await client.query<{ coins: string; credits: string }>(
      `UPDATE chat.accounts SET coins = coins + $2, credits = credits + $3, updated_at = now()
       WHERE actor_id = $1 RETURNING coins, credits`,
      [input.actorId, input.coins, input.credits],
    );
    await client.query("COMMIT");
    return { coins: asNumber(rows[0]?.coins ?? 0), credits: asNumber(rows[0]?.credits ?? 0) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface PurchaseResult { wallet: Wallet; effect: { code: string; name: string }; rentedUntil: string | null }

/** Compra (o alquila) un efecto pagando con coins; si no alcanza, con credits. */
export async function buyEffect(input: {
  actorId: string; code: string; idempotencyKey: string;
}): Promise<PurchaseResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: effectRows } = await client.query<EffectRow>(
      `SELECT id, code, name, kind, description, manifest, price_coins, price_credits,
              duration_days, sort, enabled
       FROM chat.effects WHERE code = $1 AND enabled = true`,
      [input.code],
    );
    const effect = effectRows[0];
    if (!effect) throw new ChatError("effect_not_found", "Ese efecto no existe.", 404);
    const priceCoins = asNumber(effect.price_coins);
    const priceCredits = asNumber(effect.price_credits);
    const durationDays = effect.duration_days === null ? null : asNumber(effect.duration_days);

    await client.query(`INSERT INTO chat.accounts (actor_id) VALUES ($1) ON CONFLICT DO NOTHING`, [input.actorId]);
    const { rows: accountRows } = await client.query<{ coins: string; credits: string }>(
      `SELECT coins, credits FROM chat.accounts WHERE actor_id = $1 FOR UPDATE`, [input.actorId],
    );
    const account = accountRows[0];
    if (!account) throw new ChatError("account_missing", "No se encontró tu monedero.", 500);
    const coins = asNumber(account.coins);
    const credits = asNumber(account.credits);

    const payWithCoins = priceCoins > 0 && coins >= priceCoins;
    const payWithCredits = !payWithCoins && priceCredits > 0 && credits >= priceCredits;
    const free = priceCoins === 0 && priceCredits === 0;
    if (!payWithCoins && !payWithCredits && !free) {
      throw new ChatError("insufficient_funds", "No te alcanzan las monedas para ese efecto.", 402);
    }

    const { rowCount } = await client.query(
      `INSERT INTO chat.ledger (actor_id, delta_coins, delta_credits, reason, ref, idempotency_key)
       VALUES ($1,$2,$3,'purchase',$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
      [input.actorId, payWithCoins ? -priceCoins : 0, payWithCredits ? -priceCredits : 0,
        effect.code, input.idempotencyKey],
    );
    if (rowCount === 0) {
      const { rows } = await client.query<{ coins: string; credits: string }>(
        `SELECT coins, credits FROM chat.accounts WHERE actor_id = $1`, [input.actorId],
      );
      await client.query("COMMIT");
      return {
        wallet: { coins: asNumber(rows[0]?.coins ?? 0), credits: asNumber(rows[0]?.credits ?? 0) },
        effect: { code: effect.code, name: effect.name }, rentedUntil: null,
      };
    }

    const expiresAt = durationDays ? new Date(Date.now() + durationDays * 86_400_000).toISOString() : null;
    const { rows: walletRows } = await client.query<{ coins: string; credits: string }>(
      `UPDATE chat.accounts SET
         coins = coins - $2, credits = credits - $3, updated_at = now()
       WHERE actor_id = $1 RETURNING coins, credits`,
      [input.actorId, payWithCoins ? priceCoins : 0, payWithCredits ? priceCredits : 0],
    );
    await client.query(
      `INSERT INTO chat.effect_inventory (actor_id, effect_id, qty, expires_at)
       VALUES ($1,$2,1,$3)
       ON CONFLICT (actor_id, effect_id) DO UPDATE SET
         qty = chat.effect_inventory.qty + 1,
         expires_at = CASE WHEN $3::timestamptz IS NULL THEN NULL
           ELSE GREATEST(COALESCE(chat.effect_inventory.expires_at, now()), now())
                + ($4::int * interval '1 day') END`,
      [input.actorId, effect.id, expiresAt, durationDays ?? 0],
    );
    await client.query("COMMIT");
    return {
      wallet: { coins: asNumber(walletRows[0]?.coins ?? 0), credits: asNumber(walletRows[0]?.credits ?? 0) },
      effect: { code: effect.code, name: effect.name }, rentedUntil: expiresAt,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Equipa (o quita) un efecto en su ranura. Exige tenerlo vigente. */
export async function equipEffect(input: {
  actorId: string; slot: EquippedSlot; code: string | null;
}): Promise<Equipped> {
  if (input.code === null) {
    await getPool().query(`DELETE FROM chat.equipped WHERE actor_id = $1 AND slot = $2`, [input.actorId, input.slot]);
    return equippedFor(input.actorId);
  }
  const { rows } = await getPool().query<{
    id: number; kind: string; name: string; owned: boolean; expires_at: Date | null;
  }>(
    `SELECT e.id, e.kind, e.name,
            (i.actor_id IS NOT NULL) AS owned, i.expires_at
     FROM chat.effects e
     LEFT JOIN chat.effect_inventory i ON i.effect_id = e.id AND i.actor_id = $2
     WHERE e.code = $1 AND e.enabled = true`,
    [input.code, input.actorId],
  );
  const effect = rows[0];
  if (!effect) throw new ChatError("effect_not_found", "Ese efecto no existe.", 404);
  if (!isEquippable(effect.kind as EffectKind) || effect.kind !== input.slot) {
    throw new ChatError("wrong_slot", `«${effect.name}» no va en la ranura ${input.slot}.`, 400);
  }
  const expired = effect.expires_at !== null && effect.expires_at.getTime() <= Date.now();
  if (!effect.owned || expired) throw new ChatError("not_owned", "Primero consigue ese efecto.", 403);
  await getPool().query(
    `INSERT INTO chat.equipped (actor_id, slot, effect_id) VALUES ($1,$2,$3)
     ON CONFLICT (actor_id, slot) DO UPDATE SET effect_id = EXCLUDED.effect_id, updated_at = now()`,
    [input.actorId, input.slot, effect.id],
  );
  return equippedFor(input.actorId);
}

// ── Datos del catálogo para efectos ────────────────────────────────────────

export interface DailyCover { albumId: number; title: string; artist: string; coverUrl: string }

/** Portada del día (reloj editorial de CRV), para el efecto «Vinilo». */
export async function dailyCover(): Promise<DailyCover | null> {
  const date = dailyDate();
  const { rows: countRows } = await getPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM albums WHERE cover_url IS NOT NULL AND cover_url <> ''`,
  );
  const total = asNumber(countRows[0]?.n ?? 0);
  if (total === 0) return null;
  const { rows } = await getPool().query<{ id: number; title: string; artist: string; cover_url: string }>(
    `SELECT al.id, al.title, ar.name AS artist, al.cover_url
     FROM albums al JOIN artists ar ON ar.id = al.artist_id
     WHERE al.cover_url IS NOT NULL AND al.cover_url <> ''
     ORDER BY al.id OFFSET $1 LIMIT 1`,
    [dailyIndex(date, total)],
  );
  const row = rows[0];
  return row ? { albumId: asNumber(row.id), title: row.title, artist: row.artist, coverUrl: row.cover_url } : null;
}
