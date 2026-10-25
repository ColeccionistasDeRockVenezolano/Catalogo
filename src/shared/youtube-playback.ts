/** Identidad y selección de video compartidas por la API y el reproductor. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

export function youtubeVideoId(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be" || host === "www.youtu.be") id = parsed.pathname.split("/")[1] ?? null;
    else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host)) {
      const parts = parsed.pathname.split("/");
      id = parsed.pathname === "/watch" ? parsed.searchParams.get("v")
        : ["embed", "shorts", "live", "v"].includes(parts[1] ?? "") ? parts[2] ?? null : null;
    }
    return id && VIDEO_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function albumYoutubeVideoId(album: {
  youtubeLinks: ReadonlyArray<{ videoId: string; kind: string; isPrimaryLink: boolean; title?: string | null }>;
  youtubeUrl: string | null;
}): string | null {
  const links = album.youtubeLinks.filter((link) => VIDEO_ID.test(link.videoId));
  return links.find((link) => link.isPrimaryLink)?.videoId
    ?? links.find((link) => link.kind === "full_album")?.videoId
    ?? youtubeVideoId(album.youtubeUrl)
    ?? links[0]?.videoId
    ?? null;
}
