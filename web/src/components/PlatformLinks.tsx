import type { ComponentType, CSSProperties } from "react";
import {
  AmazonLogo, AppleLogo, Butterfly, FacebookLogo, GlobeSimple, InstagramLogo, LinkSimple, SoundcloudLogo,
  SpotifyLogo, Storefront, ThreadsLogo, TidalLogo, TiktokLogo, TreeStructure, XLogo, YoutubeLogo, type IconProps,
} from "@phosphor-icons/react";

// Deezer y Bandcamp no están en Phosphor: se dibujan en su misma retícula
// (256×256) y con su mismo trazo «regular» (16, redondeado) para que la fila
// se lea como una sola familia junto a los demás logos.
function DeezerLogo({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={16} strokeLinecap="round" aria-hidden="true">
      <line x1="40" y1="192" x2="40" y2="168" /><line x1="84" y1="192" x2="84" y2="128" />
      <line x1="128" y1="192" x2="128" y2="96" /><line x1="172" y1="192" x2="172" y2="136" />
      <line x1="216" y1="192" x2="216" y2="64" />
    </svg>
  );
}

function BandcampLogo({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={16} strokeLinejoin="round" aria-hidden="true">
      <path d="M88 72H232L168 184H24Z" />
    </svg>
  );
}

// YouTube Music tampoco: el disco con el «play» dentro, en la misma retícula.
function YoutubeMusicLogo({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={16} strokeLinejoin="round" aria-hidden="true">
      <circle cx="128" cy="128" r="96" /><circle cx="128" cy="128" r="56" /><path d="M112 104L152 128L112 152Z" />
    </svg>
  );
}

// Qobuz: su disco con la aguja (logo oficial, retícula 192). Los trazos se
// engrosan ×1,5 para igualar el peso «regular» de Phosphor a 16–20 px.
function QobuzLogo({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path strokeWidth={12} d="M140.672 157.486a76.004 76.004 0 0 1-102.464-12.128 76.001 76.001 0 0 1 107.15-107.15 76.004 76.004 0 0 1 12.128 102.464" />
      <path strokeWidth={12} d="M124.807 142.105a54.364 54.364 0 1 1 17.296-17.296" />
      <circle strokeWidth={12} cx="96" cy="96" r="21.193" />
      <circle fill="currentColor" stroke="none" cx="96" cy="96" r="5" />
      <path strokeWidth={17} d="m121.193 121.196 41.871 41.625" />
    </svg>
  );
}

export interface Platform { label: string; color: string; Icon: ComponentType<IconProps> }

// Color de marca: solo al pasar el cursor o enfocar; en reposo todos comparten
// el gris del tema para no romper la ficha.
const PLATFORMS: Record<string, Platform> = {
  crv_youtube: { label: "YouTube · CRV", color: "#ff0033", Icon: YoutubeLogo },
  spotify: { label: "Spotify", color: "#1db954", Icon: SpotifyLogo },
  apple_music: { label: "Apple Music", color: "#fa2d48", Icon: AppleLogo },
  deezer: { label: "Deezer", color: "#a238ff", Icon: DeezerLogo },
  youtube: { label: "YouTube", color: "#ff0033", Icon: YoutubeLogo },
  youtube_music: { label: "YouTube Music", color: "#ff0033", Icon: YoutubeMusicLogo },
  tidal: { label: "Tidal", color: "#f5f5f5", Icon: TidalLogo },
  amazon_music: { label: "Amazon Music", color: "#25d1da", Icon: AmazonLogo },
  // Qobuz es monocromo (negro sobre blanco / blanco sobre negro): en los temas oscuros, blanco.
  qobuz: { label: "Qobuz", color: "#ffffff", Icon: QobuzLogo },
  bandcamp: { label: "Bandcamp", color: "#629aa9", Icon: BandcampLogo },
  soundcloud: { label: "SoundCloud", color: "#ff5500", Icon: SoundcloudLogo },
  instagram: { label: "Instagram", color: "#e1306c", Icon: InstagramLogo },
  facebook: { label: "Facebook", color: "#1877f2", Icon: FacebookLogo },
  x: { label: "X", color: "#f5f5f5", Icon: XLogo },
  tiktok: { label: "TikTok", color: "#25f4ee", Icon: TiktokLogo },
  threads: { label: "Threads", color: "#f5f5f5", Icon: ThreadsLogo },
  bluesky: { label: "Bluesky", color: "#0085ff", Icon: Butterfly },
  website: { label: "Web", color: "var(--text)", Icon: GlobeSimple },
  store: { label: "Tienda", color: "var(--text)", Icon: Storefront },
  linktree: { label: "Linktree", color: "#39e09b", Icon: TreeStructure },
};

// Orden fijo: primero las plataformas de escucha más usadas, luego las redes.
const ORDER = Object.keys(PLATFORMS);

/** «Escuchar en» solo tiene sentido para plataformas de audio; una tienda se visita y una red se sigue. */
const SOCIAL_LIKE = new Set(["website", "store", "linktree", "instagram", "facebook", "x", "tiktok", "threads", "bluesky"]);
export function linkAction(platform: string, label: string): string {
  if (platform === "website") return "Visitar web";
  if (platform === "store") return "Ir a la tienda";
  if (platform === "linktree") return "Ver todos los enlaces";
  return SOCIAL_LIKE.has(platform) ? `Seguir en ${label}` : `Escuchar en ${label}`;
}

export interface PlatformLink { platform: string; url: string; handle?: string | null; externalId?: string | null }

export function platformMeta(platform: string): Platform {
  return PLATFORMS[platform] ?? { label: platform, color: "var(--text)", Icon: LinkSimple };
}

export function platformLabel(platform: string): string {
  return PLATFORMS[platform]?.label ?? platform;
}

/**
 * Fila de iconos enlazados a las plataformas de escucha o redes de una ficha.
 * `small` es la variante en línea del encabezado de cada disco.
 */
export function PlatformLinks({ links, subject, size = "regular", showLabels = false }: { links: PlatformLink[]; subject: string; size?: "regular" | "small"; showLabels?: boolean }) {
  if (links.length === 0) return null;
  const sorted = [...links].sort((a, b) => {
    const ia = ORDER.indexOf(a.platform), ib = ORDER.indexOf(b.platform);
    return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib);
  });
  return (
    <ul className={`platform-links${size === "small" ? " platform-links--small" : ""}${showLabels ? " platform-links--labeled" : ""}`}>
      {sorted.map((link) => {
        const platform = PLATFORMS[link.platform];
        const Icon = platform?.Icon ?? LinkSimple;
        const label = platform?.label ?? link.platform;
        const title = link.handle ? `${label} · @${link.handle}` : label;
        return (
          <li key={link.platform}>
            <a className="platform-links__item" href={link.url} target="_blank" rel="noreferrer noopener"
              title={title} aria-label={`${subject}: ${linkAction(link.platform, label)}`}
              style={{ "--platform-color": platform?.color ?? "var(--text)" } as CSSProperties}>
              <Icon size={size === "small" ? 16 : 20} />
              {showLabels ? <span>{linkAction(link.platform, label)}</span> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
