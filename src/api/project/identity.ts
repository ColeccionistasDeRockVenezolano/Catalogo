// CRV · Identidad y compartir (3.10), idiomas del proyecto (3.11) y tema (3.12).
//
// Los textos viven en `auth.projects.branding_json` y `theme_json`; las
// traducciones del proyecto, en `i18n_json` bajo la clave del idioma
// (`{"en": {...}}`). Las imágenes (favicon y tarjeta al compartir) van a
// `auth.project_assets` y se sirven en `/landing-media/:kind`.
//
// Aquí solo se guarda lo que el proyecto entiende: claves conocidas, textos
// con tope, URLs http(s) y colores hex. La portada las resuelve con
// `resolveLandingTheme`, `resolveBranding` y `resolveCollaborateForm`, que
// siguen siendo la única fuente de valores por defecto.
import brandingDefaults from "../../landing/branding-defaults.json" with { type: "json" };
import { themeDefaults } from "../../landing/theme.js";
import { getPool } from "../../db/client.js";
import { ApiError } from "../http-errors.js";
import { projectId } from "../community/store.js";
import { sanitizeHeroHtml } from "./config.js";
import { createHash } from "node:crypto";

const MAX_TEXT = 1_000;
const MAX_URL = 500;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
const TWITTER_CARDS = ["summary", "summary_large_image"] as const;

export const ASSET_KINDS = ["favicon", "share_image"] as const;
export type AssetKind = typeof ASSET_KINDS[number];

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeUrl(value: unknown, mail = false): string | null {
  if (typeof value !== "string" || value.length > MAX_URL) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" || (mail && url.protocol === "mailto:") ? value.trim() : null;
  } catch { return null; }
}

function text(value: unknown, max = 700): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().slice(0, max);
  return clean === "" ? "" : clean;
}

export interface BrandingSave {
  metaTitle?: string; metaDescription?: string; keywords?: string; ogTitle?: string; ogDescription?: string;
  imageAlt?: string; twitterCard?: string; twitterSite?: string; siteUrl?: string; allowIndexing?: boolean;
  aboutTitle?: string; aboutDescription?: string; aboutStatus?: string; aboutScope?: string;
  aboutSourceUrl?: string; aboutSourceLabel?: string;
  faqTitle?: string; faq1Question?: string; faq1Answer?: string; faq2Question?: string; faq2Answer?: string;
  faq3Question?: string; faq3Answer?: string; faq4Question?: string; faq4Answer?: string;
  supportKicker?: string; supportTitle?: string; supportSub?: string;
  socialLinks?: Array<{ platform?: string; label?: string; url?: string }>;
  donation?: { enabled?: boolean; platform?: string; label?: string; url?: string; note?: string };
}

/** Solo las claves que existen en la identidad pública, saneadas. */
export function sanitizeBranding(input: unknown): Record<string, unknown> {
  const raw = object(input);
  if (input === null || (typeof input !== "object")) {
    if (typeof input !== "string") throw new ApiError(400, "invalid_branding", "La identidad no es un objeto válido.");
  }
  const clean: Record<string, unknown> = {};
  const keys = Object.keys(brandingDefaults as Record<string, unknown>)
    .filter((key) => key !== "socialLinks" && key !== "donation" && key !== "allowIndexing");
  for (const key of keys) {
    if (!(key in raw)) continue;
    const value = text(raw[key]);
    if (value === undefined) continue;
    if (key === "siteUrl" || key === "aboutSourceUrl") {
      const url = value === "" ? "" : safeUrl(value);
      if (url === null) throw new ApiError(400, "invalid_url", `La dirección de ${key} no es válida.`);
      clean[key] = url;
      continue;
    }
    if (key === "twitterCard" && !(TWITTER_CARDS as readonly string[]).includes(value)) continue;
    clean[key] = value;
  }
  if (typeof raw["allowIndexing"] === "boolean") clean["allowIndexing"] = raw["allowIndexing"];
  if (Array.isArray(raw["socialLinks"])) {
    const links = raw["socialLinks"].slice(0, 12).flatMap((item) => {
      const entry = object(item);
      const platform = typeof entry["platform"] === "string" ? entry["platform"].trim().slice(0, 40) : "";
      const url = safeUrl(entry["url"], platform === "email");
      if (!platform || !url) return [];
      const label = typeof entry["label"] === "string" ? entry["label"].trim().slice(0, 120) : "";
      return [{ platform, label, url }];
    });
    clean["socialLinks"] = links;
  }
  if (raw["donation"] && typeof raw["donation"] === "object") {
    const donation = object(raw["donation"]);
    const out: Record<string, unknown> = {};
    if (typeof donation["enabled"] === "boolean") out["enabled"] = donation["enabled"];
    for (const key of ["platform", "label", "note"] as const) {
      const value = text(donation[key]);
      if (value !== undefined) out[key] = value;
    }
    if ("url" in donation) {
      const url = donation["url"] === "" ? "" : safeUrl(donation["url"]);
      if (url === null) throw new ApiError(400, "invalid_url", "La dirección de la donación no es válida.");
      out["url"] = url;
    }
    clean["donation"] = out;
  }
  return clean;
}

export interface ThemeSave {
  heroTitleHtml?: string; heroSubPublic?: string; landingHeadline?: string; footerNote?: string;
  brandBadgeLetter?: string; mainSiteUrl?: string; mainSiteLabel?: string; youtubeUrl?: string;
  youtubeLabel?: string; googleFontsUrl?: string; fontTitle?: string; fontBody?: string;
  colors?: Record<string, string>;
}

const THEME_TEXT_KEYS = Object.keys(themeDefaults as Record<string, unknown>).filter((key) => key !== "colors" && key !== "projectName");
const FONT = /^[a-z\d\s,.'"_-]{1,200}$/iu;

export function sanitizeTheme(input: unknown): Record<string, unknown> {
  const raw = typeof input === "string" ? (() => { try { return JSON.parse(input) as unknown; } catch { return null; } })() : input;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "invalid_theme", "El tema no es un objeto válido.");
  }
  const values = raw as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const key of THEME_TEXT_KEYS) {
    if (!(key in values)) continue;
    const value = text(values[key], MAX_TEXT);
    if (value === undefined) continue;
    if (key === "heroTitleHtml") { clean[key] = sanitizeHeroHtml(value) ?? ""; continue; }
    if (key === "fontTitle" || key === "fontBody") {
      if (value && !FONT.test(value)) continue;
      clean[key] = value;
      continue;
    }
    if (key.endsWith("Url") && value) {
      const url = safeUrl(value);
      if (!url || !url.startsWith("https:")) continue;
      if (key === "googleFontsUrl" && !url.includes("fonts.googleapis.com")) continue;
      clean[key] = url;
      continue;
    }
    clean[key] = value;
  }
  if (values["colors"] && typeof values["colors"] === "object" && !Array.isArray(values["colors"])) {
    const palette: Record<string, string> = {};
    const known = Object.keys((themeDefaults as { colors: Record<string, string> }).colors);
    for (const [key, value] of Object.entries(values["colors"] as Record<string, unknown>)) {
      if (!known.includes(key) || typeof value !== "string" || !HEX.test(value.trim())) continue;
      palette[key] = value.trim();
    }
    clean["colors"] = palette;
  }
  return clean;
}

/** Traducciones del proyecto: `{"en": {clave: texto}}`. */
export function sanitizeProjectI18n(input: unknown): Record<string, Record<string, string>> {
  const raw = object(input);
  const out: Record<string, Record<string, string>> = {};
  for (const [lang, dict] of Object.entries(raw)) {
    if (!/^[a-z]{2}$/u.test(lang) || lang === "es") continue;
    const values = object(dict);
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!/^[a-z][a-zA-Z0-9.]{0,60}$/u.test(key)) continue;
      if (typeof value !== "string" || value.length > MAX_TEXT) continue;
      if (value.trim() === "") continue;
      clean[key] = key === "heroTitleHtml" ? (sanitizeHeroHtml(value) ?? "") : value;
    }
    out[lang] = clean;
  }
  return out;
}

// ---------------------------------------------------------------- lectura

export interface ProjectAsset {
  kind: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksum: string;
}

export interface IdentityData {
  theme: Record<string, unknown>;
  branding: Record<string, unknown>;
  i18n: Record<string, unknown>;
  assets: { favicon: ProjectAsset | null; share_image: ProjectAsset | null };
  themeDefaults: Record<string, unknown>;
  brandingDefaults: Record<string, unknown>;
}

async function projectRow(): Promise<{ id: number; theme_json: string | null; branding_json: string | null; i18n_json: string | null }> {
  const id = await projectId();
  const { rows } = await getPool().query<{ id: number; theme_json: string | null; branding_json: string | null; i18n_json: string | null }>(
    "SELECT id, theme_json, branding_json, i18n_json FROM auth.projects WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) throw new ApiError(404, "project_not_found", "No existe el proyecto de CRV.");
  return row;
}

async function assetRows(project: number): Promise<IdentityData["assets"]> {
  const { rows } = await getPool().query<ProjectAsset & { kind: string }>(
    `SELECT kind, mime_type AS "mimeType", byte_size AS "byteSize", width, height, checksum
       FROM auth.project_assets WHERE project_id = $1`, [project]);
  const pick = (kind: AssetKind) => rows.find((row) => row.kind === kind) ?? null;
  return { favicon: pick("favicon"), share_image: pick("share_image") };
}

export async function readIdentity(): Promise<IdentityData> {
  const project = await projectRow();
  return {
    theme: object(project.theme_json),
    branding: object(project.branding_json),
    i18n: object(project.i18n_json),
    assets: await assetRows(project.id),
    themeDefaults: themeDefaults as Record<string, unknown>,
    brandingDefaults: brandingDefaults as Record<string, unknown>,
  };
}

export async function saveTheme(input: unknown): Promise<IdentityData> {
  const project = await projectRow();
  const clean = sanitizeTheme(input);
  await getPool().query(
    "UPDATE auth.projects SET theme_json = $2, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
    [project.id, JSON.stringify(clean)]);
  return readIdentity();
}

export async function saveBranding(input: unknown): Promise<IdentityData> {
  const project = await projectRow();
  const clean = sanitizeBranding(input);
  await getPool().query(
    "UPDATE auth.projects SET branding_json = $2, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
    [project.id, JSON.stringify(clean)]);
  return readIdentity();
}

export async function saveProjectI18n(input: unknown): Promise<IdentityData> {
  const project = await projectRow();
  const clean = sanitizeProjectI18n(input);
  await getPool().query(
    "UPDATE auth.projects SET i18n_json = $2, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
    [project.id, JSON.stringify(clean)]);
  return readIdentity();
}

// ------------------------------------------------------------------ imágenes

const SIGNATURES: Array<{ mime: string; test: (data: Buffer) => boolean }> = [
  { mime: "image/png", test: (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", test: (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  { mime: "image/webp", test: (data) => data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP" },
];

export function sniffImage(data: Buffer): string | undefined {
  return SIGNATURES.find((signature) => signature.test(data))?.mime;
}

export async function saveAsset(kind: string, data: Buffer): Promise<IdentityData> {
  if (!(ASSET_KINDS as readonly string[]).includes(kind)) {
    throw new ApiError(400, "invalid_asset_kind", "Solo se admiten favicon e imagen para compartir.");
  }
  if (!data.length) throw new ApiError(400, "empty_asset", "La imagen está vacía.");
  if (data.length > MAX_ASSET_BYTES) throw new ApiError(400, "asset_too_large", "La imagen supera los 2 MB.");
  const mime = sniffImage(data);
  if (!mime) throw new ApiError(400, "invalid_image", "Solo se admiten PNG, JPG o WebP.");
  const project = await projectRow();
  const checksum = createHash("sha256").update(data).digest("hex").slice(0, 32);
  await getPool().query(
    `INSERT INTO auth.project_assets (project_id, kind, mime_type, bytes, byte_size, checksum)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id, kind) DO UPDATE SET
       mime_type = excluded.mime_type, bytes = excluded.bytes, byte_size = excluded.byte_size,
       checksum = excluded.checksum, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`,
    [project.id, kind, mime, data, data.length, checksum]);
  return readIdentity();
}

export async function deleteAsset(kind: string): Promise<IdentityData> {
  if (!(ASSET_KINDS as readonly string[]).includes(kind)) {
    throw new ApiError(400, "invalid_asset_kind", "Solo se admiten favicon e imagen para compartir.");
  }
  const project = await projectRow();
  await getPool().query("DELETE FROM auth.project_assets WHERE project_id = $1 AND kind = $2", [project.id, kind]);
  return readIdentity();
}
