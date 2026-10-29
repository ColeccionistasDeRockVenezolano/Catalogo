// CRV · Construcción de la aplicación del chat (Fastify + WebSocket).
//
// Separada del entrypoint (server.ts) para que las pruebas de contrato
// levanten exactamente el mismo servidor —límites, Origin, maxPayload,
// moderación— contra un PostgreSQL de prueba, sin temporizadores ni Laya.
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { getEnv } from "../config/env.js";
import { moduleLogger } from "../logger/index.js";
import { registerOperatorAuth, type RemoteSessionResolver } from "../api/auth.js";
import { ApiError } from "../api/http-errors.js";
import { registerChatRoutes } from "../api/routes/chat.js";
import { ChatError, syncEffectCatalog } from "./repository.js";
import { CHAT_MAX_PAYLOAD } from "./protocol.js";
import type { ChatHub } from "./realtime.js";

const log = moduleLogger("chat-server");

export interface ChatAppOptions {
  /** Sesión de colaborador vista desde otro proceso (la API del catálogo). */
  remoteSession?: RemoteSessionResolver;
  /** Hub propio (pruebas); por defecto uno nuevo. */
  hub?: ChatHub;
  logger?: false;
}

export async function buildChatApp(options: ChatAppOptions = {}): Promise<{ app: FastifyInstance; hub: ChatHub }> {
  const env = getEnv();
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: env.LOG_LEVEL,
      serializers: { req: (req) => ({ method: req.method, url: req.url.split("?")[0] ?? "" }) },
      redact: { paths: ["req.headers.cookie", "res.headers['set-cookie']"], censor: "[REDACTED]" },
      genReqId: () => randomUUID(),
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Mismo formato de error que la API: { error: { code, message } }.
  app.setErrorHandler((error: Error, request, reply) => {
    if (error instanceof ApiError || error instanceof ChatError) {
      const status = error instanceof ApiError ? error.statusCode : error.status;
      const details = error instanceof ApiError ? error.details : undefined;
      void reply.status(status).send({ error: { code: error.code, message: error.message, ...(details ? { details } : {}) } });
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode !== undefined && statusCode < 500) {
      void reply.status(statusCode).send({ error: { code: "bad_request", message: error.message } });
      return;
    }
    request.log.error({ err: error }, "error no controlado en el chat");
    void reply.status(500).send({ error: { code: "internal_error", message: "error interno" } });
  });

  await app.register(cors, {
    origin: env.CRV_ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization", "x-chat-token", "x-crv-csrf", "x-crv-operator"],
  });

  await registerOperatorAuth(app, options.remoteSession ? { remoteSession: options.remoteSession } : {});
  // Tope de frame: el valor por defecto de `ws` (100 MiB) permitía agotar la memoria.
  await app.register(websocket, { options: { maxPayload: CHAT_MAX_PAYLOAD } });
  const hub = await registerChatRoutes(app, options.hub);
  const synced = await syncEffectCatalog();
  log.info({ effects: synced }, "catálogo de efectos sincronizado");


  app.get("/health", async () => ({ ok: true, service: "crv-chat" }));
  return { app, hub };
}
