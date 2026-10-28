// CRV · Entrypoint del proceso de chat (npm run chat).
//
// El chat vive en su propio proceso por dos razones medidas: una consulta
// larga del catálogo (el índice de búsqueda) no puede retrasar un mensaje, y
// reiniciar el chat no reinicia la API que sirve las fichas. Comparte la base
// de datos y la autenticación de colaboradores; nada más.
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { assertSupportedNode } from "../config/runtime.js";
import { getEnv } from "../config/env.js";
import { moduleLogger } from "../logger/index.js";
import { registerOperatorAuth } from "../api/auth.js";
import { registerChatRoutes } from "../api/routes/chat.js";
import { syncEffectCatalog } from "./repository.js";

const log = moduleLogger("chat-server");

process.on("unhandledRejection", (reason: unknown) => {
  log.error({ err: reason }, "promesa rechazada sin manejar en el chat");
});

async function main(): Promise<void> {
  assertSupportedNode();
  const env = getEnv();
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      serializers: { req: (req) => ({ method: req.method, url: req.url.split("?")[0] ?? "" }) },
      redact: { paths: ["req.headers.cookie", "res.headers['set-cookie']"], censor: "[REDACTED]" },
      genReqId: () => randomUUID(),
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: env.CRV_ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization", "x-chat-token", "x-crv-csrf", "x-crv-operator"],
  });

  await registerOperatorAuth(app);
  await app.register(websocket);
  await registerChatRoutes(app);
  const synced = await syncEffectCatalog();
  log.info({ effects: synced }, "catálogo de efectos sincronizado");

  app.get("/health", async () => ({ ok: true, service: "crv-chat" }));

  await app.listen({ port: env.CHAT_PORT, host: env.HOST });
  log.info({ port: env.CHAT_PORT, host: env.HOST }, "chat escuchando");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  log.error({ err: error }, "el chat no pudo arrancar");
  process.exitCode = 1;
});
