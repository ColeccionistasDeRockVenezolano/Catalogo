import { describe, expect, it, vi } from "vitest";
import { CRV_CHANNEL_ID, fetchLatestChannelVideos } from "../../src/youtube/home-channel.js";
import { YouTubeDataApi } from "../../src/youtube/api.js";

describe("publicaciones actuales del canal de la home", () => {
  it("consulta uploads oficiales, excluye privados y otros canales, y ordena por publicación", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(input);
      const items = url.pathname.endsWith("channels") ? [{ id: CRV_CHANNEL_ID, contentDetails: { relatedPlaylists: { uploads: "official-uploads" } } }]
        : url.pathname.endsWith("playlistItems") ? ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map(videoId => ({ contentDetails: { videoId } }))
          : [
            { id: "aaaaaaaaaaa", snippet: { channelId: CRV_CHANNEL_ID, title: "Anterior", publishedAt: "2026-10-10T12:00:00Z" }, status: { privacyStatus: "public" } },
            { id: "bbbbbbbbbbb", snippet: { channelId: CRV_CHANNEL_ID, title: "Actual", publishedAt: "2026-10-11T12:00:00Z" }, status: { privacyStatus: "public" } },
            { id: "ccccccccccc", snippet: { channelId: CRV_CHANNEL_ID, title: "Privado", publishedAt: "2026-10-12T12:00:00Z" }, status: { privacyStatus: "private" } },
            { id: "ddddddddddd", snippet: { channelId: "other", title: "Ajeno", publishedAt: "2026-10-13T12:00:00Z" }, status: { privacyStatus: "public" } },
          ];
      return new Response(JSON.stringify({ items }), { status: 200 });
    });
    const videos = await fetchLatestChannelVideos(new YouTubeDataApi("test-key", fetcher));
    expect(videos.map(video => video.title)).toEqual(["Actual", "Anterior"]);
    expect(new URL(fetcher.mock.calls[1]![0]).searchParams.get("playlistId")).toBe("official-uploads");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
