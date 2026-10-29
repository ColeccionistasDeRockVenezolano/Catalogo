// CRV · Entrypoint del proceso de chat (npm run chat).
//
// El chat vive en su propio proceso por dos razones medidas: una consulta
// larga del catálogo (el índice de búsqueda) no puede retrasar un mensaje, y
// reiniciar el chat no reinicia la API que sirve las fichas. Comparte la base
// de datos y la autenticación de colaboradores; nada más.
import { assertSupportedNode } from "../config/runtime.js";
import { getEnv } from "../config/env.js";
import { moduleLogger } from "../logger/index.js";
import { assertChatSecret, usingDevSecret } from "./session.js";
import { apiSessionResolver } from "./operator-session.js";
import { auditWallets, retainMessages } from "./repository.js";
import { buildChatApp } from "./app.js";
import { AiReviewer } from "./moderation/ai-review.js";
import { cleanupEmptyGuests, createReport } from "./moderation/store.js";

const log = moduleLogger("chat-server");

process.on("unhandledRejection", (reason: unknown) => {
  log.error({ err: reason }, "promesa rechazada sin manejar en el chat");
});

async function main(): Promise<void> {
  assertSupportedNode();
  // Antes que nada: en producción no se arranca con el secreto público.
  assertChatSecret();
  const env = getEnv();
  if (usingDevSecret()) log.warn("CRV_CHAT_SECRET es el valor de desarrollo; no exponer este proceso al público");
  const { app, hub } = await buildChatApp({ remoteSession: apiSessionResolver() });

  // Limpieza horaria de invitados vacíos (bots que nunca escribieron).
  const cleanup = async (): Promise<void> => {
    try {
      const expiredMessages = await retainMessages();
      if (expiredMessages) log.info({ removed: expiredMessages }, "retención de mensajes aplicada");
      const mismatches = await auditWallets();
      if (mismatches.length) log.error({ actors: mismatches }, "saldos distintos del libro mayor");
      const removed = await cleanupEmptyGuests(7);
      if (removed > 0) log.info({ removed }, "invitados vacíos eliminados");
    } catch (error) {
      log.warn({ err: error }, "la limpieza de invitados falló");
    }
  };
  void cleanup();
  const cleanupTimer = setInterval(() => { void cleanup(); }, 3_600_000);
  cleanupTimer.unref();

  // Clasificación de odio y amenazas con Laya, sin frenar el envío.
  const reviewer = new AiReviewer({
    onHate: async (message, verdict) => {
      await createReport({
        source: "ai", messageId: message.id, targetActor: message.actorId, reason: verdict.reason,
        details: { category: verdict.category, scores: verdict.scores },
      });
      await hub.autoHide(message.id, "ia", verdict.reason);
    },
    onDoubtful: async (message, verdict) => {
      await createReport({
        source: "ai", messageId: message.id, targetActor: message.actorId, reason: verdict.reason,
        details: { category: verdict.category, scores: verdict.scores },
      });
      hub.alertModerators({
        kind: "ai", actorId: message.actorId, displayName: message.displayName, messageId: message.id,
        text: `${verdict.reason}: «${message.body.slice(0, 80)}»`,
      });
    },
  });
  if (AiReviewer.enabled()) reviewer.start();
  app.addHook("onClose", async () => { clearInterval(cleanupTimer); reviewer.stop(); });

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
