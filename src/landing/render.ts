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
import { adminViewLocals, catalogGroups, collaborationGaps, displayName, getPersonProfile, projectRow, shortDisplayName } from "./admin-panel.js";
import { clientMessages as herraClientMessages, translate as herraTranslate } from "./herra/i18n.js";
import { getPool } from "../db/client.js";
import { ACTIVATION_TTL_DAYS } from "../api/community/validation.js";

export type LandingPage = "roadmap" | "colaborar" | "login" | "registro" | "activar" | "admin" | "account" | "radio-embed";
export type AccountSaved = "profile" | "password" | "both";
interface LandingSession { name: string; role: string; userId: number | null; adminId?: number | null; csrf: string }
const templates: Record<LandingPage, string> = { "radio-embed": "radio-embed", roadmap: "roadmap", colaborar: "collaborate", login: "user-login", registro: "register", activar: "activate", admin: "admin", account: "account" };
const rawTranslatedKeys = new Set(["register.doneSub", "register.invalidSub", "register.sub", "activate.invalidSub", "activate.subNamed", "activate.sub", "userLogin.sub"]);
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** La plantilla del panel usa el diccionario completo de Herra y las filas con su forma. */
async function adminLocals(locals: Record<string, unknown>, id: number, lang: LandingLanguage, session: LandingSession | null): Promise<Record<string, unknown>> {
  const project = await projectRow(id);
  const admin = session?.adminId
    ? (await getPool().query<{ username: string; user_id: number | null }>("SELECT username::text AS username, user_id FROM auth.admins WHERE id = $1", [session.adminId])).rows[0]
    : undefined;
  const ownerId = session?.userId ?? admin?.user_id ?? null;
  const owner = ownerId
    ? (await getPool().query("SELECT id, name::text AS name, first_name, last_name FROM auth.users WHERE id = $1", [ownerId])).rows[0]
    : null;
  // Quien entró con su clave de colaborador también tiene nombre de administración.
  const linkedAdmin = !admin && ownerId
    ? (await getPool().query<{ username: string }>("SELECT username::text AS username FROM auth.admins WHERE user_id = $1 ORDER BY id LIMIT 1", [ownerId])).rows[0]
    : undefined;
  return {
    ...locals, ...(await adminViewLocals(project, lang)), project,
    t: (key: string, vars?: Record<string, string | number>) => herraTranslate(lang, key, vars),
    clientMessages: herraClientMessages, displayName, shortDisplayName, collaborationGaps,
    currentUser: owner ?? (session ? { id: 0, name: session.name } : null),
    currentAdmin: session?.role === "admin" ? { role: "admin", username: admin?.username ?? linkedAdmin?.username ?? session.name } : null,
    activationTtlDays: ACTIVATION_TTL_DAYS,
    showRadio: false, showMap: false, showContextLinks: false,
  };
}

/**
 * TEMPORAL-PORTADA: «Mi perfil» 1:1 de Herra para la portada sin catálogo. Lee las
 * mismas filas que el /cuenta del catálogo; ver docs/independencia/PUERTA-TEMPORAL.md.
 */
async function accountLocals(locals: Record<string, unknown>, lang: LandingLanguage, session: LandingSession, saved: AccountSaved | null): Promise<Record<string, unknown>> {
  const admin = session.adminId
    ? (await getPool().query<{ user_id: number | null }>("SELECT user_id FROM auth.admins WHERE id = $1", [session.adminId])).rows[0]
    : undefined;
  const ownerId = session.userId ?? admin?.user_id ?? null;
  const owner = ownerId
    ? (await getPool().query("SELECT id, name::text AS name, first_name, last_name, person_id FROM auth.users WHERE id = $1", [ownerId])).rows[0]
    : null;
  const profile = owner?.person_id ? await getPersonProfile(owner.person_id as number, lang) : null;
  return {
    ...locals,
    t: (key: string, vars?: Record<string, string | number>) => herraTranslate(lang, key, vars),
    clientMessages: herraClientMessages, displayName, shortDisplayName, escapeHtml,
    currentUser: owner ?? { id: 0, name: session.name, first_name: "", last_name: "", person_id: null },
    isAdmin: false, profile,
    catalog: await catalogGroups(lang),
    selectedTermIds: profile ? (profile["terms"] as Array<{ id: number }>).map((term) => term.id) : [],
    profileError: null, passwordError: null,
    profileSuccess: saved === "profile" || saved === "both", passwordSuccess: saved === "password" || saved === "both",
    showRadio: false, showMap: false, showContextLinks: false,
  };
}

/** Genera el documento de Herra con lecturas de la base del catálogo. */
export async function renderLanding(page: LandingPage, lang: LandingLanguage, token = "", session: LandingSession | null = null, landingMode = false, saved: AccountSaved | null = null, country: string | null = null): Promise<string> {
  const data = await loadLandingData(lang, page, session !== null, country);
  if (page === "radio-embed" && !data.radio) throw new ApiError(404, "radio_unavailable", "La radio no está disponible.");
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
  const langOptions = (["es", "en"] as const).map((code) => ({ code, label: code.toUpperCase(), name: code === "es" ? "Español" : "English", current: code === lang, url: `/${page === "admin" ? (landingMode ? "admin" : "curaduria/roadmap") : page}?lang=${code}${token ? `&token=${encodeURIComponent(token)}` : ""}` }));
  const locals = {
    ...data, lang, t, langOptions, ogLocale: lang === "es" ? "es_ES" : "en_US", publicCriticalCss,
    assetVersion: "1.1.39", radioClientVersion: "crv-2026-11-03", basePath: "", projectBase: "", pageOrigin: origin, canonicalUrl: `${origin}/${page === "roadmap" ? "" : page}`,
    showLoginLinks: data.project.show_login === 1, showVisitCounter: data.project.visitor_counter === 1,
    visibilityMode: session ? "full" : data.project.visibility_mode, isAdmin: false, projectAdmin, currentUser,
    landingMode,
    allowTaskStatusChanges: false, collaboratorCount: data.view?.collaborators ?? 0,
    csrfToken: session?.csrf ?? "", token, valid, user, error: null, success: false,
    values: { firstName: "", lastName: "", birthDate: "", whatsappPhone: "", email: "", city: "", country: "", contactPreference: "whatsapp", experience: "", contributionText: "", availability: "", idea: "", ideaReason: "", wantsToImplement: "maybe", skillIds: [], areaIds: [], links: [] },
    visitStats: () => data.visits, clientMessages, defaultPageMeta, pageMeta, hasSocialPresence,
    getPlatform, socialPlatform: getPlatform, platformLabel, socialIcon, socialLinkLabel, withFontFallbacks,
    statusLabel, phaseLabel, pctText, pctBar, formatDateTime, formatNumber, isoDateTime, jsonLd, faviconDataUri,
    shortDisplayName: (person: { name: string }) => person.name,
    appName: "Herra", registrationTokenTtlMin: 30,
  };
  const viewLocals = page === "admin" ? await adminLocals(locals, data.project.id, lang, session)
    : page === "account" && session ? await accountLocals(locals, lang, session, saved)
      : locals;
  const html = await ejs.renderFile(path.join(root, "views", `${templates[page]}.ejs`), viewLocals) as string;
  const c = data.theme.colors;
  const css = `:root{--bg:${c.bg};--surface:${c.surface};--surface-2:${c.surface2};--red:${c.red};--red-dark:${c.redDark};--white:${c.white};--gray:${c.gray};--border:${c.border};--accent-red:${c.accentRed};--accent-amber:${c.accentAmber};--accent-violet:${c.accentViolet};--accent-teal:${c.accentTeal};--font-title:${withFontFallbacks(data.theme.fontTitle)};--font-body:${withFontFallbacks(data.theme.fontBody)}}`;
  return html.replace("</head>", `<style>${css}</style></head>`);
}
