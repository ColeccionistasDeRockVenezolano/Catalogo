// CRV · Rutas HTTP del chat.
//
// Las lecturas son públicas; las escrituras de invitado (sesión, compra,
// equipar) las permite el hook de auth para el prefijo del chat y se limitan
// aquí por actor. Las rutas /chat/admin/* exigen la cuenta administradora de
// siempre (OPERATOR_SECURITY): el chat no abre un segundo sistema de permisos.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { OPERATOR_SECURITY } from "../auth.js";
import { ApiError } from "../http-errors.js";
import { EFFECT_KINDS, effectManifestSchema } from "../../chat/effects-catalog.js";
import { ChatHub } from "../../chat/realtime.js";
import {
  ChatError, actorByHandle, actorById, buyEffect, claimActor, createGuestActor, dailyCover,
  effectsFor, equipEffect, equippedFor, grantCoins, inventoryFor, listMessages, listRooms,
  roomBySlug, updateDisplayName, upsertEffect, walletFor,
} from "../../chat/repository.js";
import { CHAT_COOKIE, chatCookieOptions, issueChatToken, verifyChatToken } from "../../chat/session.js";
import type { ChatUser } from "../../chat/protocol.js";

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

/** Actor de la petición: token del encabezado (WS) o cookie firmada. */
async function requestActor(request: FastifyRequest): Promise<ChatUser | null> {
  const header = request.headers["x-chat-token"];
  const token = typeof header === "string" && header.length > 0 ? header : cookieToken(request);
  if (!token) return null;
  const actorId = verifyChatToken(token);
  if (!actorId) return null;
  const actor = await actorById(actorId);
  if (!actor) return null;
  return {
    id: actor.id, handle: actor.handle, displayName: actor.displayName,
    avatarSeed: actor.avatarSeed, isBot: actor.isBot, equipped: await equippedFor(actor.id),
  };
}

async function requireActor(request: FastifyRequest): Promise<ChatUser> {
  const actor = await requestActor(request);
  if (!actor) throw new ChatError("no_session", "Primero entra al chat con un apodo.", 401);
  return actor;
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

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const hub = new ChatHub();
  app.addHook("onClose", async () => hub.stop());

  // ── Sesión de invitado ───────────────────────────────────────────────────
  server.post("/chat/session", {
    schema: {
      tags: ["chat"],
      body: z.object({ displayName: z.string().trim().min(2).max(40).optional() }),
    },
  }, async (request, reply) => {
    const existing = await requestActor(request);
    if (existing) {
      const token = cookieToken(request) ?? "";
      if (token) setChatCookie(reply, token, request.protocol === "https");
      return { actor: existing, token, wallet: await walletFor(existing.id) };
    }
    try {
      const actor = await createGuestActor(request.body.displayName ?? "Oyente");
      const token = issueChatToken(actor.id);
      setChatCookie(reply, token, request.protocol === "https");
      return {
        actor: {
          id: actor.id, handle: actor.handle, displayName: actor.displayName,
          avatarSeed: actor.avatarSeed, isBot: actor.isBot, equipped: await equippedFor(actor.id),
        },
        token,
        wallet: await walletFor(actor.id),
      };
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
  }, async (request) => {
    const actor = await requireActor(request);
    try {
      const updated = await updateDisplayName(actor.id, request.body.displayName);
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
  }, async (request) => {
    const actor = await requireActor(request);
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
        slot: z.enum(["name", "frame", "background", "ambient"]),
        code: z.string().regex(/^[a-z0-9-]{2,40}$/u).nullable(),
      }),
    },
  }, async (request) => {
    const actor = await requireActor(request);
    try {
      const equipped = await equipEffect({ actorId: actor.id, slot: request.body.slot, code: request.body.code });
      return { equipped, effects: await effectsFor(actor.id) };
    } catch (error) {
      toHttp(error);
    }
  });

  server.get("/chat/wallet", { schema: { tags: ["chat"] } }, async (request) => {
    const actor = await requireActor(request);
    return await walletFor(actor.id);
  });

  server.get("/chat/daily-cover", { schema: { tags: ["chat"] } }, async (_request, reply) => {
    const cover = await dailyCover();
    if (!cover) {
      reply.code(404);
      return { error: "no_cover", message: "El catálogo no tiene portadas publicadas." };
    }
    reply.header("cache-control", "public, max-age=300");
    return cover;
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
    const raw = request.query;
    const token = typeof raw === "object" && raw !== null && "t" in raw ? String(raw["t"] ?? "") : "";
    const room = typeof raw === "object" && raw !== null && "room" in raw ? String(raw["room"] ?? "general") : "general";
    const actorId = verifyChatToken(token);
    if (!actorId) {
      socket.send(JSON.stringify({ type: "error", code: "no_session", message: "Entra al chat con un apodo." }));
      socket.close(4401, "sin sesión");
      return;
    }
    void hub.connect(
      socket,
      actorId,
      /^[a-z0-9-]{2,40}$/u.test(room) ? room : "general",
    );
  });
}
