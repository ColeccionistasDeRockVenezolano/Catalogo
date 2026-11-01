// CRV · Cliente de la radio (Fase 3).
import { request } from "./api";

export interface RadioGenreRef { slug?: string; name?: string; family?: string }
export interface RadioItem {
  videoId: string; title: string; artist: string | null; album: string; year: number | null;
  trackNumber: number; startSeconds: number; durationSeconds: number; available: true;
  genres?: { primaryGenre?: RadioGenreRef | null; secondaryGenres?: RadioGenreRef[] | null; families?: string[] | null };
}
export interface RadioSweeper {
  src: string; durationSeconds: number; overlapSeconds?: number; leadSeconds?: number; everyPieces?: number;
}
export interface RadioSnapshot {
  phase: "music" | "sweeper";
  sweeper?: RadioSweeper;
  sweeperSlot: boolean;
  sweeperNext: boolean;
  crossfadeSeconds: number;
  station: string;
  sweeperStartedAt?: string;
  queueId: string;
  catalogVersion: string;
  serverTime: string;
  startsAt: string;
  endsAt: string;
  offsetSeconds: number;
  cycle: number;
  position: number;
  total: number;
  current: RadioItem;
  next: RadioItem;
  upcoming: RadioItem[];
  listeners: number;
}
export interface RadioStatus {
  configured: boolean;
  station?: {
    name: string; epoch: string; crossfadeSeconds: number; sweeper: RadioSweeper | null; roadmapIntro: string | null;
  };
  catalog?: {
    items: number; playable: number; version: string | null; totalDurationSeconds: number;
    genres: number; lastModified: string | null; error: string | null; file: string;
  };
  local?: RadioSnapshot | null;
  live?: {
    reachable: boolean; serverTime?: string; catalogVersion?: string; queueId?: string;
    position?: number; current?: RadioItem; next?: RadioItem;
    diffs?: Array<{ field: string; live: unknown; local: unknown }>; error?: string;
  } | null;
}

export const radioApi = {
  now: () => request<RadioSnapshot>("/radio/now"),
  listener: (sessionId: string, active: boolean) =>
    request<{ listeners: number }>("/radio/listener", { method: "POST", body: { sessionId, active } }),
  status: () => request<RadioStatus>("/community/admin/radio", { authenticated: true }),
};

export function radioSessionId(): string {
  const key = "crv-radio-session";
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored && /^[A-Za-z0-9_-]{16,64}$/u.test(stored)) return stored;
    const generated = crypto.randomUUID().replace(/-/gu, "");
    window.sessionStorage.setItem(key, generated);
    return generated;
  } catch {
    return crypto.randomUUID().replace(/-/gu, "");
  }
}
