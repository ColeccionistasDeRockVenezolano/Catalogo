// CRV · Configuración del proyecto (Fase 2.1).
//
// Es la parte administrativa que gobierna el sitio público: nombre, visibilidad
// del roadmap, idioma por defecto, candidaturas, acceso y contador. La lectura
// pública solo expone lo que el documento estático necesita para adaptarse; la
// escritura queda reservada a una cuenta de administración total.
import { getPool } from "../../db/client.js";
import { ApiError } from "../http-errors.js";
import { projectId } from "../community/store.js";

export type ProjectVisibility = "hidden" | "progress" | "completed" | "full";
export type ProjectLang = "es" | "en";

export interface ProjectConfig {
  id: number;
  name: string;
  visibility: ProjectVisibility;
  defaultLang: ProjectLang;
  acceptsApplications: boolean;
  showLogin: boolean;
  visitorCounter: boolean;
  updatedAt: string | null;
  site: PublicSiteSkin;
}

/**
 * Piel pública del proyecto (CP0 parcial): lo que la portada necesita para
 * pintarse desde los datos sin rebuild. `heroTitleHtml` es el único HTML y se
 * sanea aquí: solo se permiten <br>, <em>, <strong> y <span>.
 */
export interface PublicSiteSkin {
  theme: {
    heroTitleHtml?: string;
    heroSubPublic?: string;
    landingHeadline?: string;
    footerNote?: string;
    fontTitle?: string;
    fontBody?: string;
    colors?: Record<string, string>;
  };
  branding: {
    metaTitle?: string;
    metaDescription?: string;
    ogTitle?: string;
    ogDescription?: string;
    siteUrl?: string;
    twitterSite?: string;
  };
  translations: Record<string, {
    heroTitleHtml?: string;
    heroSubPublic?: string;
    landingHeadline?: string;
    footerNote?: string;
    metaDescription?: string;
  }>;
}

export interface PublicProjectConfig {
  name: string;
  visibility: ProjectVisibility;
  defaultLang: ProjectLang;
  acceptsApplications: boolean;
  showLogin: boolean;
  visitorCounter: boolean;
  site: PublicSiteSkin;
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/iu;

function text(value: unknown, max = 600): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : undefined;
}

/** El título del hero admite <br> y énfasis; cualquier otra etiqueta se cae. */
export function sanitizeHeroHtml(value: unknown): string | undefined {
  const raw = text(value, 400);
  if (!raw) return undefined;
  const stripped = raw.replace(/<[^>]*>|</gu, (tag) => {
    if (tag === "<") return "&lt;";
    const match = /^<\s*(\/?)\s*(br|em|strong|span)\b[^>]*>$/iu.exec(tag);
    if (!match) return "";
    const name = match[2]!.toLowerCase();
    if (name === "br") return match[1] ? "" : "<br>";
    return `<${match[1]}${name}>`;
  });
  return stripped.replace(/\s+/gu, " ").trim() || undefined;
}

function colors(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string" || !HEX_COLOR.test(raw.trim())) continue;
    if (!/^[a-z][a-z0-9-]{0,24}$/iu.test(key)) continue;
    out[key] = raw.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** En esta base los JSON del proyecto viven en columnas TEXT: se parsean. */
function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function toPublicSiteSkin(themeJson: unknown, brandingJson: unknown, i18nJson: unknown): PublicSiteSkin {
  const theme = asObject(themeJson);
  const branding = asObject(brandingJson);
  const i18n = asObject(i18nJson);

  const heroHtml = sanitizeHeroHtml(theme["heroTitleHtml"]);
  const themeColors = colors(theme["colors"]);
  const themeOut: PublicSiteSkin["theme"] = {};
  if (heroHtml) themeOut.heroTitleHtml = heroHtml;
  const heroSub = text(theme["heroSubPublic"]); if (heroSub) themeOut.heroSubPublic = heroSub;
  const headline = text(theme["landingHeadline"]); if (headline) themeOut.landingHeadline = headline;
  const footerNote = text(theme["footerNote"]); if (footerNote) themeOut.footerNote = footerNote;
  const fontTitle = text(theme["fontTitle"]); if (fontTitle) themeOut.fontTitle = fontTitle;
  const fontBody = text(theme["fontBody"]); if (fontBody) themeOut.fontBody = fontBody;
  if (themeColors) themeOut.colors = themeColors;

  const brandingOut: PublicSiteSkin["branding"] = {};
  const metaTitle = text(branding["metaTitle"], 200); if (metaTitle) brandingOut.metaTitle = metaTitle;
  const metaDescription = text(branding["metaDescription"]); if (metaDescription) brandingOut.metaDescription = metaDescription;
  const ogTitle = text(branding["ogTitle"], 200); if (ogTitle) brandingOut.ogTitle = ogTitle;
  const ogDescription = text(branding["ogDescription"]); if (ogDescription) brandingOut.ogDescription = ogDescription;
  const siteUrl = text(branding["siteUrl"], 300); if (siteUrl) brandingOut.siteUrl = siteUrl;
  const twitterSite = text(branding["twitterSite"], 80); if (twitterSite) brandingOut.twitterSite = twitterSite;

  const translations: PublicSiteSkin["translations"] = {};
  for (const [lang, value] of Object.entries(i18n)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const translatedHero = sanitizeHeroHtml(entry["heroTitleHtml"]);
    const translatedSub = text(entry["heroSubPublic"]);
    const translatedHeadline = text(entry["landingHeadline"]);
    const translatedFooter = text(entry["footerNote"]);
    const translatedMeta = text(entry["metaDescription"]);
    translations[lang] = {
      ...(translatedHero ? { heroTitleHtml: translatedHero } : {}),
      ...(translatedSub ? { heroSubPublic: translatedSub } : {}),
      ...(translatedHeadline ? { landingHeadline: translatedHeadline } : {}),
      ...(translatedFooter ? { footerNote: translatedFooter } : {}),
      ...(translatedMeta ? { metaDescription: translatedMeta } : {}),
    };
  }
  return { theme: themeOut, branding: brandingOut, translations };
}

const VISIBILITY: readonly ProjectVisibility[] = ["hidden", "progress", "completed", "full"];
const LANGS: readonly ProjectLang[] = ["es", "en"];

function rowToConfig(row: {
  id: number; name: string; visibility_mode: string; default_lang: string;
  accepts_applications: number; show_login: number; visitor_counter: number; updated_at: string | null;
  theme_json: unknown; branding_json: unknown; i18n_json: unknown;
}): ProjectConfig {
  return {
    id: row.id,
    name: row.name,
    visibility: VISIBILITY.includes(row.visibility_mode as ProjectVisibility)
      ? row.visibility_mode as ProjectVisibility : "hidden",
    defaultLang: LANGS.includes(row.default_lang as ProjectLang)
      ? row.default_lang as ProjectLang : "es",
    acceptsApplications: row.accepts_applications === 1,
    showLogin: row.show_login === 1,
    visitorCounter: row.visitor_counter === 1,
    updatedAt: row.updated_at,
    site: toPublicSiteSkin(row.theme_json, row.branding_json, row.i18n_json),
  };
}

const SELECT = `
  SELECT id, name, visibility_mode, default_lang, accepts_applications,
         show_login, visitor_counter, updated_at,
         theme_json, branding_json, i18n_json
    FROM auth.projects WHERE id = $1`;

export async function getProjectConfig(): Promise<ProjectConfig> {
  const id = await projectId();
  const { rows } = await getPool().query(SELECT, [id]);
  const row = rows[0];
  if (!row) throw new ApiError(404, "project_not_found", "No existe el proyecto de CRV.");
  return rowToConfig(row);
}

export function toPublicProjectConfig(config: ProjectConfig): PublicProjectConfig {
  return {
    name: config.name,
    visibility: config.visibility,
    defaultLang: config.defaultLang,
    acceptsApplications: config.acceptsApplications,
    showLogin: config.showLogin,
    visitorCounter: config.visitorCounter,
    site: config.site,
  };
}

export async function getPublicProjectConfig(): Promise<PublicProjectConfig> {
  return toPublicProjectConfig(await getProjectConfig());
}

export async function applicationsOpen(): Promise<boolean> {
  return (await getProjectConfig()).acceptsApplications;
}

export interface UpdateProjectConfigInput {
  name: string;
  visibility: ProjectVisibility;
  defaultLang: ProjectLang;
  acceptsApplications: boolean;
  showLogin: boolean;
  visitorCounter: boolean;
}

export async function updateProjectConfig(input: UpdateProjectConfigInput): Promise<ProjectConfig> {
  const id = await projectId();
  const name = input.name.trim();
  if (!name || name.length > 120) {
    throw new ApiError(400, "invalid_name", "El nombre del proyecto es obligatorio y debe tener como máximo 120 caracteres.");
  }
  if (!VISIBILITY.includes(input.visibility)) {
    throw new ApiError(400, "invalid_visibility", "Modo de visibilidad inválido.");
  }
  if (!LANGS.includes(input.defaultLang)) {
    throw new ApiError(400, "invalid_lang", "Idioma por defecto inválido.");
  }
  const { rows } = await getPool().query(
    `UPDATE auth.projects
        SET name = $2,
            visibility_mode = $3,
            default_lang = $4,
            accepts_applications = $5,
            show_login = $6,
            visitor_counter = $7,
            updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      WHERE id = $1
      RETURNING id, name, visibility_mode, default_lang, accepts_applications,
                show_login, visitor_counter, updated_at`,
    [id, name, input.visibility, input.defaultLang,
      input.acceptsApplications ? 1 : 0, input.showLogin ? 1 : 0, input.visitorCounter ? 1 : 0],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, "project_not_found", "No existe el proyecto de CRV.");
  return rowToConfig(row);
}
