// CRV · Entrypoint HTTP (npm run api). ARCHITECTURE.md §4.14: API en
// 127.0.0.1:8080 por defecto, configurable por PORT/HOST.
import { assertSupportedNode } from "../config/runtime.js";
import { getEnv } from "../config/env.js";
import { assertDeploymentGuards, assertProductionDatabase } from "../config/deployment.js";
import { moduleLogger } from "../logger/index.js";
import { buildApp } from "./app.js";
import { startCurationWatcher } from "../curation/watcher.js";
import { startHomeChannelRefresh } from "../youtube/home-channel.js";
import { startEntityResolutionRetention } from "../er/retention.js";
import { startTrafficRecorder, stopTrafficRecorder } from "../traffic/record.js";
import { startBotVerification, stopBotVerification } from "../traffic/verify.js";

const log = moduleLogger("api-server");

// Una promesa rechazada sin manejador no puede tumbar la API: Node 22 termina
// el proceso por defecto, y trabajo de fondo como la verificación de Curaduría
// corre sin que ninguna petición lo espere. Se registra y el servicio sigue.
process.on("unhandledRejection", (reason: unknown) => {
  log.error({ err: reason }, "promesa rechazada sin manejar");
});

async function main(): Promise<void> {
  assertSupportedNode();
  const env = getEnv();
  // Aborta antes de escuchar si la instancia de producción apunta a la base de
  // staging, a un puerto de ensayo o le falta el secreto de visitas.
  const dbName = await assertProductionDatabase(env.CRV_DEPLOYMENT);
  assertDeploymentGuards({
    deployment: env.CRV_DEPLOYMENT,
    role: "api",
    port: env.PORT,
    ...(env.CRV_VISITS_SECRET === undefined ? {} : { visitsSecret: env.CRV_VISITS_SECRET }),
    ...(dbName === undefined ? {} : { dbName }),
    backgroundJobs: env.CRV_BACKGROUND_JOBS,
    radioEnabled: env.CRV_RADIO_ENABLED,
    ...(env.CRV_RADIO_DATA_DIR === undefined ? {} : { radioDataDir: env.CRV_RADIO_DATA_DIR }),
    ...(env.CRV_RADIO_LIVE_URL === undefined ? {} : { radioLiveUrl: env.CRV_RADIO_LIVE_URL }),
    radioOwner: env.CRV_RADIO_OWNER,
  });
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  log.info({ port: env.PORT, host: env.HOST }, "API de lectura escuchando");
  // El detector de conflictos queda cableado al catálogo: analiza al arrancar
  // si algo cambió y vigila los cambios hechos fuera de la API.
  //
  // La API de la portada (crv-api-landing) comparte la base `crv` con el
  // catálogo: si arrancara estos trabajos, habría dos vigilantes de Curaduría,
  // dos retenciones ER y dos refrescos de YouTube compitiendo por las mismas
  // filas. `CRV_BACKGROUND_JOBS=false` los apaga todos; sin definir, se
  // conserva el comportamiento del catálogo.
  if (!env.CRV_BACKGROUND_JOBS) {
    log.info({ backgroundJobs: false }, "trabajos de fondo desactivados (CRV_BACKGROUND_JOBS=false)");
  }
  const stopHomeChannel = env.CRV_BACKGROUND_JOBS ? startHomeChannelRefresh() : () => {};
  const stopCurationWatcher = env.CRV_BACKGROUND_JOBS ? startCurationWatcher(env.CRV_CURATION_WATCH_MS) : () => {};
  // La retención de decisiones ER corre sola cada ER_RETENTION_INTERVAL_HOURS
  // con tope de filas (la CLI puede forzarla con `crv er:prune`).
  const stopErRetention = env.CRV_BACKGROUND_JOBS
    ? startEntityResolutionRetention(env.ER_RETENTION_INTERVAL_HOURS * 60 * 60 * 1000, env.ER_RETENTION_MAX_ROWS)
    : () => {};
  // Métricas (3.7): con el interruptor apagado no se registra nada. Las listas
  // de IPs se cargan siempre (una vez al día) para poder verificar sin red.
  // El registro de tráfico no es un trabajo del catálogo: si la instancia lo
  // tiene encendido, necesita su escritor y sus listas aunque no corra lo demás.
  if (env.CRV_BACKGROUND_JOBS || env.CRV_TRAFFIC_ENABLED) startBotVerification({ network: env.CRV_TRAFFIC_VERIFY_NETWORK });
  if (env.CRV_TRAFFIC_ENABLED) startTrafficRecorder();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopHomeChannel();
      stopCurationWatcher();
      stopErRetention();
      stopBotVerification();
      void stopTrafficRecorder().finally(() => app.close().then(() => process.exit(0)));
    });
  }
}

main().catch((error: unknown) => {
  log.error({ err: error }, "la API no pudo arrancar");
  process.exitCode = 1;
});
