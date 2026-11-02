// CRV · Instantánea de la tarjeta de radio de la portada (Fase 2B).
//
// Mientras Herra emita, la primera imagen de la tarjeta debe decir lo mismo que
// el reproductor, que habla con el `/api/radio/now` de Herra a través del
// gateway. Por eso, con `CRV_RADIO_LIVE_URL` definida, se pinta lo que Herra
// dice que suena (GET, sin efectos en sus oyentes ni en sus visitas), con caché
// breve y un tope de espera que no retrasa la portada. Si Herra no responde, se
// recurre al motor propio: la tarjeta sigue apareciendo y el reproductor avisará
// de que la señal se perdió.
import type { RadioSnapshot } from "../shared/radio/engine.js";

const LIVE_TIMEOUT_MS = 800;
const LIVE_CACHE_MS = 3_000;

type Fetcher = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

let cached: { url: string; at: number; snapshot: RadioSnapshot } | null = null;

function isSnapshot(value: unknown): value is RadioSnapshot {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  const current = raw["current"] as Record<string, unknown> | null | undefined;
  return typeof raw["queueId"] === "string"
    && typeof raw["phase"] === "string"
    && typeof raw["offsetSeconds"] === "number"
    && Array.isArray(raw["upcoming"])
    && Boolean(current) && typeof current?.["videoId"] === "string"
    && typeof current?.["durationSeconds"] === "number";
}

/** Lo que Herra emite ahora, o `null` si no responde con una instantánea válida. */
export async function liveRadioSnapshot(
  url: string | undefined,
  fetcher: Fetcher = fetch,
  nowMs = Date.now(),
): Promise<RadioSnapshot | null> {
  if (!url) return null;
  if (cached && cached.url === url && nowMs - cached.at < LIVE_CACHE_MS) return cached.snapshot;
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!isSnapshot(payload)) return null;
    cached = { url, at: nowMs, snapshot: payload };
    return payload;
  } catch {
    return null;
  }
}

/** Solo pruebas. */
export function resetLiveRadioCacheForTests(): void {
  cached = null;
}
