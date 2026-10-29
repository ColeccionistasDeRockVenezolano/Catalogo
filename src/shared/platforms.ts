export const SOCIAL_PLATFORMS = ["instagram", "facebook", "x", "tiktok", "threads", "bluesky", "website", "store", "linktree"] as const;
export const STREAMING_PLATFORMS = ["spotify", "apple_music", "deezer", "youtube", "youtube_music", "tidal", "bandcamp", "soundcloud", "amazon_music", "qobuz"] as const;

/** Solo perfiles del canal: videos, playlists y YouTube Music siguen siendo escucha. */
export function isYouTubeProfile(link: { platform: string; url: string }): boolean {
  if (link.platform !== "youtube") return false;
  try {
    const url = new URL(link.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return false;
    if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) return false;
    return /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/(?:featured|videos|shorts|streams|releases|playlists|community|about))?\/?$/u.test(url.pathname);
  } catch { return false; }
}

/** Reclasifica al mostrar la ficha, incluidos los perfiles históricos en streaming_links.
 * Recibe únicamente enlaces que ya pasaron la verificación de identidad de la API.
 */
export function artistProfileLinks<T extends { platform: string; url: string }>(socials: readonly T[], platforms: readonly T[]): { follow: T[]; listen: T[] } {
  const follow = [...socials];
  const listen: T[] = [];
  for (const link of platforms) {
    if (isYouTubeProfile(link)) {
      if (!follow.some(existing => existing.platform === link.platform)) follow.push(link);
    } else listen.push(link);
  }
  return { follow, listen };
}
