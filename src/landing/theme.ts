import { sanitizeHeroHtml } from "../api/project/config.js";

/** Valores de fábrica del tema; la administración los ve y los sustituye. */
export const themeDefaults = {
  projectName: "Proyecto", heroTitleHtml: "EL PROYECTO<br>AVANZA",
  heroSubPublic: "Aquí se muestra el avance del proyecto: qué se hará, qué está en marcha y qué ya está listo, con sus etapas de trabajo.",
  landingHeadline: "Así va el proyecto", brandBadgeLetter: "◆", footerNote: "Roadmap del equipo.",
  mainSiteUrl: "", mainSiteLabel: "Sitio principal", youtubeUrl: "", youtubeLabel: "Canal de YouTube",
  googleFontsUrl: "https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap",
  fontTitle: "'Anton', 'Arial Black', sans-serif", fontBody: "'Inter', system-ui, sans-serif",
  colors: { bg: "#0a0a0a", surface: "#141414", surface2: "#1c1c1c", red: "#e50914", redDark: "#8b0000", white: "#f5f5f5", gray: "#9a9a9a", border: "#242424", accentRed: "#e50914", accentAmber: "#ffb02e", accentViolet: "#b185e3", accentTeal: "#2ec4b6" },
};

type Theme = typeof themeDefaults;
type TextKey = Exclude<keyof Theme, "colors">;
const textKeys = Object.keys(themeDefaults).filter((key): key is TextKey => key !== "colors");
const translatedKeys: TextKey[] = ["heroTitleHtml", "heroSubPublic", "landingHeadline", "footerNote"];

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Resuelve el tema de Herra con los valores del proyecto y su traducción. */
export function resolveLandingTheme(name: string, raw: unknown, translation: unknown = {}): Theme {
  const values = object(raw);
  const translated = object(translation);
  const result: Theme = { ...themeDefaults, projectName: name, colors: { ...themeDefaults.colors } };
  for (const key of textKeys) {
    const value = values[key];
    if (typeof value !== "string" || value.length > 1000) continue;
    if ((key === "fontTitle" || key === "fontBody") && !/^[a-z\d\s,.'"_-]{1,200}$/iu.test(value)) continue;
    if (key === "heroTitleHtml") { result[key] = sanitizeHeroHtml(value) ?? result[key]; continue; }
    if (key.endsWith("Url") && value) {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || (key === "googleFontsUrl" && url.hostname !== "fonts.googleapis.com")) continue;
      } catch { continue; }
    }
    result[key] = value;
  }
  for (const [key, value] of Object.entries(object(values["colors"]))) {
    if (key in result.colors && typeof value === "string" && /^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/iu.test(value)) {
      result.colors[key as keyof Theme["colors"]] = value;
    }
  }
  if (typeof translated["name"] === "string" && translated["name"]) result.projectName = translated["name"];
  for (const key of translatedKeys) {
    const value = translated[key];
    if (typeof value !== "string" || !value) continue;
    result[key] = key === "heroTitleHtml" ? sanitizeHeroHtml(value) ?? result[key] : value;
  }
  return result;
}

export function withFontFallbacks(stack: string): string {
  return stack.replace(/(['"]?)(Anton|Inter)\1\s*,/g, (match: string, _quote: string, family: string) =>
    stack.includes(`${family} Fallback`) ? match : `${match} '${family} Fallback',`);
}
