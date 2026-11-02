// CRV · Cliente de la radio (Fase 3).
import { request } from "./api";

export interface RadioGenreRef { slug?: string; name?: string; family?: string }
export interface RadioItem {
  videoId: string; title: string; artist: string | null; album: string; year: number | null;
  trackNumber: number; startSeconds: number; durationSeconds: number; available: true;
  regionSubstituteFor?: { videoId: string; title: string; artist: string | null };
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
    regionExcluded: number; regionRestricted: number; regionRestrictedCountries: Array<{ country: string; items: number }>;
    excluded: number; unclassified: number; availabilityCheckedAt: string | null; owner: boolean;
  };
  diagnostics?: {
    total: number; byKind: Record<string, number>;
    recent: Array<{ receivedAt: string; kind: string; country: string; browser: string; os: string; server: { videoId?: string; title?: string } | null }>;
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
  status: () => request<RadioStatus>("/community/admin/radio", { authenticated: true }),
};
