import { translate, type LandingLanguage } from "./i18n.js";
import type { resolveLandingTheme } from "./theme.js";

function date(value: string): Date | null {
  const input = /Z$|[+-]\d\d:\d\d$/u.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const result = new Date(input);
  return Number.isNaN(result.getTime()) ? null : result;
}

export const statusLabel = (status: string, lang: LandingLanguage) => translate(lang, `status.${status === "completed" || status === "in_progress" ? status : "pending"}`);
export const phaseLabel = (index: number, lang: LandingLanguage) => translate(lang, "phase.label", { n: String(index).padStart(2, "0") });
export const pctText = (value: number) => `${Math.round(value)}%`;
export const pctBar = (value: number) => `${Math.max(0, Math.min(100, value)).toFixed(2)}%`;
export const formatNumber = (value: number, lang: LandingLanguage) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es-VE").format(value);
export const isoDateTime = (value: string) => date(value)?.toISOString() ?? value;
export function formatDateTime(value: string, lang: LandingLanguage): string {
  const parsed = date(value);
  return parsed ? new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-VE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Caracas" }).format(parsed) : value;
}
export const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export function faviconDataUri(theme: ReturnType<typeof resolveLandingTheme>): string {
  const letter = theme.brandBadgeLetter.slice(0, 2).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${theme.colors.bg}"/><text x="32" y="47" font-family="Arial Black,Arial" font-size="42" font-weight="900" fill="${theme.colors.red}" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
