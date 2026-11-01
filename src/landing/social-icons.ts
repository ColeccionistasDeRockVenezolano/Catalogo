import platformData from "./social-platforms.json" with { type: "json" };
import { translate, type LandingLanguage } from "./i18n.js";
import type { SocialLink } from "./branding.js";

interface Platform { key: string; label: string; labelKey?: string; color: string; hosts: string[]; body: string; filled?: boolean; donation?: boolean }
const platforms: Platform[] = platformData;
const fallback = platforms.find((item) => item.key === "link")!;

export function getPlatform(key: string): Platform {
  return platforms.find((item) => item.key === key) ?? fallback;
}

export function platformLabel(platform: Platform, lang: LandingLanguage = "es"): string {
  return platform.labelKey ? translate(lang, platform.labelKey) : platform.label;
}

export function socialLinkLabel(link: SocialLink, lang: LandingLanguage = "es"): string {
  return link.label || platformLabel(getPlatform(link.platform), lang);
}

export function socialIcon(key: string, className = "social-icon"): string {
  const platform = getPlatform(key);
  const presentation = platform.filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  const safeClass = className.replace(/[^a-zA-Z0-9 _-]/g, "");
  return `<svg class="${safeClass}" viewBox="0 0 24 24" width="24" height="24" ${presentation} aria-hidden="true" focusable="false">${platform.body}</svg>`;
}
