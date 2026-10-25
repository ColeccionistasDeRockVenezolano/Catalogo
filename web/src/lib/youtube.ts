import type { Track } from "./types";
import { youtubeVideoId } from "../../../src/shared/youtube-playback";
export { youtubeVideoId, albumYoutubeVideoId } from "../../../src/shared/youtube-playback";

/** La duración evita atribuir huecos o pistas sin tiempo a la anterior. */
export function trackAtYoutubeTime<T extends Pick<Track, "youtubeStartSeconds" | "durationSeconds">>(tracks: readonly T[], seconds: number): T | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  let current: T | null = null;
  let currentStart = -1;
  for (const track of tracks) {
    const start = track.youtubeStartSeconds;
    if (start !== null && Number.isFinite(start) && start >= 0 && start <= seconds && start > currentStart) {
      current = track;
      currentStart = start;
    }
  }
  if (current?.durationSeconds !== null && current?.durationSeconds !== undefined
    && seconds >= currentStart + current.durationSeconds) return null;
  return current;
}

export interface YoutubePlayback { seconds: number; state: number; duration?: number; }

export interface YoutubePlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  getDuration?: () => number;
  setVolume?: (volume: number) => void;
  mute?: () => void;
  unMute?: () => void;
  destroy: () => void;
}

interface YoutubePlayerEvent { target: YoutubePlayer; }

interface YoutubeIframeApi {
  Player: new (element: HTMLIFrameElement, options: {
    events: {
      onReady: (event: YoutubePlayerEvent) => void;
      onError: (event: { data: number }) => void;
      onAutoplayBlocked: () => void;
      onStateChange: (event: YoutubePlayerEvent & { data: number }) => void;
    };
  }) => YoutubePlayer;
}

type YoutubeWindow = Window & {
  YT?: YoutubeIframeApi;
  onYouTubeIframeAPIReady?: () => void;
};

let iframeApi: Promise<YoutubeIframeApi> | undefined;

/** Una sola carga compartida, también al navegar o montar con StrictMode. */
export function loadYoutubeIframeApi(): Promise<YoutubeIframeApi> {
  const youtubeWindow = window as YoutubeWindow;
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  if (iframeApi) return iframeApi;
  iframeApi = new Promise<YoutubeIframeApi>((resolve, reject) => {
    const script = document.createElement("script");
    const previous = youtubeWindow.onYouTubeIframeAPIReady;
    const finish = () => {
      window.clearTimeout(timeout);
      script.onerror = null;
      if (previous) youtubeWindow.onYouTubeIframeAPIReady = previous;
      else delete youtubeWindow.onYouTubeIframeAPIReady;
    };
    const fail = () => {
      finish();
      script.remove();
      reject(new Error("No se pudo cargar la API del reproductor de YouTube."));
    };
    const timeout = window.setTimeout(fail, 15_000);
    youtubeWindow.onYouTubeIframeAPIReady = () => {
      finish();
      if (youtubeWindow.YT?.Player) resolve(youtubeWindow.YT);
      else reject(new Error("El reproductor de YouTube no está disponible."));
      previous?.();
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => {
    iframeApi = undefined;
    throw error;
  });
  return iframeApi;
}

export interface DiscVideo {
  discNumber: number;
  /** Nombre del disco («Lado B», «B-Sides»); null en un disco único sin nombre. */
  title: string | null;
  videoId: string;
  /** true si el video es del disco (album_disc_links) y no el del álbum. */
  own: boolean;
}

/**
 * El video de cada disco: el suyo si lo tiene (Lado B, CD 2, B-Sides sumados
 * a la página), si no el del álbum. Los segundos de inicio de una pista se
 * miden sobre el video de su disco.
 */
export function albumDiscVideos(
  albumVideoId: string | null,
  discs: ReadonlyArray<{ discNumber: number; title: string | null; platforms: ReadonlyArray<{ platform: string; url: string }> }>,
): DiscVideo[] {
  const out: DiscVideo[] = [];
  for (const disc of discs) {
    const own = youtubeVideoId(disc.platforms.find((link) => link.platform === "youtube")?.url ?? null);
    const videoId = own ?? albumVideoId;
    if (videoId) out.push({ discNumber: disc.discNumber, title: disc.title, videoId, own: Boolean(own) });
  }
  return out;
}
