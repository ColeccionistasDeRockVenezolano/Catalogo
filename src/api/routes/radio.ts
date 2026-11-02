// CRV · Radio: emisión, presencia, avisos y diagnóstico (Fase 3).
//
// Mientras Herra emita, el gateway le reenvía la radio pública y estas rutas solo
// sirven al panel y a la sombra. Con `CRV_RADIO_SOURCE=crv` en el gateway son las
// que oye el público. La respuesta depende del país (relleno de lo vetado allí),
// por eso nunca se guarda en caché compartida.
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getEnv } from "../../config/env.js";
import { ApiError } from "../http-errors.js";
import { clientCountry, clientIp } from "../auth.js";
import { projectId } from "../community/store.js";
import { createWindowLimiter } from "../rate-limit.js";
import {
  inspectCatalog, radioSnapshot, reportRadioUnavailable, resetRadioEngineForTests,
} from "../../shared/radio/engine.js";
import { loadRadioConfig, radioStationFromConfig } from "../../shared/radio/config.js";
import { compareRadioSnapshots } from "../../shared/radio/compare.js";
import { appendRadioDiagnostic, isRadioDiagnosticKind, recentRadioDiagnostics, sanitizeDiagnostic, summarizeUserAgent } from "../radio/diagnostics.js";
import { radioListenerCount, touchRadioListener } from "../radio/listeners.js";

const listenerBody = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/u),
  active: z.boolean(),
}).strict();

const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/u;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

function radioLogDir(): string {
  return getEnv().CRV_RADIO_LOG_DIR ?? path.join(process.cwd(), "logs");
}

export async function registerRadioRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const listenerLimiter = createWindowLimiter({ max: 120, windowMs: 60_000, maxKeys: 5_000 });
  const reportLimiter = createWindowLimiter({ max: 20, windowMs: 10 * 60_000, maxKeys: 5_000 });
  const diagnosticLimiter = createWindowLimiter({ max: 30, windowMs: 10 * 60_000, maxKeys: 5_000 });

  const stationOrThrow = async () => {
    const project = await projectId();
    const config = await loadRadioConfig(project);
    if (!config) throw new ApiError(404, "radio_not_configured", "La radio no está configurada.");
    return { project, station: radioStationFromConfig(config) };
  };

  api.get("/radio/now", { schema: { tags: ["Radio"] } }, async (request, reply) => {
    const project = await projectId();
    const config = await loadRadioConfig(project);
    if (!config) throw new ApiError(404, "radio_not_configured", "La radio no está configurada.");
    const station = radioStationFromConfig(config);
    const snapshot = radioSnapshot(station, Date.now(), radioListenerCount(project), { country: clientCountry(request) });
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

  // Un navegador cuyo reproductor rechazó una pieza. El servidor verifica por su
  // cuenta y solo acepta lo que está al aire: no sirve para vaciar la emisión.
  api.post("/radio/unavailable", {
    schema: { tags: ["Radio"], body: z.object({ videoId: z.string().regex(VIDEO_ID) }).strict() },
  }, async (request, reply) => {
    if (!reportLimiter.take(clientIp(request))) throw new ApiError(429, "rate_limited", "Demasiados avisos de la radio.");
    const { station } = await stationOrThrow();
    const result = await reportRadioUnavailable(station, request.body.videoId, Date.now(), { country: clientCountry(request) });
    if (!result) throw new ApiError(404, "radio_not_on_air", "Esa pieza no está al aire.");
    return reply.header("cache-control", "no-store").send({ excluded: result.excluded });
  });

  // Diagnóstico de escucha. El cuerpo es libre porque cambia con el reproductor: se
  // recorta en el servidor, no se valida campo a campo.
  api.post("/radio/diagnostic", {
    bodyLimit: 256 * 1024,
    schema: { tags: ["Radio"], body: z.object({ kind: z.string().max(40), sessionId: z.string().regex(SESSION_ID) }).passthrough() },
  }, async (request, reply) => {
    if (!diagnosticLimiter.take(clientIp(request))) throw new ApiError(429, "rate_limited", "Demasiados diagnósticos de la radio.");
    const body = request.body as Record<string, unknown> & { kind: string; sessionId: string };
    if (!isRadioDiagnosticKind(body.kind)) throw new ApiError(400, "invalid_diagnostic", "Diagnóstico inválido.");
    const { project, station } = await stationOrThrow();
    const country = clientCountry(request);
    const nowMs = Date.now();
    const onAir = radioSnapshot(station, nowMs, radioListenerCount(project), { country });
    const browser = summarizeUserAgent(request.headers["user-agent"], body["brave"] === true);
    const report = sanitizeDiagnostic(body) as Record<string, unknown>;
    delete report["kind"];
    delete report["sessionId"];
    const entry = {
      receivedAt: new Date(nowMs).toISOString(),
      kind: body.kind,
      session: body.sessionId.slice(0, 12),
      country: country ?? "zz",
      ...browser,
      server: onAir ? {
        phase: onAir.phase, videoId: onAir.current.videoId, title: onAir.current.title, artist: onAir.current.artist,
        startsAt: onAir.startsAt, endsAt: onAir.endsAt, substituteFor: onAir.current.regionSubstituteFor?.videoId ?? null,
        next: onAir.next.videoId,
      } : null,
      report,
    };
    try {
      appendRadioDiagnostic(radioLogDir(), entry);
    } catch (error) {
      // Un disco lleno no debe tumbar la radio ni repetir el aviso del navegador.
      request.log.error({ err: error }, "radio_diagnostic_write_failed");
    }
    return reply.code(204).header("cache-control", "no-store").send();
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
      diagnostics: recentRadioDiagnostics(radioLogDir()),
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
