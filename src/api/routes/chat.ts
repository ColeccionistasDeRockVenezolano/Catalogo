import { EQUIPPED_SLOTS } from "../../chat/slots.js";
// CRV · Rutas HTTP del chat.
//
// Las lecturas son públicas; las escrituras de invitado (sesión, compra,
// equipar) las permite el hook de auth para el prefijo del chat y se limitan
// aquí por actor. Las rutas /chat/admin/* exigen la cuenta administradora de
// siempre (OPERATOR_SECURITY): el chat no abre un segundo sistema de permisos.
//
// Etapa 1 del plan de apertura: crear un invitado exige prueba de trabajo y
// respeta un tope por IP; los tokens caducan y se revocan con token_version;
// cada escritura cuenta contra el actor y la IP (src/chat/guard.ts).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { OPERATOR_SECURITY, clientIp, isTrustedOrigin } from "../auth.js";
import { ApiError } from "../http-errors.js";
import { dailyDateSchema } from "../daily-cycle.js";
import { EFFECT_KINDS, effectManifestSchema } from "../../chat/effects-catalog.js";
import { ChatHub, toChatUser } from "../../chat/realtime.js";
import { type GuardKind } from "../../chat/guard.js";
import {
  ChatError, actorByHandle, actorById, buyEffect, claimActor, createGuestActor, dailyCover,
  effectsFor, equipEffect, equippedFor, grantCoins, inventoryFor, isIpBanned, listMessages, listRooms,
  recentAccountsFrom, roomBySlug, updateDisplayName, upsertEffect, walletFor, type Actor, type ChatOrigin,
} from "../../chat/repository.js";
import {
  CHAT_COOKIE, chatCookieOptions, issueChatToken, issuePowChallenge, verifyChatToken, verifyPow,
} from "../../chat/session.js";
import { FINGERPRINT_RE, type ChatUser } from "../../chat/protocol.js";
import { AUTO_HIDE_REPORTS, createReport, messageRef } from "../../chat/moderation/store.js";
import { registerChatModerationRoutes } from "./chat-moderation.js";

const roomParam = z.object({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/u) });
const effectParam = z.object({ code: z.string().regex(/^[a-z0-9-]{2,40}$/u) });

function cookieToken(request: FastifyRequest): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === CHAT_COOKIE) return part.slice(index + 1).trim();
  }
  return null;
}

function requestToken(request: FastifyRequest): string | null {
  const header = request.headers["x-chat-token"];
  return typeof header === "string" && header.length > 0 ? header : cookieToken(request);
}

/**
 * Actor vigente de la petición: firma y caducidad del token, versión igual a
 * la de la base (revocación) y sin baneo. `allowLegacy` solo lo usa la
 * renovación de sesión, para no dejar sin monedas a quien entró antes.
 */
async function tokenActor(request: FastifyRequest, allowLegacy = false): Promise<Actor | null> {
  const token = requestToken(request);
  if (!token) return null;
  const claims = verifyChatToken(token, { allowLegacy });
  if (!claims) return null;
  const actor = await actorById(claims.actorId);
  if (!actor || actor.bannedAt) return null;
  if (!claims.legacy && actor.tokenVersion !== claims.version) return null;
  return actor;
}

async function requestActor(request: FastifyRequest): Promise<ChatUser | null> {
  const actor = await tokenActor(request);
  return actor ? toChatUser(actor, await equippedFor(actor.id)) : null;
}

async function requireActor(request: FastifyRequest): Promise<ChatUser> {
  const actor = await requestActor(request);
  if (!actor) throw new ChatError("no_session", "Primero entra al chat con un apodo.", 401);
  return actor;
}

function headerText(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** IP, navegador y huella de la petición (la huella la manda el cliente). */
function requestOrigin(request: FastifyRequest, fingerprint?: string | null): ChatOrigin {
  return {
    ip: clientIp(request),
    userAgent: headerText(request, "user-agent"),
    fingerprint: fingerprint && FINGERPRINT_RE.test(fingerprint) ? fingerprint : null,
  };
}

function setChatCookie(reply: FastifyReply, token: string, secure: boolean): void {
  const options = chatCookieOptions(secure);
  const parts = [
    `${CHAT_COOKIE}=${token}`,
    `Path=${options.path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) parts.push("Secure");
  reply.header("set-cookie", parts.join("; "));
}

function toHttp(error: unknown): never {
  if (error instanceof ChatError) throw new ApiError(error.status, error.code, error.message);
  throw error;
}

export async function registerChatRoutes(app: FastifyInstance, hub = new ChatHub()): Promise<ChatHub> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  app.addHook("onClose", async () => hub.stop());

  /** Límite REST por actor e IP; 429 con Retry-After si se pasa. */
  const budget = (reply: FastifyReply, kind: GuardKind, who: { actorId?: string; ip: string }): void => {
    if (hub.guard.take(kind, who).ok) return;
    reply.header("retry-after", "60");
    throw new ApiError(429, "rate_limited", "Demasiadas solicitudes seguidas. Espera un momento y vuelve a intentarlo.");
  };

  // ── Sesión de invitado ───────────────────────────────────────────────────
  /** Desafío de la prueba de trabajo para crear un invitado. */
  server.get("/chat/challenge", { schema: { tags: ["chat"] } }, async (request, reply) => {
    const ip = clientIp(request);
    budget(reply, "challenge", { ip });
    reply.header("cache-control", "no-store");
    return issuePowChallenge(ip);
  });

  server.post("/chat/session", {
    schema: {
      tags: ["chat"],
      body: z.object({
        displayName: z.string().trim().min(2).max(40).optional(),
        challenge: z.string().max(200).optional(),
        nonce: z.string().max(20).optional(),
        fp: z.string().max(64).optional(),
      }),
    },
  }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const origin = requestOrigin(request, request.body.fp);
    if (await isIpBanned(origin.ip)) throw new ApiError(403, "banned", "No puedes entrar a La Rockola.");
    const secure = request.protocol === "https";

    // Renovación: el mismo actor recibe un token nuevo (caducidad corrida).
    const existing = await tokenActor(request, true);
    if (existing) {
      const token = issueChatToken(existing.id, existing.tokenVersion);
      setChatCookie(reply, token, secure);
      return { actor: toChatUser(existing, await equippedFor(existing.id)), token, wallet: await walletFor(existing.id) };
    }
    const presented = requestToken(request);
    const claims = presented ? verifyChatToken(presented, { allowLegacy: true }) : null;
    if (claims && (await actorById(claims.actorId))?.bannedAt) {
      throw new ApiError(403, "banned", "No puedes entrar a La Rockola.");
    }

    // Invitado nuevo: prueba de trabajo y tope por IP. El tope se cobra
    // después del desafío: el primer intento sin resolver (428) no gasta cupo.
    const pow = verifyPow(origin.ip ?? "desconocida", request.body.challenge, request.body.nonce);
    if (pow) {
      throw new ApiError(428, "pow_required", "Resuelve el desafío del navegador para entrar al chat.", { reason: pow });
    }
    budget(reply, "session", { ip: origin.ip ?? "desconocida" });
    try {
      const actor = await createGuestActor(request.body.displayName ?? "Oyente", origin);
      const token = issueChatToken(actor.id, actor.tokenVersion);
      setChatCookie(reply, token, secure);
      const counts = await recentAccountsFrom(origin.ip, origin.fingerprint);
      hub.detector.onSessionCreated(actor.id, counts.ip, counts.fingerprint);
      return { actor: toChatUser(actor, await equippedFor(actor.id)), token, wallet: await walletFor(actor.id) };
    } catch (error) {
      toHttp(error);
    }
  });

  server.get("/chat/session", { schema: { tags: ["chat"] } }, async (request) => {
    const actor = await requireActor(request);
    return { actor, wallet: await walletFor(actor.id) };
  });

  /** Cambiar el apodo visible sin perder mensajes, monedas ni inventario. */
  server.patch("/chat/profile", {
    schema: {
      tags: ["chat"],
      body: z.object({ displayName: z.string().trim().min(2).max(40) }),
    },
  }, async (request, reply) => {
    const actor = await requireActor(request);
    budget(reply, "profile", { actorId: actor.id, ip: clientIp(request) });
    try {
      const updated = await updateDisplayName(actor.id, request.body.displayName);
      hub.renamed(actor.id, updated.displayName);
      const next: ChatUser = { ...actor, displayName: updated.displayName };
      return { actor: next };
    } catch (error) {
      toHttp(error);
    }
  });

  // ── Salas y mensajes ─────────────────────────────────────────────────────
  server.get("/chat/rooms", { schema: { tags: ["chat"] } }, async () => ({ rooms: await listRooms() }));

  server.get("/chat/rooms/:slug/messages", {
    schema: {
      tags: ["chat"],
      params: roomParam,
      querystring: z.object({
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
    },
  }, async (request, reply) => {
    const room = await roomBySlug(request.params.slug);
    if (!room) {
      reply.code(404);
      return { error: "room_not_found", message: "Esa sala no existe." };
    }
    const messages = await listMessages(room.id, request.query.limit, request.query.before);
    return { room, messages };
  });

  // ── Catálogo e inventario ────────────────────────────────────────────────
  server.get("/chat/effects", { schema: { tags: ["chat"] } }, async (request) => {
    const actor = await requestActor(request);
    return { effects: await effectsFor(actor?.id ?? "00000000-0000-0000-0000-000000000000") };
  });

  server.get("/chat/inventory", { schema: { tags: ["chat"] } }, async (request) => {
    const actor = await requireActor(request);
    return { inventory: await inventoryFor(actor.id), equipped: await equippedFor(actor.id) };
  });

  server.post("/chat/effects/:code/buy", {
    schema: {
      tags: ["chat"],
      params: effectParam,
      body: z.object({ idempotencyKey: z.string().uuid().optional() }),
    },
  }, async (request, reply) => {
    const actor = await requireActor(request);
    budget(reply, "buy", { actorId: actor.id, ip: clientIp(request) });
    try {
      const result = await buyEffect({
        actorId: actor.id, code: request.params.code,
        idempotencyKey: request.body.idempotencyKey ?? randomUUID(),
      });
      return { ...result, effects: await effectsFor(actor.id) };
    } catch (error) {
      toHttp(error);
    }
  });

  server.post("/chat/equip", {
    schema: {
      tags: ["chat"],
      body: z.object({
        slot: z.enum(EQUIPPED_SLOTS),
        code: z.string().regex(/^[a-z0-9-]{2,40}$/u).nullable(),
      }),
    },
  }, async (request, reply) => {
    const actor = await requireActor(request);
    budget(reply, "equip", { actorId: actor.id, ip: clientIp(request) });
    try {
      const equipped = await equipEffect({ actorId: actor.id, slot: request.body.slot, code: request.body.code });
      hub.equipped(actor.id, equipped);
      return { equipped, effects: await effectsFor(actor.id) };
    } catch (error) {
      toHttp(error);
    }
  });

  server.get("/chat/wallet", { schema: { tags: ["chat"] } }, async (request) => {
    const actor = await requireActor(request);
    return await walletFor(actor.id);
  });

  server.get("/chat/daily-cover", { schema: { tags: ["chat"], querystring: z.object({ date: dailyDateSchema.optional() }) } }, async (request, reply) => {
    const cover = await dailyCover(request.query.date);
    if (!cover) {
      reply.code(404);
      return { error: "no_cover", message: "El catálogo no tiene portadas publicadas." };
    }
    reply.header("cache-control", "public, max-age=300");
    return cover;
  });

  // ── Reportes de usuarios ─────────────────────────────────────────────────
  server.post("/chat/messages/:id/report", {
    schema: {
      tags: ["chat"],
      params: z.object({ id: z.coerce.number().int().positive() }),
      body: z.object({
        reason: z.enum(["odio", "acoso", "spam", "groserias", "otro"]).default("otro"),
        note: z.string().trim().max(300).optional(),
      }),
    },
  }, async (request, reply) => {
    const actor = await requireActor(request);
    budget(reply, "report", { actorId: actor.id, ip: clientIp(request) });
    const ref = await messageRef(request.params.id);
    if (!ref) throw new ApiError(404, "message_not_found", "Ese mensaje no existe.");
    if (ref.actorId === actor.id) throw new ApiError(400, "own_message", "No puedes reportar tu propio mensaje.");
    const result = await createReport({
      source: "user", messageId: ref.id, targetActor: ref.actorId, reporter: actor.id,
      reason: request.body.reason, details: request.body.note ? { note: request.body.note } : {},
    });
    if (result.created) {
      hub.alertModerators({
        kind: "report", actorId: ref.actorId, displayName: ref.actorId ? hub.displayNameOf(ref.actorId) : null,
        messageId: ref.id, text: `Reporte (${request.body.reason}) de ${actor.displayName}: «${ref.body.slice(0, 80)}»`,
      });
      // Varios usuarios distintos: se oculta hasta que un moderador decida.
      if (result.userReports === AUTO_HIDE_REPORTS) {
        await hub.autoHide(ref.id, "reportes", `${AUTO_HIDE_REPORTS} usuarios lo reportaron`);
      }
    }
    return { ok: true, alreadyReported: !result.created };
  });

  // ── Administración ───────────────────────────────────────────────────────
  server.post("/chat/admin/grant", {
    schema: {
      tags: ["chat"], security: OPERATOR_SECURITY,
      body: z.object({
        handle: z.string().min(3).max(24),
        coins: z.number().int().min(0).max(1_000_000).default(0),
        credits: z.number().int().min(0).max(1_000_000).default(0),
        reason: z.enum(["grant", "reward", "refund"]).default("grant"),
        ref: z.string().max(120).optional(),
        idempotencyKey: z.string().max(120).optional(),
      }),
    },
  }, async (request) => {
    const actor = await actorByHandle(request.body.handle);
    if (!actor) {
      const error = new Error("Ese apodo no existe en el chat.") as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }
    const wallet = await grantCoins({
      actorId: actor.id, coins: request.body.coins, credits: request.body.credits,
      reason: request.body.reason, ...(request.body.ref ? { ref: request.body.ref } : {}),
      ...(request.body.idempotencyKey ? { idempotencyKey: request.body.idempotencyKey } : {}),
    });
    return { actor, wallet };
  });

  server.get("/chat/admin/effects", {
    schema: { tags: ["chat"], security: OPERATOR_SECURITY },
  }, async () => ({ effects: await effectsFor("00000000-0000-0000-0000-000000000000") }));

  server.post("/chat/admin/effects", {
    schema: {
      tags: ["chat"], security: OPERATOR_SECURITY,
      body: z.object({
        code: z.string().regex(/^[a-z0-9-]{2,40}$/u),
        name: z.string().trim().min(2).max(40),
        kind: z.enum(EFFECT_KINDS),
        description: z.string().trim().max(160).default(""),
        manifest: z.unknown(),
        priceCoins: z.number().int().min(0).max(100_000).default(0),
        priceCredits: z.number().int().min(0).max(100_000).default(0),
        durationDays: z.number().int().min(1).max(3650).nullable().default(30),
        sort: z.number().int().min(0).max(10_000).default(100),
        enabled: z.boolean().default(true),
      }),
    },
  }, async (request, reply) => {
    const manifest = effectManifestSchema.safeParse(request.body.manifest);
    if (!manifest.success) {
      reply.code(400);
      return {
        error: "invalid_manifest",
        message: "El manifiesto no es válido.",
        issues: manifest.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      };
    }
    await upsertEffect({ ...request.body, manifest: manifest.data as unknown as Record<string, unknown> });
    return { ok: true, code: request.body.code };
  });

  server.post("/chat/claim", {
    schema: {
      tags: ["chat"], security: OPERATOR_SECURITY,
      body: z.object({ handle: z.string().min(3).max(24), userId: z.string().min(1).max(120) }),
    },
  }, async (request) => {
    const actor = await actorByHandle(request.body.handle);
    if (!actor) {
      const error = new Error("Ese apodo no existe en el chat.") as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }
    return { actor: await claimActor(actor.id, request.body.userId) };
  });

  // ── WebSocket ────────────────────────────────────────────────────────────
  // @fastify/websocket permite `websocket: true` en una ruta normal; el
  // registro del plugin lo hace app.ts antes de llamar a este módulo.
  server.get("/chat/ws", { websocket: true }, (socket, request) => {
    // Un navegador siempre manda Origin en el upgrade: sin él, o desde otro
    // sitio, es un script o un secuestro de WebSocket entre sitios.
    if (!request.headers.origin || !isTrustedOrigin(request)) {
      socket.send(JSON.stringify({ type: "error", code: "untrusted_origin", message: "Origen no permitido." }));
      socket.close(4403, "origen");
      return;
    }
    const raw = request.query;
    const param = (name: string): string =>
      typeof raw === "object" && raw !== null && name in raw ? String((raw as Record<string, unknown>)[name] ?? "") : "";
    const room = param("room") || "general";
    const claims = verifyChatToken(param("t"));
    if (!claims) {
      socket.send(JSON.stringify({ type: "error", code: "no_session", message: "Entra al chat con un apodo." }));
      socket.close(4401, "sin sesión");
      return;
    }
    // Un administrador de CRV con sesión abierta recibe los avisos de moderación.
    const moderator = request.viewer?.role === "admin" ? request.viewer.name : null;
    void hub.connect(socket, {
      claims,
      roomSlug: /^[a-z0-9-]{2,40}$/u.test(room) ? room : "general",
      origin: requestOrigin(request, param("fp")),
      moderator,
    }).catch((error: unknown) => {
      request.log.error({ err: error }, "no se pudo abrir la conexión del chat");
      socket.close(1011, "error");
    });
  });

  await registerChatModerationRoutes(app, hub);
  return hub;
}
