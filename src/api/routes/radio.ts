// CRV · Radio: emisión en sombra y presencia (Fase 3).
//
// El catálogo no emite al público todavía: estas rutas existen en staging para
// que el cliente y el panel comparen el motor propio con `herra-crv`. La
// lectura pública no escribe nada; el latido de oyentes vive en memoria.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getEnv } from "../../config/env.js";
import { ApiError } from "../http-errors.js";
import { clientIp } from "../auth.js";
import { projectId } from "../community/store.js";
import { createWindowLimiter } from "../rate-limit.js";
import {
  inspectCatalog, radioSnapshot, resetRadioEngineForTests,
} from "../../shared/radio/engine.js";
import { loadRadioConfig, radioStationFromConfig } from "../../shared/radio/config.js";
import { compareRadioSnapshots } from "../../shared/radio/compare.js";
import { radioListenerCount, touchRadioListener } from "../radio/listeners.js";

const listenerBody = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/u),
  active: z.boolean(),
}).strict();

export async function registerRadioRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const listenerLimiter = createWindowLimiter({ max: 120, windowMs: 60_000, maxKeys: 5_000 });

  api.get("/radio/now", { schema: { tags: ["Radio"] } }, async (_request, reply) => {
    const project = await projectId();
    const config = await loadRadioConfig(project);
    if (!config) throw new ApiError(404, "radio_not_configured", "La radio no está configurada.");
    const station = radioStationFromConfig(config);
    const snapshot = radioSnapshot(station, Date.now(), radioListenerCount(project));
    if (!snapshot) throw new ApiError(404, "radio_unavailable", "La radio no tiene un catálogo disponible.");
    return reply.header("cache-control", "no-store").send(snapshot);
  });

  api.post("/radio/listener", { schema: { tags: ["Radio"], body: listenerBody } }, async (request) => {
    if (!listenerLimiter.take(clientIp(request))) {
      throw new ApiError(429, "rate_limited", "Demasiados latidos de escucha.");
    }
    const project = await projectId();
    const config = await loadRadioConfig(project);
    if (!config) throw new ApiError(404, "radio_not_configured", "La radio no está configurada.");
    const station = radioStationFromConfig(config);
    if (!radioSnapshot(station)) throw new ApiError(404, "radio_unavailable", "La radio no tiene un catálogo disponible.");
    return { listeners: touchRadioListener(project, request.body.sessionId, request.body.active) };
  });

  // Estado de la sombra: motor local, catálogo y comparación con Herra. No
  // altera nada; sirve para vigilar la fase antes del go-live.
  api.get("/community/admin/radio", { schema: { tags: ["Radio"] } }, async () => {
    const project = await projectId();
    const config = await loadRadioConfig(project);
    if (!config) return { configured: false };
    const station = radioStationFromConfig(config);
    const catalog = inspectCatalog(station);
    const local = radioSnapshot(station, Date.now(), radioListenerCount(project));
    const liveUrl = getEnv().CRV_RADIO_LIVE_URL;
    let live: unknown = null;
    if (liveUrl) {
      try {
        const response = await fetch(liveUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as Parameters<typeof compareRadioSnapshots>[0];
        const mirrored = radioSnapshot(station, Date.parse(payload.serverTime), payload.listeners ?? 0);
        live = {
          reachable: true,
          serverTime: payload.serverTime,
          catalogVersion: payload.catalogVersion,
          queueId: payload.queueId,
          position: payload.position,
          current: payload.current,
          next: payload.next,
          diffs: mirrored ? compareRadioSnapshots(payload, mirrored) : [{ field: "local", live: "snapshot", local: "sin emisión" }],
        };
      } catch (error) {
        live = { reachable: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    return {
      configured: true,
      station: {
        name: config.stationName, epoch: config.epoch, crossfadeSeconds: config.crossfadeSeconds,
        sweeper: config.sweeper ?? null, roadmapIntro: config.roadmapIntro,
      },
      catalog: { ...catalog, file: config.catalogFile },
      local,
      live,
    };
  });
}

/** Solo pruebas: vacía las cachés del motor y la presencia. */
export function resetRadioStateForTests(): void {
  resetRadioEngineForTests();
}
