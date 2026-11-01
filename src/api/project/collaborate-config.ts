// CRV · Formulario de colaboración del proyecto (ventana 3.8) y catálogo de
// categorías de perfil.
//
// Lo que se guarda en `auth.projects.collaborate_json` son los ajustes en
// español; las traducciones viven en `i18n_json` con claves `collab.*` y las
// resuelve `resolveCollaborateForm` al pintar /colaborar. Aquí solo se
// valida, se sanea y se escribe; la portada no cambia de forma.
import defaults from "../../landing/collaborate-defaults.json" with { type: "json" };
import { resolveCollaborateForm, type CollaborateForm } from "../../landing/collaborate-form.js";
import { getPool } from "../../db/client.js";
import { ApiError } from "../http-errors.js";
import { projectId } from "../community/store.js";
import { sanitizeHeroHtml } from "./config.js";
import { slugify } from "../community/validation.js";

const MAX_TEXT = 1_000;
const MAX_TERMS = 60;
const TERM_TYPES = ["skill", "contribution_area", "link_type"] as const;
export type TermType = typeof TERM_TYPES[number];

/** Claves cuyo valor es un texto libre del formulario. */
const TEXT_KEYS = [
  "heroBadge", "heroTitleHtml", "heroSub", "introNote", "submitLabel",
  "nextStepsTitle", "sentTitle", "sentBody",
] as const;
/** Secciones de textos por campo. */
const MAP_SECTIONS = ["steps", "labels", "helps", "placeholders"] as const;
const LIST_KEYS = ["pillars", "nextSteps"] as const;
const FIELD_MODES = ["off", "optional", "required"] as const;

const ES_DEFAULTS = defaults.es as unknown as Record<string, unknown>;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_TEXT ? value : undefined;
}

/**
 * Deja solo lo que el formulario entiende: mismas claves que las fábricas, los
 * mismos modos de campo y `maxLinks` entre 0 y 10. Un valor inválido se
 * descarta en vez de tumbar el guardado completo (igual que al leerlo).
 */
export function sanitizeCollaborateConfig(input: unknown): Record<string, unknown> {
  const raw = typeof input === "string" ? safeParse(input) : input;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "invalid_form", "El formulario no es un objeto válido.");
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if ((TEXT_KEYS as readonly string[]).includes(key)) {
      const text = stringValue(value);
      if (text === undefined) continue;
      clean[key] = key === "heroTitleHtml" ? (sanitizeHeroHtml(text) ?? "") : text;
      continue;
    }
    if ((LIST_KEYS as readonly string[]).includes(key)) {
      if (!Array.isArray(value)) continue;
      clean[key] = value
        .filter((item): item is string => typeof item === "string" && item.length <= MAX_TEXT)
        .slice(0, 10);
      continue;
    }
    if (key === "maxLinks") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10) continue;
      clean[key] = value;
      continue;
    }
    if ((MAP_SECTIONS as readonly string[]).includes(key)) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const sectionDefaults = ES_DEFAULTS[key] as Record<string, string> | undefined;
      if (!sectionDefaults) continue;
      const section: Record<string, string> = {};
      for (const [field, item] of Object.entries(value as Record<string, unknown>)) {
        if (!(field in sectionDefaults)) continue;
        const text = stringValue(item);
        if (text !== undefined) section[field] = text;
      }
      clean[key] = section;
      continue;
    }
    if (key === "fields") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const sectionDefaults = ES_DEFAULTS["fields"] as Record<string, string> | undefined;
      if (!sectionDefaults) continue;
      const fields: Record<string, string> = {};
      for (const [field, item] of Object.entries(value as Record<string, unknown>)) {
        if (!(field in sectionDefaults)) continue;
        if (typeof item !== "string" || !(FIELD_MODES as readonly string[]).includes(item)) continue;
        fields[field] = item;
      }
      clean["fields"] = fields;
    }
  }
  return clean;
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

export interface ProfileTermRow {
  id: number;
  type: string;
  label: string;
  slug: string;
  archived: boolean;
  persons: number;
}

export interface CollaborateConfig {
  /** Ajustes guardados del proyecto (solo lo que se separa de las fábricas). */
  overrides: Record<string, unknown>;
  /** Formulario efectivo en español, el que se pinta en /colaborar. */
  form: CollaborateForm;
  catalog: { skills: ProfileTermRow[]; areas: ProfileTermRow[]; linkTypes: ProfileTermRow[] };
  maxLinks: number;
}

async function projectRow(): Promise<{ id: number; collaborate_json: string | null }> {
  const id = await projectId();
  const { rows } = await getPool().query<{ id: number; collaborate_json: string | null }>(
    "SELECT id, collaborate_json FROM auth.projects WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) throw new ApiError(404, "project_not_found", "No existe el proyecto de CRV.");
  return row;
}

export async function readProfileTerms(includeArchived = true): Promise<ProfileTermRow[]> {
  const { rows } = await getPool().query<ProfileTermRow>(
    `SELECT t.id, t.type, t.label, t.slug, (t.archived_at IS NOT NULL) AS archived,
            (SELECT count(*)::int FROM auth.person_catalog_terms pct WHERE pct.term_id = t.id) AS persons
       FROM auth.catalog_terms t
      WHERE t.type IN ('skill', 'contribution_area', 'link_type')
        AND ($1 OR t.archived_at IS NULL)
      ORDER BY t.type, t.label`, [includeArchived]);
  return rows;
}

function groupTerms(rows: ProfileTermRow[]): CollaborateConfig["catalog"] {
  return {
    skills: rows.filter((row) => row.type === "skill"),
    areas: rows.filter((row) => row.type === "contribution_area"),
    linkTypes: rows.filter((row) => row.type === "link_type"),
  };
}

export async function readCollaborateConfig(): Promise<CollaborateConfig> {
  const project = await projectRow();
  const overrides = project.collaborate_json ? safeParse(project.collaborate_json) : {};
  const form = resolveCollaborateForm(overrides ?? {}, "es");
  return {
    overrides: (overrides ?? {}) as Record<string, unknown>,
    form,
    catalog: groupTerms(await readProfileTerms()),
    maxLinks: form.maxLinks,
  };
}

export async function saveCollaborateConfig(input: unknown): Promise<CollaborateConfig> {
  const project = await projectRow();
  const clean = sanitizeCollaborateConfig(input);
  await getPool().query(
    "UPDATE auth.projects SET collaborate_json = $2, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
    [project.id, JSON.stringify(clean)]);
  return readCollaborateConfig();
}

// ------------------------------------------------------- categorías de perfil

function normalizeTermType(value: string): TermType {
  if (!(TERM_TYPES as readonly string[]).includes(value)) {
    throw new ApiError(400, "invalid_term_type", "El tipo de categoría no es válido.");
  }
  return value as TermType;
}

export async function createProfileTerm(type: string, label: string): Promise<ProfileTermRow> {
  const termType = normalizeTermType(type);
  const clean = label.trim().replace(/\s+/gu, " ").slice(0, 80);
  if (!clean) throw new ApiError(400, "invalid_term", "La categoría necesita un nombre.");
  const { rows: count } = await getPool().query<{ n: number }>(
    "SELECT count(*)::int AS n FROM auth.catalog_terms WHERE type = $1 AND archived_at IS NULL", [termType]);
  if ((count[0]?.n ?? 0) >= MAX_TERMS) {
    throw new ApiError(400, "too_many_terms", `Cada tipo admite como máximo ${MAX_TERMS} categorías activas.`);
  }
  const slug = slugify(clean, termType).slice(0, 60);
  const { rows: existing } = await getPool().query(
    "SELECT 1 FROM auth.catalog_terms WHERE type = $1 AND lower(label) = lower($2)", [termType, clean]);
  if (existing.length > 0) {
    throw new ApiError(409, "term_exists", "Ya existe una categoría con ese nombre.");
  }
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO auth.catalog_terms (type, label, slug) VALUES ($1, $2, $3) RETURNING id`,
    [termType, clean, slug]);
  const id = rows[0]?.id;
  if (id === undefined) throw new ApiError(500, "term_not_created", "No se pudo crear la categoría.");
  const all = await readProfileTerms();
  const created = all.find((term) => term.id === id);
  if (!created) throw new ApiError(500, "term_not_created", "No se pudo leer la categoría creada.");
  return created;
}

export async function updateProfileTerm(
  id: number, input: { label?: string | undefined; archived?: boolean | undefined },
): Promise<ProfileTermRow> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (input.label !== undefined) {
    const clean = input.label.trim().replace(/\s+/gu, " ").slice(0, 80);
    if (!clean) throw new ApiError(400, "invalid_term", "La categoría necesita un nombre.");
    assignments.push(`label = $${values.length + 1}`);
    values.push(clean);
  }
  if (input.archived !== undefined) {
    assignments.push(input.archived ? "archived_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')" : "archived_at = NULL");
  }
  if (assignments.length === 0) throw new ApiError(400, "empty_update", "No hay cambios que guardar.");
  values.push(id);
  const { rows } = await getPool().query<{ id: number }>(
    `UPDATE auth.catalog_terms SET ${assignments.join(", ")} WHERE id = $${values.length} RETURNING id`, values);
  if (!rows[0]) throw new ApiError(404, "term_not_found", "No existe esa categoría.");
  const all = await readProfileTerms();
  const updated = all.find((term) => term.id === id);
  if (!updated) throw new ApiError(404, "term_not_found", "No existe esa categoría.");
  return updated;
}
