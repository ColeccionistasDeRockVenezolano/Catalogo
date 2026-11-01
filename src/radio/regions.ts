// Restricciones regionales de YouTube para el catálogo de la Radio CRV.
//
// El catálogo lo exporta herra leyendo el canal, sin la API de datos, así que
// no sabe en qué países está vetado cada video. Este anotador copia en cada
// pieza `contentDetails.regionRestriction` y declara la política de la
// estación (`regionPolicy`). El motor de herra decide con eso:
//   · un veto en Venezuela o en casi todo el mundo saca la pieza para todos;
//   · cualquier otro veto se cubre por oyente con un relleno del mismo tramo.
// No agrega, quita ni reordena piezas.
import type { YouTubeVideoPayload } from "../youtube/api.js";
import { RADIO_HOME_REGION, WORLDWIDE_REGIONS } from "./catalog.js";

export interface RadioRegionRestriction {
  allowed?: string[];
  blocked?: string[];
}

export interface RegionAnnotationStats {
  items: number;
  videos: number;
  restrictedVideos: number;
  restrictedItems: number;
  /** Piezas que el motor sacará de la emisión para todos. */
  stationExcludedItems: number;
  /** Videos que la API no devolvió: se conserva lo anotado antes. */
  missingVideos: number;
}

export const RADIO_REGION_POLICY = { homeRegions: [RADIO_HOME_REGION], worldwideRegions: WORLDWIDE_REGIONS } as const;

function codes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const set = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const code = entry.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) set.add(code);
  }
  return [...set].sort();
}

/** Normaliza `contentDetails.regionRestriction`; null si no veta nada. */
export function regionRestrictionOf(payload: YouTubeVideoPayload): RadioRegionRestriction | null {
  const raw = payload.contentDetails?.["regionRestriction"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const allowed = codes((raw as Record<string, unknown>)["allowed"]);
  const blocked = codes((raw as Record<string, unknown>)["blocked"]);
  if (allowed) return { allowed };
  return blocked && blocked.length ? { blocked } : null;
}

/** Misma regla que aplica el motor de herra (regionExcludesFromStation). */
export function excludedFromStation(restriction: RadioRegionRestriction | null): boolean {
  if (!restriction) return false;
  const home = RADIO_REGION_POLICY.homeRegions;
  if (restriction.allowed) {
    return home.some((code) => !restriction.allowed!.includes(code))
      || restriction.allowed.length < RADIO_REGION_POLICY.worldwideRegions;
  }
  const blocked = restriction.blocked ?? [];
  return home.some((code) => blocked.includes(code)) || blocked.length >= RADIO_REGION_POLICY.worldwideRegions;
}

/**
 * Anota cada pieza con la restricción de su video. `payloads` trae lo que
 * devolvió la API; un video ausente conserva la anotación previa (la
 * disponibilidad la vigila herra por su lado).
 */
export function annotateRadioRegions(
  catalog: Record<string, unknown>, payloads: ReadonlyMap<string, YouTubeVideoPayload>,
): { catalog: Record<string, unknown>; stats: RegionAnnotationStats } {
  if (!Array.isArray(catalog["items"])) throw new Error("el catálogo de radio no tiene `items`");
  const stats: RegionAnnotationStats = {
    items: 0, videos: 0, restrictedVideos: 0, restrictedItems: 0, stationExcludedItems: 0, missingVideos: 0,
  };
  const seen = new Set<string>();
  const restrictedVideos = new Set<string>();
  const missing = new Set<string>();
  const items = (catalog["items"] as unknown[]).map((raw) => {
    stats.items += 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const { regionRestriction: previous, ...item } = raw as Record<string, unknown>;
    const videoId = typeof item["videoId"] === "string" ? item["videoId"] : "";
    if (videoId) seen.add(videoId);
    const payload = payloads.get(videoId);
    let restriction: RadioRegionRestriction | null;
    if (payload) restriction = regionRestrictionOf(payload);
    else {
      if (videoId) missing.add(videoId);
      restriction = previous && typeof previous === "object" ? previous as RadioRegionRestriction : null;
    }
    if (!restriction) return item;
    restrictedVideos.add(videoId);
    stats.restrictedItems += 1;
    if (excludedFromStation(restriction)) stats.stationExcludedItems += 1;
    return { ...item, regionRestriction: restriction };
  });
  stats.videos = seen.size;
  stats.restrictedVideos = restrictedVideos.size;
  stats.missingVideos = missing.size;
  return { catalog: { ...catalog, regionPolicy: { ...RADIO_REGION_POLICY, homeRegions: [...RADIO_REGION_POLICY.homeRegions] }, items }, stats };
}
