import defaults from "./branding-defaults.json" with { type: "json" };
import { translate, type LandingLanguage } from "./i18n.js";

export interface SocialLink { platform: string; label: string; url: string }
type Branding = Omit<typeof defaults, "socialLinks"> & { socialLinks: SocialLink[] };

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeUrl(value: unknown, mail = false): string {
  if (typeof value !== "string" || value.length > 500) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" || (mail && url.protocol === "mailto:") ? value.trim() : "";
  } catch { return ""; }
}

export function resolveBranding(raw: unknown, translated: unknown = {}): Branding {
  const values = object(raw);
  const translations = object(translated);
  const result: Branding = { ...defaults, socialLinks: [], donation: { ...defaults.donation } };
  const target = result as unknown as Record<string, unknown>;
  const untranslated = new Set(["siteUrl", "aboutSourceUrl", "twitterSite", "twitterCard"]);
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof fallback !== "string") continue;
    let value = values[key];
    if (!untranslated.has(key) && typeof translations[key] === "string" && translations[key]) value = translations[key];
    if (typeof value !== "string" || value.length > 700) continue;
    if (key === "siteUrl" || key === "aboutSourceUrl") value = safeUrl(value);
    if (key === "twitterCard" && value !== "summary" && value !== "summary_large_image") continue;
    target[key] = value;
  }
  result.allowIndexing = values["allowIndexing"] === true || values["allowIndexing"] === "true";
  if (Array.isArray(values["socialLinks"])) {
    result.socialLinks = values["socialLinks"].slice(0, 12).flatMap((item: unknown) => {
      const entry = object(item);
      const platform = typeof entry["platform"] === "string" ? entry["platform"] : "";
      const url = safeUrl(entry["url"], platform === "email");
      if (!platform || !url) return [];
      const translation = translations[`social.${platform}`];
      const label = typeof translation === "string" && translation ? translation : typeof entry["label"] === "string" ? entry["label"].slice(0, 120) : "";
      return [{ platform, url, label }];
    });
  }
  const donation = object(values["donation"]);
  result.donation.enabled = donation["enabled"] === true;
  result.donation.url = safeUrl(donation["url"]);
  for (const key of ["platform", "label", "note"] as const) {
    const translatedValue = translations[key === "label" ? "donationLabel" : "donationNote"];
    const value = key !== "platform" && typeof translatedValue === "string" && translatedValue ? translatedValue : donation[key];
    if (typeof value === "string" && value.length <= 700) result.donation[key] = value;
  }
  return result;
}

export function defaultPageMeta(project: string, lang: LandingLanguage) {
  return { title: translate(lang, "meta.defaultTitle", { project }), description: translate(lang, "meta.defaultDescription", { project }) };
}

export function pageMeta(branding: Branding, fallback: { title: string; description: string }, options: { indexable?: boolean } = {}) {
  const title = branding.metaTitle || fallback.title;
  const description = branding.metaDescription || fallback.description;
  return { title, description, ogTitle: branding.ogTitle || title, ogDescription: branding.ogDescription || description,
    keywords: branding.keywords, imageAlt: branding.imageAlt || title, twitterCard: branding.twitterCard,
    twitterSite: branding.twitterSite, noindex: options.indexable === false || !branding.allowIndexing };
}

export function hasSocialPresence(branding: Branding): boolean {
  return branding.socialLinks.length > 0 || (branding.donation.enabled && branding.donation.url !== "");
}
