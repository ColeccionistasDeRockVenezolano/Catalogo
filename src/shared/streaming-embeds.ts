// Reproductores insertables de cada plataforma de escucha (2026-10-13). Cada enlace verificado
// del disco o del artista se traduce a la URL del reproductor oficial de su plataforma; los que
// no tienen reproductor (Amazon Music, un perfil de Tidal o de Apple Music) quedan solo como
// enlace en la fila de iconos.

export interface EmbedLink { platform: string; url: string; externalId?: string | null }
export type EmbedOwner = "album" | "artist";

export interface EmbedSpec {
  platform: string;
  src: string;
  /** Alto fijo en px; sin alto, el reproductor es de video (16:9). */
  height: number | null;
  /** Sin sesión iniciada en la plataforma solo suenan fragmentos (30 s). */
  previewsWithoutLogin: boolean;
  /** Ancho máximo propio del reproductor (Bandcamp no pasa de 700 px y deja el resto en blanco). */
  maxWidth?: number;
}

/** Orden del selector: primero lo que suena completo para cualquiera. */
export const EMBED_ORDER = ["crv_youtube", "bandcamp", "soundcloud", "youtube", "youtube_music", "spotify", "apple_music", "deezer", "tidal"] as const;

/** Prioridad inicial de escucha en los perfiles de artistas y bandas. */
export const ARTIST_EMBED_ORDER = ["crv_youtube", "bandcamp", "soundcloud", "youtube", "youtube_music", "spotify", "deezer", "apple_music", "tidal"] as const;

export function compareEmbedPlatforms(a: string, b: string, owner: EmbedOwner): number {
  return orderOf(a, owner) - orderOf(b, owner);
}

const YT_LIST = /^(?:OLAK5uy_[\w-]{20,}|PL[\w-]{16,}|UU[\w-]{22}|RDCLAK5uy_[\w-]{20,})$/u;

function youtubeList(list: string | null | undefined): string | null {
  const value = (list ?? "").replace(/^VL/u, "");
  return YT_LIST.test(value) ? value : null;
}

function listFromUrl(url: string): string | null {
  try { return new URL(url).searchParams.get("list"); } catch { return null; }
}

const videoseries = (list: string) => `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}&rel=0`;

export function embedFor(link: EmbedLink, owner: EmbedOwner): EmbedSpec | null {
  const { platform, url } = link;
  switch (platform) {
    case "crv_youtube": {
      const id = /[?&]v=([\w-]{11})(?:&|$)/u.exec(url)?.[1];
      return id ? { platform, src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, height: null, previewsWithoutLogin: false } : null;
    }
    case "spotify": {
      const m = /open\.spotify\.com\/(?:intl-[\w-]+\/)?(album|artist|track|playlist)\/([A-Za-z0-9]{22})/u.exec(url);
      if (!m) return null;
      return { platform, src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator`, height: 352, previewsWithoutLogin: true };
    }
    case "deezer": {
      const m = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(album|artist|track|playlist)\/(\d+)/u.exec(url);
      if (!m) return null;
      const path = m[1] === "artist" ? `artist/${m[2]}/top_tracks` : `${m[1]}/${m[2]}`;
      return { platform, src: `https://widget.deezer.com/widget/dark/${path}?tracklist=true`, height: 380, previewsWithoutLogin: true };
    }
    case "apple_music": {
      if (owner !== "album") return null;
      const m = /(?:music|itunes)\.apple\.com\/([a-z]{2})\/album\/(?:[^/?#]+\/)?(?:id)?(\d+)/u.exec(url);
      if (!m) return null;
      return { platform, src: `https://embed.music.apple.com/${m[1]}/album/${m[2]}`, height: 450, previewsWithoutLogin: true };
    }
    case "tidal": {
      const m = /tidal\.com\/(?:browse\/)?(album|track|playlist|video)\/([\w-]+)/u.exec(url);
      if (!m) return null;
      return { platform, src: `https://embed.tidal.com/${m[1]}s/${m[2]}`, height: m[1] === "track" ? 120 : 360, previewsWithoutLogin: true };
    }
    case "soundcloud": {
      if (!/^https:\/\/(?:www\.|m\.)?soundcloud\.com\/[\w-]+/u.test(url)) return null;
      const params = new URLSearchParams({ url, color: "#e50914", auto_play: "false", hide_related: "true", show_comments: "false", show_reposts: "false", visual: "false" });
      return { platform, src: `https://w.soundcloud.com/player/?${params}`, height: 450, previewsWithoutLogin: false };
    }
    case "bandcamp": {
      const m = /^(album|track)=(\d+)$/u.exec(link.externalId ?? "");
      if (!m) return null;
      const track = m[1] === "track";
      return { platform, src: `https://bandcamp.com/EmbeddedPlayer/${m[1]}=${m[2]}/size=large/bgcol=141414/linkcol=e50914/${track ? "" : "tracklist=true/"}artwork=small/transparent=true/`, height: track ? 120 : 472, previewsWithoutLogin: false, maxWidth: 700 };
    }
    case "youtube_music": {
      const list = youtubeList(link.externalId) ?? youtubeList(listFromUrl(url));
      return list ? { platform, src: videoseries(list), height: null, previewsWithoutLogin: false } : null;
    }
    case "youtube": {
      // Perfil del artista: el canal se reproduce por su lista de subidas (UC… → UU…).
      const channel = /youtube\.com\/channel\/UC([\w-]{22})/u.exec(url);
      const externalChannel = /^UC([\w-]{22})$/u.exec(link.externalId ?? "");
      const channelId = channel?.[1] ?? externalChannel?.[1];
      const list = channelId ? `UU${channelId}` : youtubeList(listFromUrl(url));
      return list ? { platform, src: videoseries(list), height: null, previewsWithoutLogin: false } : null;
    }
    default:
      return null;
  }
}

/** Una plataforma puede tener varios reproductores (el disco entero y cada «Lado»/«CD» por separado). */
export interface EmbedTarget { key: string; label: string | null; url: string; embed: EmbedSpec }
export interface EmbedOption { platform: string; targets: EmbedTarget[] }

export function embedOptions(groups: ReadonlyArray<{ label: string | null; links: ReadonlyArray<EmbedLink>; owner?: EmbedOwner }>, owner: EmbedOwner): EmbedOption[] {
  const byPlatform = new Map<string, EmbedTarget[]>();
  for (const group of groups) {
    for (const link of group.links) {
      const embed = embedFor(link, group.owner ?? owner);
      if (!embed) continue;
      const targets = byPlatform.get(link.platform) ?? [];
      if (targets.some((target) => target.embed.src === embed.src)) continue;
      targets.push({ key: `${link.platform}:${embed.src}`, label: group.label, url: link.url, embed });
      byPlatform.set(link.platform, targets);
    }
  }
  return [...byPlatform.entries()]
    .sort(([a], [b]) => orderOf(a, owner) - orderOf(b, owner))
    .map(([platform, targets]) => ({ platform, targets }));
}

function orderOf(platform: string, owner: EmbedOwner): number {
  const order: readonly string[] = owner === "artist" ? ARTIST_EMBED_ORDER : EMBED_ORDER;
  const index = order.indexOf(platform);
  return index < 0 ? order.length : index;
}

/** La plataforma que la persona eligió la última vez, si este disco o artista la tiene. */
export function preferredPlatform(available: readonly string[], stored: string | null): string | null {
  if (stored && available.includes(stored)) return stored;
  return available[0] ?? null;
}
