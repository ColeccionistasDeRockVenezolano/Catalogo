// CRV · Carga única del IFrame API de YouTube para la radio.
export interface YTPlayerLike {
  playVideo(): void; pauseVideo(): void; mute(): void; unMute(): void;
  setVolume(value: number): void; getVolume(): number; getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(options: { videoId: string; startSeconds: number }): void;
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  getPlayerState(): number; destroy(): void;
}
export interface YTNamespace {
  Player: new (element: HTMLElement, options: unknown) => YTPlayerLike;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
}
declare global {
  interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
}

let youtubeApiPromise: Promise<void> | null = null;

export function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
    if (!document.querySelector("script[data-crv-youtube-api]")) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset["crvYoutubeApi"] = "true";
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

export const VOLUME_KEY = "crv-radio-volume";

export function storedVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? 70 : Number(raw);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 70;
  } catch { return 70; }
}

export function mmss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function keyOf(item: { videoId: string; startSeconds: number }): string {
  return `${item.videoId}:${item.startSeconds}`;
}
