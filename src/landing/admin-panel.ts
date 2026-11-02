// CRV · Datos del panel /curaduria/roadmap, el /admin de Herra 1.1.39.
//
// La plantilla (`views/admin.ejs`) y su guion (`web/public/landing/admin.js`)
// son los de Herra: esperan las filas con la forma de sus servicios. Este módulo
// las lee y escribe en el esquema `auth` de CRV; las reglas de orden, tokens y
// candidaturas siguen en `src/api/roadmap` y `src/api/community`.
import { createHash } from "node:crypto";
import { getPool } from "../db/client.js";
import { ApiError } from "../api/http-errors.js";
import {
  isValidBirthDate, isValidEmail, isValidPhone, isValidUrl, normalizePersonName,
} from "../api/community/validation.js";
import { withTransaction } from "../api/community/store.js";
import { listActivations, listInvites } from "../api/community/tokens.js";
import { DEFAULT_BRANDING, MAX_SOCIAL_LINKS, defaultPageMeta, parseBrandingOverrides, resolveBranding } from "./herra/branding.js";
import {
  CONFIGURABLE_FIELDS, DEFAULT_COLLABORATE_FORM, FIELD_LABELS, FIELD_STEP, MAX_LINKS_CAP,
  parseCollaborateOverrides, resolveCollaborateForm,
} from "./herra/collaborate-form.js";
import { serializeRowTranslations, rowTranslations } from "./herra/content-i18n.js";
import { idList, linkRows, stringField } from "./herra/form-input.js";
import { TRANSLATABLE_LANGS, translate } from "./herra/i18n.js";
import {
  PROJECT_I18N_FIELDS, collaborateI18nFields, collaborateI18nSource, projectTranslations,
  socialI18nFields, socialI18nSource,
} from "./herra/project-i18n.js";
import { DONATION_PLATFORMS, SOCIAL_PLATFORMS } from "./herra/social-icons.js";
import { parseThemeOverrides, resolveTheme } from "./herra/theme.js";
import type { LandingLanguage } from "./i18n.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- filas con la forma que espera el guion de Herra. */
type Row = Record<string, any>;

const UTC_NOW = "to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')";
export const ASSET_LIMITS = {
  favicon: { maxBytes: 512 * 1024, minWidth: 48, minHeight: 48, label: "favicon" },
  share_image: { maxBytes: 3 * 1024 * 1024, minWidth: 400, minHeight: 210, label: "imagen para compartir" },
} as const;

export const displayName = (user: Row): string =>
  [user["first_name"], user["last_name"]].filter(Boolean).join(" ").trim() || user["name"];

export function shortDisplayName(user: Row): string {
  const full = displayName(user);
  if (full.length <= 20 || !user["first_name"] || !user["last_name"]) return full;
  const first = String(user["first_name"]).trim().split(/\s+/u)[0] ?? "";
  const initial = String(user["last_name"]).trim().charAt(0);
  if (!first) return full;
  return initial ? `${first} ${initial}.` : first;
}

export function collaborationGaps(row: Row, lang: LandingLanguage): string[] {
  const keys: string[] = [];
  if (row["person_id"] === null) keys.push("profile");
  else {
    if (!row["person_birth_date"]) keys.push("age");
    if (!row["person_whatsapp_phone"]) keys.push("whatsapp");
    if (!row["person_experience"]) keys.push("experience");
    if (row["term_count"] === 0) keys.push("categories");
    if (row["link_count"] === 0) keys.push("links");
  }
  return keys.map((key) => translate(lang, `gaps.${key}`) as string);
}

const pct = (completed: number, total: number): number => (total > 0 ? Math.min((completed / total) * 100, 100) : 0);

export async function projectRow(id: number): Promise<Row> {
  const { rows } = await getPool().query<Row>("SELECT *, slug::text AS slug FROM auth.projects WHERE id = $1", [id]);
  if (!rows[0]) throw new ApiError(404, "project_not_found", "Proyecto no encontrado.");
  return rows[0];
}

// ------------------------------------------------------------------ roadmap

export async function getRoadmap(project: number): Promise<Row> {
  const pool = getPool();
  const [categories, tasks, assignments] = await Promise.all([
    pool.query<Row>("SELECT * FROM auth.categories WHERE project_id = $1 ORDER BY sort_order ASC, id ASC", [project]),
    pool.query<Row>("SELECT * FROM auth.tasks WHERE project_id = $1 ORDER BY category_id ASC, sort_order ASC, id ASC", [project]),
    pool.query<Row>(
      `SELECT ta.task_id, u.id, u.name::text AS name, u.first_name, u.last_name
         FROM auth.task_assignees ta
         JOIN auth.users u ON u.id = ta.user_id
         JOIN auth.tasks t ON t.id = ta.task_id
        WHERE t.project_id = $1
        ORDER BY ta.task_id ASC, lower(u.name::text) ASC, u.id ASC`, [project]),
  ]);
  const byTask = new Map<number, Row[]>();
  for (const row of assignments.rows) {
    const list = byTask.get(row["task_id"]) ?? [];
    list.push({ id: row["id"], name: row["name"], displayName: displayName(row), shortName: shortDisplayName(row) });
    byTask.set(row["task_id"], list);
  }
  let total = 0;
  let done = 0;
  let lastUpdated: string | null = null;
  const views = categories.rows.map((category) => {
    const list: Row[] = tasks.rows.filter((task) => task["category_id"] === category["id"]).map((task) => {
      const assigned = byTask.get(task["id"]) ?? [];
      return { ...task, assigned_users: assigned, assigned_user_id: assigned[0]?.["id"] ?? null, assigned_user_name: assigned[0]?.["name"] ?? null };
    });
    const completed = list.filter((task) => task["status"] === "completed").length;
    total += list.length;
    done += completed;
    for (const task of list) if (!lastUpdated || task["updated_at"] > lastUpdated) lastUpdated = task["updated_at"];
    return {
      id: category["id"], slug: category["slug"], title: category["title"], i18n_json: category["i18n_json"],
      colorKey: category["color_key"],
      progress: { total: list.length, completed, percentage: pct(completed, list.length) },
      tasks: list,
    };
  });
  return { overall: { total, completed: done, percentage: pct(done, total) }, categories: views, lastUpdated };
}

export function translatableContent(view: Row): Row[] {
  return view["categories"].map((category: Row) => ({
    id: category["id"], title: category["title"], translations: rowTranslations(category),
    tasks: category["tasks"].map((task: Row) => ({ id: task["id"], title: task["title"], translations: rowTranslations(task) })),
  }));
}

export async function saveContentTranslations(project: number, input: Row): Promise<{ categories: number; tasks: number }> {
  const counts = { categories: 0, tasks: 0 };
  await withTransaction(async (client) => {
    for (const [rawId, translations] of Object.entries(input["categories"] ?? {})) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      counts.categories += (await client.query("UPDATE auth.categories SET i18n_json = $1 WHERE id = $2 AND project_id = $3", [serializeRowTranslations(translations), id, project])).rowCount ?? 0;
    }
    for (const [rawId, translations] of Object.entries(input["tasks"] ?? {})) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      counts.tasks += (await client.query(`UPDATE auth.tasks SET i18n_json = $1, updated_at = ${UTC_NOW} WHERE id = $2 AND project_id = $3`, [serializeRowTranslations(translations), id, project])).rowCount ?? 0;
    }
  });
  return counts;
}

// ---------------------------------------------------------------- personas

const PUBLIC_USER_FIELDS = "id, person_id, project_id, name::text AS name, first_name, last_name, status, signup_source, created_at, updated_at";

export async function getUsers(project: number): Promise<Row[]> {
  return (await getPool().query<Row>(`SELECT ${PUBLIC_USER_FIELDS} FROM auth.users WHERE project_id = $1 AND status = 'approved' ORDER BY lower(name::text) ASC, id ASC`, [project])).rows;
}

export async function listPendingUsers(project: number): Promise<Row[]> {
  return (await getPool().query<Row>(`SELECT ${PUBLIC_USER_FIELDS} FROM auth.users WHERE project_id = $1 AND status = 'pending' ORDER BY created_at ASC, id ASC`, [project])).rows;
}

export async function listProjectCollaborations(project: number): Promise<Row[]> {
  return (await getPool().query<Row>(
    `SELECT u.id, u.person_id, u.project_id, u.name::text AS name, u.first_name, u.last_name,
            u.status, u.signup_source, u.created_at, u.updated_at,
            pr.name AS project_name, pr.slug::text AS project_slug, a.id AS admin_id,
            p.first_name AS person_first_name, p.last_name AS person_last_name,
            p.birth_date AS person_birth_date, p.whatsapp_phone AS person_whatsapp_phone,
            p.email AS person_email, p.experience AS person_experience,
            (SELECT count(*)::int FROM auth.person_catalog_terms x WHERE x.person_id = u.person_id) AS term_count,
            (SELECT count(*)::int FROM auth.person_links x WHERE x.person_id = u.person_id) AS link_count,
            (SELECT string_agg(ct.label, ' · ') FROM auth.person_catalog_terms x
               JOIN auth.catalog_terms ct ON ct.id = x.term_id WHERE x.person_id = u.person_id) AS term_labels
       FROM auth.users u
       JOIN auth.projects pr ON pr.id = u.project_id
       LEFT JOIN auth.admins a ON a.user_id = u.id
       LEFT JOIN auth.people p ON p.id = u.person_id
      WHERE u.project_id = $1
      ORDER BY lower(u.name::text) ASC, u.id ASC`, [project])).rows;
}

export async function usersPayload(project: number): Promise<Row> {
  const [users, collaborations] = await Promise.all([getUsers(project), listProjectCollaborations(project)]);
  return { users, collaborations };
}

export async function personOfProject(project: number, personId: number): Promise<boolean> {
  const { rowCount } = await getPool().query("SELECT 1 FROM auth.users WHERE project_id = $1 AND person_id = $2", [project, personId]);
  return (rowCount ?? 0) > 0;
}

export async function getPersonProfile(id: number, lang: LandingLanguage = "es"): Promise<Row | null> {
  const pool = getPool();
  const person = (await pool.query<Row>("SELECT * FROM auth.people WHERE id = $1", [id])).rows[0];
  if (!person) return null;
  const [terms, links] = await Promise.all([
    pool.query<Row>(
      `SELECT ct.* FROM auth.catalog_terms ct JOIN auth.person_catalog_terms x ON x.term_id = ct.id
        WHERE x.person_id = $1 ORDER BY ct.type ASC, lower(ct.label) ASC`, [id]),
    pool.query<Row>("SELECT * FROM auth.person_links WHERE person_id = $1 ORDER BY sort_order ASC, id ASC", [id]),
  ]);
  const keys: string[] = [];
  if (!person["birth_date"]) keys.push("age");
  if (!person["whatsapp_phone"]) keys.push("whatsapp");
  if (!person["experience"]) keys.push("experience");
  if (terms.rows.length === 0) keys.push("categories");
  if (links.rows.length === 0) keys.push("links");
  return { person, terms: terms.rows, links: links.rows, gaps: keys.map((key) => translate(lang, `gaps.${key}`)) };
}

const textOrNull = (value: unknown, max: number): string | null => {
  const clean = typeof value === "string" ? value.trim().slice(0, max) : "";
  return clean === "" ? null : clean;
};

/** Solo se tocan los campos presentes: quien edita el contacto no borra la biografía. */
export async function updatePersonFromBody(id: number, body: Row): Promise<void> {
  const links = body["linkUrl"] !== undefined ? linkRows(body) as Row[] : null;
  if (links?.some((link) => !isValidUrl(link["url"]))) throw new ApiError(400, "invalid_links", "Alguno de los enlaces no es una dirección válida (debe empezar por http:// o https://).");
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown): void => { values.push(value); assignments.push(`${column} = $${values.length}`); };
  const field = (name: string): string | undefined => (body[name] === undefined ? undefined : stringField(body, name));
  const nameError = "El nombre es obligatorio y no puede superar los 120 caracteres.";
  const first = field("firstName");
  if (first !== undefined) {
    const clean = normalizePersonName(first);
    if (!clean || clean.length > 120) throw new ApiError(400, "invalid_name", nameError);
    set("first_name", clean);
  }
  const last = field("lastName");
  if (last !== undefined) {
    const clean = normalizePersonName(last);
    if (clean.length > 120) throw new ApiError(400, "invalid_name", nameError);
    set("last_name", clean || null);
  }
  const birth = field("birthDate");
  if (birth !== undefined) {
    const clean = textOrNull(birth, 10);
    if (clean !== null && !isValidBirthDate(clean)) throw new ApiError(400, "invalid_birth_date", "La fecha de nacimiento no es válida.");
    set("birth_date", clean);
  }
  const phone = field("whatsappPhone");
  if (phone !== undefined) {
    const clean = textOrNull(phone, 120);
    if (clean !== null && !isValidPhone(clean)) throw new ApiError(400, "invalid_phone", "El número de WhatsApp no parece válido. Inclúyelo con su código de país.");
    set("whatsapp_phone", clean);
  }
  const email = field("email");
  if (email !== undefined) {
    const clean = textOrNull(email, 120);
    if (clean !== null && !isValidEmail(clean)) throw new ApiError(400, "invalid_email", "El correo no parece válido.");
    set("email", clean);
  }
  for (const [name, column, max] of [["city", "city", 120], ["country", "country", 120], ["bio", "bio", 4000], ["experience", "experience", 4000], ["availability", "availability", 120]] as const) {
    const value = field(name);
    if (value !== undefined) set(column, textOrNull(value, max));
  }
  const preference = field("contactPreference");
  if (preference === "whatsapp" || preference === "email" || preference === "both") set("contact_preference", preference);
  const visibility = field("profileVisibility");
  if (visibility === "private" || visibility === "team" || visibility === "public") set("profile_visibility", visibility);

  await withTransaction(async (client) => {
    if (assignments.length > 0) {
      await client.query(`UPDATE auth.people SET ${assignments.join(", ")}, updated_at = ${UTC_NOW} WHERE id = $${values.length + 1}`, [...values, id]);
    }
    if (first !== undefined || last !== undefined) {
      await client.query(
        `UPDATE auth.users u SET first_name = p.first_name, last_name = p.last_name, updated_at = ${UTC_NOW}
           FROM auth.people p WHERE p.id = $1 AND u.person_id = p.id`, [id]);
    }
    if (body["termIds"] !== undefined) {
      const ids = (idList(body, "termIds") as number[]).filter((value) => Number.isInteger(value));
      const valid = (await client.query<{ id: number }>(
        "SELECT id FROM auth.catalog_terms WHERE id = ANY($1::int[]) AND archived_at IS NULL AND type IN ('skill', 'contribution_area')", [ids])).rows;
      await client.query("DELETE FROM auth.person_catalog_terms WHERE person_id = $1", [id]);
      for (const term of valid) {
        await client.query("INSERT INTO auth.person_catalog_terms (person_id, term_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, term.id]);
      }
    }
    if (links) {
      await client.query("DELETE FROM auth.person_links WHERE person_id = $1", [id]);
      const kept = links.filter((link) => isValidUrl(link["url"]) && String(link["type"]).trim() !== "").slice(0, 10);
      for (const [index, link] of kept.entries()) {
        await client.query(
          "INSERT INTO auth.person_links (person_id, type, label, url, is_public, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
          [id, String(link["type"]).trim().slice(0, 120), textOrNull(link["label"], 120), String(link["url"]).trim(), link["isPublic"] === false ? 0 : 1, index]);
      }
    }
  });
}

// ---------------------------------------------------------------- catálogo

const localizeTerm = (term: Row, lang: LandingLanguage): Row => {
  if (lang === "es") return term;
  const translated = (rowTranslations(term) as Record<string, string>)[lang];
  return translated ? { ...term, label: translated } : term;
};

export async function catalogGroups(lang: LandingLanguage): Promise<Row> {
  const { rows } = await getPool().query<Row>("SELECT * FROM auth.catalog_terms WHERE archived_at IS NULL ORDER BY lower(label) ASC");
  const group = (type: string) => rows.filter((term) => term["type"] === type).map((term) => localizeTerm(term, lang));
  return { skills: group("skill"), areas: group("contribution_area"), linkTypes: group("link_type") };
}

// ------------------------------------------------------------- candidaturas

export const applicationStatusLabels = (lang: LandingLanguage): Record<string, string> => Object.fromEntries(
  ["new", "reviewing", "contact", "accepted", "rejected", "archived"].map((status) => [status, translate(lang, `appStatus.${status}`)]));

const APPLICATION_FIELDS = `id, project_id, person_id, user_id, first_name, last_name, birth_date,
  whatsapp_phone, email, city, country, contact_preference, experience, contribution_text, idea,
  idea_reason, wants_to_implement, availability, status, created_at, reviewed_at, reviewed_by_admin_id`;

export async function listApplicationRows(project: number, filters: { status?: string | undefined; search?: string | undefined; termId?: number | undefined } = {}): Promise<Row[]> {
  const conditions = ["a.project_id = $1"];
  const values: unknown[] = [project];
  if (filters.status === "open") conditions.push("a.status IN ('new', 'reviewing', 'contact')");
  else if (filters.status) { values.push(filters.status); conditions.push(`a.status = $${values.length}`); }
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    values.push(`%${term}%`, term);
    const like = `$${values.length - 1}`;
    conditions.push(`(a.first_name ILIKE ${like} OR a.last_name ILIKE ${like} OR a.email ILIKE ${like} OR a.whatsapp_phone ILIKE ${like} OR a.id::text = $${values.length})`);
  }
  if (filters.termId) {
    values.push(filters.termId);
    conditions.push(`EXISTS (SELECT 1 FROM auth.application_catalog_terms x WHERE x.application_id = a.id AND x.term_id = $${values.length})`);
  }
  const fields = APPLICATION_FIELDS.split(",").map((field) => `a.${field.trim()}`).join(", ");
  return (await getPool().query<Row>(
    `SELECT ${fields},
            (SELECT string_agg(ct.label, ' · ') FROM auth.application_catalog_terms x
               JOIN auth.catalog_terms ct ON ct.id = x.term_id WHERE x.application_id = a.id) AS term_labels,
            (SELECT count(*)::int FROM auth.application_links l WHERE l.application_id = a.id) AS link_count
       FROM auth.applications a
      WHERE ${conditions.join(" AND ")}
      ORDER BY a.created_at DESC, a.id DESC`, values)).rows;
}

export async function countOpenApplications(project: number): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>("SELECT count(*)::int AS n FROM auth.applications WHERE project_id = $1 AND status IN ('new', 'reviewing', 'contact')", [project]);
  return rows[0]?.n ?? 0;
}

export async function applicationDetail(project: number, id: number): Promise<Row | null> {
  const pool = getPool();
  const application = (await pool.query<Row>(`SELECT ${APPLICATION_FIELDS} FROM auth.applications WHERE id = $1 AND project_id = $2`, [id, project])).rows[0];
  if (!application) return null;
  const fullName = [application["first_name"], application["last_name"]].filter(Boolean).join(" ");
  const [terms, links, candidates] = await Promise.all([
    pool.query<Row>(
      `SELECT ct.* FROM auth.catalog_terms ct JOIN auth.application_catalog_terms x ON x.term_id = ct.id
        WHERE x.application_id = $1 ORDER BY ct.type ASC, lower(ct.label) ASC`, [id]),
    pool.query<Row>("SELECT * FROM auth.application_links WHERE application_id = $1 ORDER BY sort_order ASC, id ASC", [id]),
    pool.query<Row>(
      `SELECT id, first_name, last_name, email, whatsapp_phone FROM auth.people
        WHERE ($1::text IS NOT NULL AND email = $1)
           OR ($2::text IS NOT NULL AND whatsapp_phone = $2)
           OR lower(trim(first_name || ' ' || coalesce(last_name, ''))) = lower($3)
        ORDER BY id ASC LIMIT 10`, [application["email"], application["whatsapp_phone"], fullName]),
  ]);
  return { application, terms: terms.rows, links: links.rows, candidates: candidates.rows };
}

// ------------------------------------------------------------------ medios

export async function projectAssets(project: number): Promise<Record<string, Row>> {
  const { rows } = await getPool().query<Row>("SELECT kind, mime_type, byte_size, width, height, checksum, updated_at FROM auth.project_assets WHERE project_id = $1", [project]);
  return Object.fromEntries(rows.map((row) => [row["kind"], {
    kind: row["kind"], mimeType: row["mime_type"], byteSize: row["byte_size"], width: row["width"],
    height: row["height"], checksum: row["checksum"], updatedAt: row["updated_at"],
  }]));
}

function imageSize(bytes: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === "image/png" && bytes.length > 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
    return null;
  }
  if (mime === "image/webp" && bytes.length > 30) {
    const chunk = bytes.toString("latin1", 12, 16);
    if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  "image/png": (bytes) => bytes.length > 8 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  "image/jpeg": (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/webp": (bytes) => bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP",
};

export async function saveAssetFromDataUrl(project: number, kind: "favicon" | "share_image", raw: unknown): Promise<Row> {
  const match = typeof raw === "string" ? /^data:([a-z]+\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/iu.exec(raw.trim()) : null;
  const mime = match?.[1]?.toLowerCase() ?? "";
  if (!match || !MAGIC[mime]) throw new ApiError(400, "invalid_image", "La imagen debe ser PNG, JPG o WebP.");
  const bytes = Buffer.from(match[2]!.replace(/\s+/gu, ""), "base64");
  if (bytes.length === 0) throw new ApiError(400, "empty_asset", "La imagen está vacía.");
  if (!MAGIC[mime]!(bytes)) throw new ApiError(400, "invalid_image", "El archivo no coincide con su formato.");
  const limits = ASSET_LIMITS[kind];
  if (bytes.length > limits.maxBytes) throw new ApiError(400, "asset_too_large", `La ${limits.label} no puede pasar de ${Math.round(limits.maxBytes / 1024)} KB.`);
  const size = imageSize(bytes, mime);
  if (size && (size.width < limits.minWidth || size.height < limits.minHeight)) {
    throw new ApiError(400, "asset_too_small", `La ${limits.label} debe medir al menos ${limits.minWidth}×${limits.minHeight} px.`);
  }
  const checksum = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  await getPool().query(
    `INSERT INTO auth.project_assets (project_id, kind, mime_type, bytes, byte_size, width, height, checksum, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${UTC_NOW})
     ON CONFLICT (project_id, kind) DO UPDATE SET
       mime_type = excluded.mime_type, bytes = excluded.bytes, byte_size = excluded.byte_size,
       width = excluded.width, height = excluded.height, checksum = excluded.checksum, updated_at = excluded.updated_at`,
    [project, kind, mime, bytes, bytes.length, size?.width ?? null, size?.height ?? null, checksum]);
  const assets = await projectAssets(project);
  return { asset: assets[kind], assets };
}

// ------------------------------------------------- columnas del proyecto

export async function setProjectColumn(project: number, column: "theme_json" | "collaborate_json" | "branding_json" | "i18n_json", value: string | null): Promise<Row> {
  await getPool().query(`UPDATE auth.projects SET ${column} = $1, updated_at = ${UTC_NOW} WHERE id = $2`, [value, project]);
  return projectRow(project);
}

export async function brandingPayload(project: Row): Promise<Row> {
  const parsed = parseBrandingOverrides(project["branding_json"] ?? "");
  return {
    branding: resolveBranding(project), overrides: parsed.ok ? parsed.value : {},
    fallback: defaultPageMeta(project["name"]), assets: await projectAssets(project["id"]),
  };
}

export const i18nPayload = (project: Row): Row => ({
  translations: projectTranslations(project), fields: PROJECT_I18N_FIELDS, langs: TRANSLATABLE_LANGS,
});

// ------------------------------------------------------------- vista admin

/** Lo mismo que la ruta GET /admin de Herra entrega a su plantilla. */
export async function adminViewLocals(project: Row, lang: LandingLanguage): Promise<Row> {
  const id: number = project["id"];
  const [view, users, pendingUsers, activeInvites, applications, openApplications, collaborations, pendingActivations, catalog, assets] = await Promise.all([
    getRoadmap(id), getUsers(id), listPendingUsers(id), listInvites(id),
    listApplicationRows(id, { status: "open" }), countOpenApplications(id),
    listProjectCollaborations(id), listActivations(id), catalogGroups(lang), projectAssets(id),
  ]);
  const parsedTheme = parseThemeOverrides(project["theme_json"] ?? "");
  const parsedForm = parseCollaborateOverrides(project["collaborate_json"] ?? "");
  const parsedBranding = parseBrandingOverrides(project["branding_json"] ?? "");
  const spanishTheme = resolveTheme(project);
  const branding = resolveBranding(project);
  const meta = defaultPageMeta(project["name"]);
  const title = branding.metaTitle || meta.title;
  const description = branding.metaDescription || meta.description;
  const form = resolveCollaborateForm(project);
  return {
    projectI18n: projectTranslations(project), projectI18nFields: PROJECT_I18N_FIELDS, projectI18nLangs: TRANSLATABLE_LANGS,
    projectI18nCollabFields: collaborateI18nFields(parsedForm.ok ? parsedForm.value : {}),
    projectI18nSocialFields: socialI18nFields(branding),
    contentStages: translatableContent(view),
    projectI18nSource: {
      ...collaborateI18nSource(form), ...socialI18nSource(branding),
      name: project["name"], heroTitleHtml: spanishTheme.heroTitleHtml, heroSubPublic: spanishTheme.heroSubPublic,
      landingHeadline: spanishTheme.landingHeadline, footerNote: spanishTheme.footerNote,
      metaTitle: title, metaDescription: description, keywords: branding.keywords,
      ogTitle: branding.ogTitle || title, ogDescription: branding.ogDescription || description, imageAlt: branding.imageAlt || title,
      aboutTitle: branding.aboutTitle, aboutDescription: branding.aboutDescription, aboutStatus: branding.aboutStatus,
      aboutScope: branding.aboutScope, aboutSourceLabel: branding.aboutSourceLabel, faqTitle: branding.faqTitle,
      faq1Question: branding.faq1Question, faq1Answer: branding.faq1Answer, faq2Question: branding.faq2Question, faq2Answer: branding.faq2Answer,
      faq3Question: branding.faq3Question, faq3Answer: branding.faq3Answer, faq4Question: branding.faq4Question, faq4Answer: branding.faq4Answer,
      supportKicker: branding.supportKicker, supportTitle: branding.supportTitle, supportSub: branding.supportSub,
      donationLabel: branding.donation.label, donationNote: branding.donation.note,
    },
    branding, brandingOverrides: parsedBranding.ok ? parsedBranding.value : {}, brandingDefaults: DEFAULT_BRANDING, brandingFallback: meta,
    assets, assetLimits: ASSET_LIMITS, socialPlatforms: SOCIAL_PLATFORMS, donationPlatforms: DONATION_PLATFORMS, maxSocialLinks: MAX_SOCIAL_LINKS,
    view, users, pendingUsers, activeInvites, isAdmin: true,
    themeOverrides: parsedTheme.ok ? parsedTheme.value : {},
    applications, openApplications, collaborations, pendingActivations, catalog,
    applicationStatusLabels: applicationStatusLabels(lang),
    projectDefaultLang: project["default_lang"] === "en" || project["default_lang"] === "system" ? project["default_lang"] : "es",
    collaborateForm: form, collaborateOverrides: parsedForm.ok ? parsedForm.value : {}, collaborateDefaults: DEFAULT_COLLABORATE_FORM,
    configurableFields: CONFIGURABLE_FIELDS, fieldLabels: FIELD_LABELS, fieldStep: FIELD_STEP, maxLinksCap: MAX_LINKS_CAP,
  };
}
