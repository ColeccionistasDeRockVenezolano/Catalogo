// CRV · Moderación del chat (administración).
//
// Todas las rutas exigen la cuenta administradora de CRV (OPERATOR_SECURITY,
// sesión + CSRF en escrituras) y dejan su fila en chat.moderation_log con el
// nombre de quien actuó (`request.operator`). El hub aplica el efecto en vivo:
// el mensaje desaparece de todas las pantallas, el silenciado recibe el aviso,
// el expulsado o baneado pierde sus conexiones.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OPERATOR_SECURITY } from "../auth.js";
import { ApiError } from "../http-errors.js";
import { ChatError } from "../../chat/repository.js";
import type { ChatHub } from "../../chat/realtime.js";
import {
  banActor, hideMessage, listModerationLog, listReports, logKick, muteActor, resolveReport, restoreMessage,
  setSlowMode, unbanActor, unbanIp, unmuteActor,
} from "../../chat/moderation/store.js";

const actorParam = z.object({ id: z.string().uuid() });
const messageParam = z.object({ id: z.coerce.number().int().positive() });
const reasonBody = z.object({ reason: z.string().trim().max(300).default("") });

function rethrow(error: unknown): never {
  if (error instanceof ChatError) throw new ApiError(error.status, error.code, error.message);
  throw error;
}

export async function registerChatModerationRoutes(app: FastifyInstance, hub: ChatHub): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const schema = { tags: ["chat"], security: OPERATOR_SECURITY };

  server.get("/chat/admin/reports", {
    schema: {
      ...schema,
      querystring: z.object({
        status: z.enum(["open", "dismissed", "actioned", "all"]).default("open"),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
    },
  }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return { reports: await listReports(request.query.status, request.query.limit) };
  });

  server.post("/chat/admin/reports/:id/resolve", {
    schema: {
      ...schema,
      params: messageParam,
      body: z.object({ status: z.enum(["dismissed", "actioned"]), reason: z.string().trim().max(300).default("") }),
    },
  }, async (request) => {
    try {
      const closed = await resolveReport(request.params.id, request.body.status, request.operator, request.body.reason);
      return { ok: true, closed };
    } catch (error) { rethrow(error); }
  });

  server.get("/chat/admin/log", {
    schema: { ...schema, querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }) },
  }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return { entries: await listModerationLog(request.query.limit) };
  });

  server.post("/chat/admin/messages/:id/delete", { schema: { ...schema, params: messageParam, body: reasonBody } }, async (request) => {
    try {
      const ref = await hideMessage({ messageId: request.params.id, moderator: request.operator, reason: request.body.reason });
      hub.removeMessage(ref.roomSlug, ref.id);
      return { ok: true };
    } catch (error) { rethrow(error); }
  });

  server.post("/chat/admin/messages/:id/restore", { schema: { ...schema, params: messageParam, body: reasonBody } }, async (request) => {
    try {
      await restoreMessage(request.params.id, request.operator, request.body.reason);
      // Vuelve en el historial; las pantallas abiertas lo verán al recargar.
      return { ok: true };
    } catch (error) { rethrow(error); }
  });

  server.post("/chat/admin/actors/:id/mute", {
    schema: {
      ...schema, params: actorParam,
      body: z.object({ minutes: z.number().int().min(1).max(60 * 24 * 30).default(10), reason: z.string().trim().max(300).default("") }),
    },
  }, async (request) => {
    try {
      const until = await muteActor({
        actorId: request.params.id, minutes: request.body.minutes, moderator: request.operator, reason: request.body.reason,
      });
      hub.applyMute(request.params.id, until, request.body.reason);
      return { ok: true, mutedUntil: until.toISOString() };
    } catch (error) { rethrow(error); }
  });

  server.post("/chat/admin/actors/:id/unmute", { schema: { ...schema, params: actorParam, body: reasonBody } }, async (request) => {
    try {
      await unmuteActor(request.params.id, request.operator, request.body.reason);
      hub.applyMute(request.params.id, null, "");
      return { ok: true };
    } catch (error) { rethrow(error); }
  });

  server.post("/chat/admin/actors/:id/kick", { schema: { ...schema, params: actorParam, body: reasonBody } }, async (request) => {
    try {
      await logKick(request.params.id, request.operator, request.body.reason);
      return { ok: true, closed: hub.disconnect(request.params.id, "kick", request.body.reason) };
    } catch (error) { rethrow(error); }
  });

  server.post("/chat/admin/actors/:id/ban", {
    schema: {
      ...schema, params: actorParam,
      body: z.object({
        reason: z.string().trim().min(1).max(300),
        ip: z.boolean().default(false),
        ipDays: z.number().int().min(1).max(3650).nullable().default(30),
      }),
    },
  }, async (request) => {
    try {
      const result = await banActor({
        actorId: request.params.id, moderator: request.operator, reason: request.body.reason,
        banIp: request.body.ip, days: request.body.ipDays,
      });
      let closed = hub.disconnect(request.params.id, "ban", request.body.reason);
      for (const ip of result.ips) closed += hub.disconnectIp(ip);
      return { ok: true, ips: result.ips, closed };
    } catch (error) { rethrow(error); }
  });

  server.post("/chat/admin/actors/:id/unban", { schema: { ...schema, params: actorParam, body: reasonBody } }, async (request) => {
    try {
      await unbanActor(request.params.id, request.operator, request.body.reason);
      return { ok: true };
    } catch (error) { rethrow(error); }
  });

  server.post("/chat/admin/ip-bans/remove", {
    schema: { ...schema, body: z.object({ ip: z.string().min(2).max(64), reason: z.string().trim().max(300).default("") }) },
  }, async (request) => ({ ok: await unbanIp(request.body.ip, request.operator, request.body.reason) }));

  server.post("/chat/admin/rooms/:slug/slow-mode", {
    schema: {
      ...schema,
      params: z.object({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/u) }),
      body: z.object({ seconds: z.number().int().min(0).max(3600) }),
    },
  }, async (request) => {
    try {
      await setSlowMode(request.params.slug, request.body.seconds, request.operator);
      await hub.refreshRoom(request.params.slug);
      return { ok: true };
    } catch (error) { rethrow(error); }
  });
}
