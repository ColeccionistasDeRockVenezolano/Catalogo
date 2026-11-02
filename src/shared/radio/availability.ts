// CRV · Disponibilidad de los videos de la radio (Fase 3, portado de Herra 1.1.39).
//
// Un video puede volverse privado, borrarse o dejar de admitir inserciones
// después de exportar el catálogo. Se detecta sin clave de API (oEmbed) con un
// barrido periódico y al verificar lo que informa un navegador. Solo un veredicto
// del servidor excluye: el aviso de un visitante no basta y una caída de la red o
// de YouTube no vacía la emisión.
//
// Hay un solo escritor. El proceso dueño de la emisión guarda sus exclusiones; los
// demás (la sombra, mientras Herra emite) solo leen el archivo que ella mantiene y
// siguen sus cambios, sin consultar a YouTube ni escribir.
import fs from "node:fs";
import { radioLog } from "./log.js";

export type RadioVerdict = "available" | "unavailable" | "unknown";
export type RadioAvailabilityChecker = (videoId: string) => Promise<RadioVerdict>;

export interface RadioAvailabilityStore {
  isExcluded(videoId: string): boolean;
  /** Cambia cada vez que cambia el conjunto de exclusiones. */
  revision(): number;
  size(): number;
  verify(videoId: string, nowMs?: number): Promise<RadioVerdict>;
  sweep(videoIds: string[], nowMs?: number): Promise<void>;
}

// Un barrido que de golpe marca como caída una parte grande del catálogo no
// describe el catálogo sino a YouTube: esas exclusiones no se aplican.
const SWEEP_MAX_NEW_SHARE = 0.1;
const SWEEP_MIN_NEW_ALLOWED = 5;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

// oEmbed: 200 si es público e insertable; 401 sin inserción o privado; 403 vetado;
// 404 si ya no existe. Cualquier otra respuesta es inconclusa.
export async function oembedAvailability(videoId: string): Promise<RadioVerdict> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return "available";
    if (response.status === 401 || response.status === 403 || response.status === 404) return "unavailable";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function readExclusions(filePath: string): Map<string, { since: string }> {
  const excluded = new Map<string, { since: string }>();
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return excluded; }
  const videos = raw && typeof raw === "object" ? (raw as { videos?: unknown }).videos : null;
  if (!videos || typeof videos !== "object" || Array.isArray(videos)) return excluded;
  for (const [videoId, entry] of Object.entries(videos)) {
    if (!VIDEO_ID.test(videoId)) continue;
    const since = entry && typeof entry === "object" ? (entry as { since?: unknown }).since : null;
    excluded.set(videoId, { since: typeof since === "string" ? since : new Date(0).toISOString() });
  }
  return excluded;
}

export interface RadioAvailabilityOptions {
  filePath: string;
  /** Sin verificador, verificar responde `unknown`. */
  checker: RadioAvailabilityChecker | null;
  /** Solo el dueño de la emisión guarda; el resto sigue el archivo ajeno. */
  writable: boolean;
  /** Exclusiones de partida del dueño, si aún no tiene archivo propio. */
  seedPath?: string;
  cooldownMs?: number;
  concurrency?: number;
}

export function createRadioAvailabilityStore(options: RadioAvailabilityOptions): RadioAvailabilityStore {
  const { filePath, checker, writable, seedPath } = options;
  const cooldownMs = options.cooldownMs ?? 10 * 60_000;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const start = writable && seedPath && !fs.existsSync(filePath) ? seedPath : filePath;
  let excluded = readExclusions(start);
  const lastChecked = new Map<string, { atMs: number; verdict: RadioVerdict }>();
  const inflight = new Map<string, Promise<RadioVerdict>>();
  let revision = 0;
  let seenMtimeMs = mtimeOf(filePath);

  function mtimeOf(target: string): number {
    try { return fs.statSync(target).mtimeMs; } catch { return -1; }
  }

  function followExternal(): void {
    if (writable) return;
    const mtimeMs = mtimeOf(filePath);
    if (mtimeMs === seenMtimeMs) return;
    seenMtimeMs = mtimeMs;
    const next = readExclusions(filePath);
    const same = next.size === excluded.size && [...next.keys()].every((videoId) => excluded.has(videoId));
    excluded = next;
    if (!same) revision += 1;
  }

  function persist(): void {
    if (!writable) return;
    const payload = `${JSON.stringify({ version: 1, videos: Object.fromEntries(excluded) }, null, 2)}\n`;
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporary, filePath);
    } catch (error) {
      // La exclusión sigue vigente en memoria; solo se pierde tras un reinicio.
      radioLog("error", "radio_availability_persist_failed", { message: error instanceof Error ? error.message : String(error) });
      fs.rmSync(temporary, { force: true });
    }
  }

  function apply(verdicts: Array<[string, RadioVerdict]>, nowMs: number): number {
    if (!writable) return 0;
    let changed = 0;
    for (const [videoId, verdict] of verdicts) {
      if (verdict === "unavailable" && !excluded.has(videoId)) {
        excluded.set(videoId, { since: new Date(nowMs).toISOString() });
        radioLog("warn", "radio_video_excluded", { videoId });
        changed += 1;
      } else if (verdict === "available" && excluded.has(videoId)) {
        excluded.delete(videoId);
        radioLog("info", "radio_video_restored", { videoId });
        changed += 1;
      }
    }
    if (changed > 0) {
      revision += 1;
      persist();
    }
    return changed;
  }

  // Avisos repetidos no se convierten en una ráfaga a YouTube: el último
  // veredicto vale durante el enfriamiento.
  function check(videoId: string, nowMs: number): Promise<RadioVerdict> {
    if (!checker) return Promise.resolve("unknown");
    const running = inflight.get(videoId);
    if (running) return running;
    const last = lastChecked.get(videoId);
    if (last && nowMs - last.atMs < cooldownMs) return Promise.resolve(last.verdict);
    const task = checker(videoId)
      .catch((): RadioVerdict => "unknown")
      .then((verdict) => {
        lastChecked.set(videoId, { atMs: nowMs, verdict });
        return verdict;
      })
      .finally(() => { inflight.delete(videoId); });
    inflight.set(videoId, task);
    return task;
  }

  return {
    isExcluded: (videoId) => excluded.has(videoId),
    revision: () => { followExternal(); return revision; },
    size: () => excluded.size,
    async verify(videoId, nowMs = Date.now()) {
      const verdict = await check(videoId, nowMs);
      apply([[videoId, verdict]], nowMs);
      return verdict;
    },
    async sweep(videoIds, nowMs = Date.now()) {
      const unique = [...new Set(videoIds)];
      const queue = unique.slice();
      const verdicts: Array<[string, RadioVerdict]> = [];
      const worker = async (): Promise<void> => {
        for (let videoId = queue.shift(); videoId; videoId = queue.shift()) {
          verdicts.push([videoId, await check(videoId, nowMs)]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
      const newlyDown = verdicts.filter(([videoId, verdict]) => verdict === "unavailable" && !excluded.has(videoId)).length;
      const allowed = Math.max(SWEEP_MIN_NEW_ALLOWED, Math.ceil(unique.length * SWEEP_MAX_NEW_SHARE));
      if (newlyDown > allowed) {
        radioLog("error", "radio_availability_suspicious", { videos: unique.length, newlyDown, allowed });
        // Las recuperaciones sí se aplican: devolver un video nunca vacía la emisión.
        apply(verdicts.filter(([, verdict]) => verdict === "available"), nowMs);
        return;
      }
      const changed = apply(verdicts, nowMs);
      const unknown = verdicts.filter(([, verdict]) => verdict === "unknown").length;
      radioLog("info", "radio_availability_swept", { videos: unique.length, excluded: excluded.size, changed, unknown });
    },
  };
}
