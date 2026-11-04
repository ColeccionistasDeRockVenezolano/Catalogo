// Estado de cada video en la hoja YT Master, derivado del registro de YouTube
// que mantiene `crv-youtube-availability` en media.youtube_videos: no consulta
// páginas de YouTube ni la API. Mismos cuatro estados que la hoja:
//   Listed    público y reproducible.
//   Unlisted  oculto o privado.
//   Blocked   público, pero bloqueado por derechos en casi todo el mundo.
//   Removed   ya no existe.
import type { YouTubeVideoPayload } from "../youtube/api.js";
import { WORLDWIDE_REGIONS } from "./catalog.js";

export type SheetVideoStatus = "Listed" | "Unlisted" | "Blocked" | "Removed";

function blockedWorldwide(payload: Partial<YouTubeVideoPayload> | null): boolean {
  const restriction = payload?.contentDetails?.["regionRestriction"] as { allowed?: unknown; blocked?: unknown } | undefined;
  if (Array.isArray(restriction?.allowed)) return restriction.allowed.length === 0;
  return Array.isArray(restriction?.blocked) && restriction.blocked.length >= WORLDWIDE_REGIONS;
}

export function sheetStatusOf(publicationStatus: string, payload: Partial<YouTubeVideoPayload> | null): SheetVideoStatus {
  switch (publicationStatus) {
    case "published": return blockedWorldwide(payload) ? "Blocked" : "Listed";
    case "copyright_blocked": return "Blocked";
    case "unlisted": return "Unlisted";
    case "unpublished": return payload?.status?.["privacyStatus"] === "private" ? "Unlisted" : "Removed";
    default: return "Unlisted";
  }
}
