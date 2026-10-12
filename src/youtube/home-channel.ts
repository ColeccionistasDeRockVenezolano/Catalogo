import { load } from "cheerio";
import { getEnv } from "../config/env.js";
import { moduleLogger } from "../logger/index.js";
import { YouTubeDataApi, type YouTubeVideoPayload } from "./api.js";

export const CRV_CHANNEL_ID = "UCtYlrz6GyvRahlhHjocWQYQ";
export const CRV_CHANNEL_URL = `https://www.youtube.com/channel/${CRV_CHANNEL_ID}`;
export const CHANNEL_REFRESH_MS = 5 * 60 * 1000;
const log = moduleLogger("home-channel");

export interface ChannelVideo {
  videoId: string; title: string; publishedAt: string; thumbnailUrl: string;
}
export interface ChannelSnapshot {
  videos: ChannelVideo[]; checkedAt: string | null; stale: boolean;
}

function fromPayload(video: YouTubeVideoPayload): ChannelVideo | null {
  const snippet = video.snippet;
  if (snippet?.["channelId"] !== CRV_CHANNEL_ID || video.status?.["privacyStatus"] !== "public") return null;
  const title = snippet["title"], publishedAt = snippet["publishedAt"];
  if (!/^[\w-]{11}$/u.test(video.id) || typeof title !== "string" || typeof publishedAt !== "string") return null;
  const thumbnails = snippet["thumbnails"] as Record<string, { url?: string }> | undefined;
  return { videoId: video.id, title, publishedAt,
    thumbnailUrl: thumbnails?.["high"]?.url ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` };
}

/** Only the latest page of the official uploads playlist: no expensive full-channel sweep. */
export async function fetchLatestChannelVideos(api = new YouTubeDataApi(undefined,
  (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }))): Promise<ChannelVideo[]> {
  const channel = (await api.getChannel(CRV_CHANNEL_ID)).items?.[0];
  const playlists = channel?.contentDetails?.["relatedPlaylists"] as Record<string, unknown> | undefined;
  const playlist = playlists?.["uploads"];
  if (typeof playlist !== "string") throw new Error("El canal no expuso su lista de publicaciones.");
  const uploads = await api.listPlaylistItems(playlist);
  const ids = (uploads.items ?? []).flatMap(item => {
    const id = item.contentDetails?.["videoId"];
    return typeof id === "string" && /^[\w-]{11}$/u.test(id) ? [id] : [];
  });
  const videos = ids.length ? (await api.listVideos(ids)).items ?? [] : [];
  return videos.map(fromPayload).filter((v): v is ChannelVideo => v !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 12);
}

/** Public official feed is the fallback when the API key/quota is unavailable. */
async function fetchFeed(): Promise<ChannelVideo[]> {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CRV_CHANNEL_ID}`,
    { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Feed de YouTube: ${response.status}`);
  const $ = load(await response.text(), { xml: true });
  if ($("feed > yt\\:channelId").text() !== CRV_CHANNEL_ID) throw new Error("Feed de otro canal.");
  return $("entry").toArray().flatMap(entry => {
    const videoId = $(entry).find("yt\\:videoId").text();
    const publishedAt = $(entry).find("published").text();
    if (!/^[\w-]{11}$/u.test(videoId) || !Number.isFinite(Date.parse(publishedAt))) return [];
    return [{ videoId, publishedAt, title: $(entry).find("title").first().text(),
      thumbnailUrl: $(entry).find("media\\:thumbnail").attr("url") ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }];
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 12);
}

let snapshot: ChannelSnapshot = { videos: [], checkedAt: null, stale: true };
let nextRefresh = 0;
let pending: Promise<ChannelSnapshot> | undefined;

export async function latestChannelSnapshot(): Promise<ChannelSnapshot> {
  if (Date.now() < nextRefresh) return snapshot;
  if (pending) return pending;
  pending = (async () => {
    try {
      let videos: ChannelVideo[];
      try { videos = getEnv().YOUTUBE_API_KEY ? await fetchLatestChannelVideos() : await fetchFeed(); }
      catch { videos = await fetchFeed(); }
      snapshot = { videos, checkedAt: new Date().toISOString(), stale: false };
      nextRefresh = Date.now() + CHANNEL_REFRESH_MS;
    } catch {
      log.warn("No se pudo actualizar el canal; se conserva la última consulta y se comunica su estado.");
      snapshot = { ...snapshot, stale: true };
      nextRefresh = Date.now() + 60_000;
    }
    return snapshot;
  })();
  try { return await pending; } finally { pending = undefined; }
}

export function startHomeChannelRefresh(): () => void {
  void latestChannelSnapshot();
  const timer = setInterval(() => { void latestChannelSnapshot(); }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
