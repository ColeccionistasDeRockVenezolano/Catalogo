import { readFile } from "node:fs/promises";
import path from "node:path";
import ejs from "ejs";
import { loadLandingData } from "./data.js";
import { clientMessages, translate, type LandingLanguage } from "./i18n.js";
import { withFontFallbacks } from "./theme.js";
import { defaultPageMeta, hasSocialPresence, pageMeta } from "./branding.js";
import { getPlatform, platformLabel, socialIcon, socialLinkLabel } from "./social-icons.js";
import { faviconDataUri, formatDateTime, formatNumber, isoDateTime, jsonLd, pctBar, pctText, phaseLabel, statusLabel } from "./view-helpers.js";
import { activationInfo, inviteInfo } from "../api/community/tokens.js";
import { ApiError } from "../api/http-errors.js";

export type LandingPage = "roadmap" | "colaborar" | "login" | "registro" | "activar";
interface LandingSession { name: string; role: string; userId: number | null; csrf: string }
const templates: Record<LandingPage, string> = { roadmap: "roadmap", colaborar: "collaborate", login: "user-login", registro: "register", activar: "activate" };
const rawTranslatedKeys = new Set(["register.doneSub", "register.invalidSub", "register.sub", "activate.invalidSub", "activate.subNamed", "activate.sub", "userLogin.sub"]);
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Genera el documento de Herra con lecturas de la base del catálogo. */
export async function renderLanding(page: LandingPage, lang: LandingLanguage, token = "", session: LandingSession | null = null): Promise<string> {
  const data = await loadLandingData(lang, page, session !== null);
  const projectAdmin = Boolean(session && (session.role === "admin" || session.role === "community"));
  const currentUser = session ? { id: session.userId ?? 0, name: session.name } : null;
  let valid = false;
  let user: Awaited<ReturnType<typeof activationInfo>> | null = null;
  if (token && page === "registro") valid = (await inviteInfo(data.project.id, token)).valid;
  if (token && page === "activar") {
    try { user = await activationInfo(data.project.id, token); valid = true; }
    catch (error) { if (!(error instanceof ApiError) || error.statusCode !== 404) throw error; }
  }
  const root = path.join(process.cwd(), "src", "landing");
  const publicCriticalCss = (await readFile(path.join(root, "roadmap-critical.min.css"), "utf8")).replaceAll("__HERRA_STATIC__", "/static");
  const origin = data.branding.siteUrl.replace(/\/$/u, "") || "http://localhost";
  const t = (key: string, vars?: Record<string, string | number>) => {
    const safe = vars && rawTranslatedKeys.has(key)
      ? Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, typeof value === "string" ? escapeHtml(value) : value]))
      : vars;
    return translate(lang, key, safe);
  };
  const langOptions = (["es", "en"] as const).map((code) => ({ code, label: code.toUpperCase(), name: code === "es" ? "Español" : "English", current: code === lang, url: `/${page}?lang=${code}${token ? `&token=${encodeURIComponent(token)}` : ""}` }));
  const locals = {
    ...data, lang, t, langOptions, ogLocale: lang === "es" ? "es_ES" : "en_US", publicCriticalCss,
    assetVersion: "1.1.39", basePath: "", projectBase: "", pageOrigin: origin, canonicalUrl: `${origin}/${page === "roadmap" ? "" : page}`,
    showLoginLinks: data.project.show_login === 1, showVisitCounter: data.project.visitor_counter === 1,
    visibilityMode: session ? "full" : data.project.visibility_mode, isAdmin: false, projectAdmin, currentUser,
    allowTaskStatusChanges: false, collaboratorCount: data.view?.collaborators ?? 0,
    csrfToken: session?.csrf ?? "", token, valid, user, error: null, success: false,
    values: { firstName: "", lastName: "", birthDate: "", whatsappPhone: "", email: "", city: "", country: "", contactPreference: "whatsapp", experience: "", contributionText: "", availability: "", idea: "", ideaReason: "", wantsToImplement: "maybe", skillIds: [], areaIds: [], links: [] },
    visitStats: () => data.visits, clientMessages, defaultPageMeta, pageMeta, hasSocialPresence,
    getPlatform, socialPlatform: getPlatform, platformLabel, socialIcon, socialLinkLabel, withFontFallbacks,
    statusLabel, phaseLabel, pctText, pctBar, formatDateTime, formatNumber, isoDateTime, jsonLd, faviconDataUri,
    shortDisplayName: (person: { name: string }) => person.name,
    appName: "Herra", registrationTokenTtlMin: 30,
  };
  const html = await ejs.renderFile(path.join(root, "views", `${templates[page]}.ejs`), locals) as string;
  const c = data.theme.colors;
  const css = `:root{--bg:${c.bg};--surface:${c.surface};--surface-2:${c.surface2};--red:${c.red};--red-dark:${c.redDark};--white:${c.white};--gray:${c.gray};--border:${c.border};--accent-red:${c.accentRed};--accent-amber:${c.accentAmber};--accent-violet:${c.accentViolet};--accent-teal:${c.accentTeal};--font-title:${withFontFallbacks(data.theme.fontTitle)};--font-body:${withFontFallbacks(data.theme.fontBody)}}`;
  return html.replace("</head>", `<style>${css}</style></head>`);
}
