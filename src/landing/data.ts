import { getPool } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { ApiError } from "../api/http-errors.js";
import { projectId } from "../api/community/store.js";
import { publicRoadmap } from "../api/roadmap/store.js";
import { visitStats } from "../api/roadmap/visits.js";
import { loadRadioConfig, radioStationFromConfig, radioTexts } from "../shared/radio/config.js";
import { radioSnapshot } from "../shared/radio/engine.js";
import { radioListenerCount } from "../api/radio/listeners.js";
import { liveRadioSnapshot } from "./radio-card.js";
import { resolveLandingTheme } from "./theme.js";
import { resolveBranding } from "./branding.js";
import { resolveCollaborateForm, visibleSteps } from "./collaborate-form.js";
import type { LandingLanguage } from "./i18n.js";

interface ProjectRow {
  id: number; slug: string; name: string; theme_json: string | null; branding_json: string | null;
  i18n_json: string | null; collaborate_json: string | null; accepts_applications: number;
  show_login: number; visitor_counter: number; visibility_mode: string;
}
interface AssetRow { kind: string; mime_type: string; width: number | null; height: number | null; checksum: string }
interface CatalogRow { id: number; type: string; label: string; i18n_json: string | null }

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Carga solo datos públicos y no modifica la base. A Herra solo le lee lo que emite (GET), mientras sea ella quien emite. */
export async function loadLandingData(lang: LandingLanguage, page: "roadmap" | "colaborar" | "login" | "registro" | "activar" | "admin" | "account", authenticated = false) {
  const id = await projectId();
  const pool = getPool();
  const [projects, assets, terms, view, visits, radioConfig] = await Promise.all([
    pool.query<ProjectRow>("SELECT id, slug::text, name, theme_json, branding_json, i18n_json, collaborate_json, accepts_applications, show_login, visitor_counter, visibility_mode FROM auth.projects WHERE id = $1", [id]),
    pool.query<AssetRow>("SELECT kind, mime_type, width, height, checksum FROM auth.project_assets WHERE project_id = $1", [id]),
    pool.query<CatalogRow>("SELECT id, type, label, i18n_json FROM auth.catalog_terms WHERE archived_at IS NULL AND type IN ('skill', 'contribution_area', 'link_type') ORDER BY type, label"),
    page === "roadmap" ? publicRoadmap(id, lang, authenticated) : Promise.resolve(null),
    visitStats(id, lang), page === "roadmap" && getEnv().CRV_RADIO_ENABLED ? loadRadioConfig(id) : Promise.resolve(null),
  ]);
  const project = projects.rows[0];
  if (!project) throw new ApiError(404, "project_not_found", "No existe el proyecto.");
  if (page === "colaborar" && project.accepts_applications !== 1) {
    throw new ApiError(404, "applications_closed", "La convocatoria no está disponible.");
  }
  const translations = parseObject(project.i18n_json);
  const localized = lang === "en" && translations["en"] && typeof translations["en"] === "object" ? translations["en"] : {};
  const theme = resolveLandingTheme(project.name, project.theme_json, localized);
  const branding = resolveBranding(project.branding_json, localized);
  const form = resolveCollaborateForm(project.collaborate_json, lang, localized);
  const radio = radioConfig
    ? await liveRadioSnapshot(getEnv().CRV_RADIO_LIVE_URL) ?? radioSnapshot(radioStationFromConfig(radioConfig), Date.now(), radioListenerCount(id))
    : null;
  const projectAssets = Object.fromEntries(assets.rows.map((asset) => [asset.kind, { checksum: asset.checksum, mimeType: asset.mime_type, width: asset.width, height: asset.height }]));
  const group = (type: string) => terms.rows.filter((term) => term.type === type).map((term) => {
    const translationsForTerm = parseObject(term.i18n_json);
    const label = lang === "en" && typeof translationsForTerm["en"] === "string" && translationsForTerm["en"] ? translationsForTerm["en"] : term.label;
    return { id: term.id, label };
  }).sort((left, right) => left.label.localeCompare(right.label, lang, { sensitivity: "base" }));
  return { project, view, visits, theme, branding, form, steps: visibleSteps(form), projectAssets,
    catalog: { skills: group("skill"), areas: group("contribution_area"), linkTypes: group("link_type") },
    radio, radioTexts: radio && radioConfig ? radioTexts(radioConfig, lang) : null };
}
