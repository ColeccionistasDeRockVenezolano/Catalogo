// CRV · Candidaturas y aceptación (Fase 1).
//
// Misma semántica que Herra: aceptar crea la persona (o vincula una existente),
// copia categorías y enlaces, abre una colaboración sin clave y emite un
// enlace de activación de un solo uso. La persona elige su usuario y clave al
// activar; hasta entonces no puede entrar.
import type { PoolClient } from "pg";
import { getPool } from "../../db/client.js";
import { ApiError } from "../http-errors.js";
import {
  newToken, hashToken, normalizePersonName, isValidBirthDate, isValidEmail, isValidPhone,
  isValidUrl, validUsername, slugify, ACTIVATION_TTL_DAYS,
  MAX_FIELD, MAX_LINKS, MAX_TEXT,
} from "./validation.js";
import { withTransaction, isUniqueViolation } from "./store.js";

export type ApplicationStatus = "new" | "reviewing" | "contact" | "accepted" | "rejected" | "archived";
export type ContactPreference = "whatsapp" | "email" | "both";
export type WantsToImplement = "yes" | "maybe" | "share_only";

export interface ApplicationInput {
  firstName: string;
  lastName?: string | undefined;
  birthDate?: string | undefined;
  whatsappPhone?: string | undefined;
  email?: string | undefined;
  city?: string | undefined;
  country?: string | undefined;
  contactPreference?: string | undefined;
  experience?: string | undefined;
  contributionText?: string | undefined;
  idea?: string | undefined;
  ideaReason?: string | undefined;
  wantsToImplement?: string | undefined;
  availability?: string | undefined;
  skillIds?: number[] | undefined;
  areaIds?: number[] | undefined;
  links?: Array<{ type?: string | undefined; label?: string | undefined; url: string }> | undefined;
}

export interface ApplicationRow {
  id: number; project_id: number; person_id: number | null; user_id: number | null;
  first_name: string; last_name: string | null; birth_date: string | null;
  whatsapp_phone: string | null; email: string | null; city: string | null; country: string | null;
  contact_preference: string; experience: string | null; contribution_text: string | null;
  idea: string | null; idea_reason: string | null; wants_to_implement: string;
  availability: string | null; status: ApplicationStatus; created_at: string;
  reviewed_at: string | null; reviewed_by_admin_id: number | null; source_addr: string | null;
}

export interface ApplicationSummary {
  id: number; first_name: string; last_name: string | null; email: string | null;
  whatsapp_phone: string | null; city: string | null; country: string | null;
  status: ApplicationStatus; created_at: string; reviewed_at: string | null;
  terms: string; link_count: number;
}

export interface ApplicationDetail extends ApplicationSummary {
  birth_date: string | null; contact_preference: string; experience: string | null;
  contribution_text: string | null; idea: string | null; idea_reason: string | null;
  wants_to_implement: string; availability: string | null; person_id: number | null;
  user_id: number | null; source_addr: string | null;
  skill_ids: number[]; area_ids: number[]; links: Array<{ id: number; type: string; label: string | null; url: string }>;
}

const clean = (value: string | undefined, max: number): string =>
  (value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim().slice(0, max);

const cleanMultiline = (value: string | undefined, max: number = MAX_TEXT): string => {
  const text = (value ?? "").normalize("NFC");
  return Array.from(text)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim()
    .slice(0, max);
};

function validTermIds(ids: number[] | undefined, type: "skill" | "contribution_area"): Promise<number[]> {
  if (!Array.isArray(ids) || ids.length === 0) return Promise.resolve([]);
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 40);
  if (unique.length === 0) return Promise.resolve([]);
  return getPool().query<{ id: number }>(
    `SELECT id FROM auth.catalog_terms
      WHERE type = $1 AND archived_at IS NULL AND id = ANY($2::int[])`, [type, unique],
  ).then(({ rows }) => rows.map((row) => row.id));
}

export async function createApplication(
  project: number, input: ApplicationInput, sourceAddr: string | null,
): Promise<{ id: number }> {
  const firstName = normalizePersonName(clean(input.firstName, MAX_FIELD));
  const lastName = normalizePersonName(clean(input.lastName, MAX_FIELD));
  if (!firstName) throw new ApiError(400, "missing_first_name", "El nombre es obligatorio.");
  const birthDate = clean(input.birthDate, 10);
  if (birthDate && !isValidBirthDate(birthDate)) {
    throw new ApiError(400, "invalid_birth_date", "La fecha de nacimiento no es válida.");
  }
  const phone = clean(input.whatsappPhone, MAX_FIELD);
  const email = clean(input.email, MAX_FIELD);
  if (phone && !isValidPhone(phone)) throw new ApiError(400, "invalid_phone", "El WhatsApp no parece válido.");
  if (email && !isValidEmail(email)) throw new ApiError(400, "invalid_email", "El correo no parece válido.");
  if (!phone && !email) throw new ApiError(400, "missing_contact", "Deja al menos un medio de contacto (WhatsApp o correo).");
  const contributionText = cleanMultiline(input.contributionText);
  const experience = cleanMultiline(input.experience);
  if (!contributionText && !experience) {
    throw new ApiError(400, "missing_contribution", "Cuéntanos qué aportarías o qué experiencia tienes.");
  }
  const contactPreference: ContactPreference = input.contactPreference === "email" || input.contactPreference === "both"
    ? input.contactPreference : "whatsapp";
  const wants: WantsToImplement = input.wantsToImplement === "yes" || input.wantsToImplement === "share_only"
    ? input.wantsToImplement : "maybe";
  const links = (Array.isArray(input.links) ? input.links : [])
    .filter((link) => typeof link?.url === "string" && link.url.trim() !== "")
    .slice(0, MAX_LINKS);
  for (const link of links) {
    if (!isValidUrl(link.url.trim())) throw new ApiError(400, "invalid_link", "Alguno de los enlaces no es una URL http(s) válida.");
  }
  const [skillIds, areaIds] = await Promise.all([
    validTermIds(input.skillIds, "skill"), validTermIds(input.areaIds, "contribution_area"),
  ]);

  const id = await withTransaction(async (client) => {
    const application = await client.query<{ id: number }>(
      `INSERT INTO auth.applications
         (project_id, first_name, last_name, birth_date, whatsapp_phone, email, city, country,
          contact_preference, experience, contribution_text, idea, idea_reason, wants_to_implement,
          availability, source_addr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [project, firstName, lastName || null, birthDate || null, phone || null, email || null,
       clean(input.city, MAX_FIELD) || null, clean(input.country, MAX_FIELD) || null,
       contactPreference, experience || null, contributionText || null,
       cleanMultiline(input.idea) || null, cleanMultiline(input.ideaReason) || null,
       wants, clean(input.availability, MAX_FIELD) || null, sourceAddr]);
    const applicationId = application.rows[0]!.id;
    for (const termId of [...skillIds, ...areaIds]) {
      await client.query(
        "INSERT INTO auth.application_catalog_terms (application_id, term_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [applicationId, termId]);
    }
    for (const [index, link] of links.entries()) {
      await client.query(
        `INSERT INTO auth.application_links (application_id, type, label, url, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [applicationId, clean(link.type, MAX_FIELD) || "otro", clean(link.label, MAX_FIELD) || null,
         link.url.trim().slice(0, 500), index + 1]);
    }
    return applicationId;
  });
  return { id };
}

export async function listApplications(
  project: number, filters: { status?: string | undefined; search?: string | undefined } = {},
): Promise<ApplicationSummary[]> {
  const status = filters.status ?? "";
  const open = status === "open" ? ["new", "reviewing", "contact"] : null;
  const exact = ["new", "reviewing", "contact", "accepted", "rejected", "archived"].includes(status) ? status : "";
  const search = (filters.search ?? "").trim().slice(0, 80);
  const { rows } = await getPool().query<ApplicationSummary>(
    `SELECT a.id, a.first_name, a.last_name, a.email, a.whatsapp_phone, a.city, a.country,
            a.status, a.created_at, a.reviewed_at,
            coalesce((SELECT string_agg(ct.label, ', ' ORDER BY ct.label)
                        FROM auth.application_catalog_terms act
                        JOIN auth.catalog_terms ct ON ct.id = act.term_id
                       WHERE act.application_id = a.id), '') AS terms,
            (SELECT count(*)::int FROM auth.application_links al WHERE al.application_id = a.id) AS link_count
       FROM auth.applications a
      WHERE a.project_id = $1
        AND ($2 = '' OR a.status = $2)
        AND ($3 = '' OR a.first_name ILIKE '%' || $3 || '%'
             OR coalesce(a.last_name, '') ILIKE '%' || $3 || '%'
             OR coalesce(a.email, '') ILIKE '%' || $3 || '%'
             OR coalesce(a.whatsapp_phone, '') ILIKE '%' || $3 || '%')
        AND ($4::text[] IS NULL OR a.status = ANY($4::text[]))
      ORDER BY a.created_at DESC
      LIMIT 500`, [project, exact, search, open]);
  return rows;
}

export async function getApplication(project: number, id: number): Promise<ApplicationDetail> {
  const { rows } = await getPool().query<ApplicationDetail>(
    `SELECT a.id, a.first_name, a.last_name, a.email, a.whatsapp_phone, a.city, a.country,
            a.status, a.created_at, a.reviewed_at, a.birth_date, a.contact_preference,
            a.experience, a.contribution_text, a.idea, a.idea_reason, a.wants_to_implement,
            a.availability, a.person_id, a.user_id, a.source_addr,
            coalesce((SELECT string_agg(ct.label, ', ' ORDER BY ct.label)
                        FROM auth.application_catalog_terms act
                        JOIN auth.catalog_terms ct ON ct.id = act.term_id
                       WHERE act.application_id = a.id), '') AS terms,
            (SELECT count(*)::int FROM auth.application_links al WHERE al.application_id = a.id) AS link_count
       FROM auth.applications a
      WHERE a.project_id = $1 AND a.id = $2`, [project, id]);
  const application = rows[0];
  if (!application) throw new ApiError(404, "application_not_found", "No existe esa candidatura.");
  const [terms, links] = await Promise.all([
    getPool().query<{ term_id: number; type: string }>(
      `SELECT act.term_id, ct.type FROM auth.application_catalog_terms act
         JOIN auth.catalog_terms ct ON ct.id = act.term_id
        WHERE act.application_id = $1`, [id]),
    getPool().query<{ id: number; type: string; label: string | null; url: string }>(
      "SELECT id, type, label, url FROM auth.application_links WHERE application_id = $1 ORDER BY sort_order, id", [id]),
  ]);
  application.skill_ids = terms.rows.filter((row) => row.type === "skill").map((row) => row.term_id);
  application.area_ids = terms.rows.filter((row) => row.type === "contribution_area").map((row) => row.term_id);
  application.links = links.rows;
  return application;
}

export async function setApplicationStatus(
  project: number, id: number, status: Exclude<ApplicationStatus, "accepted">, adminId: number | null,
): Promise<ApplicationSummary> {
  const allowed: Array<Exclude<ApplicationStatus, "accepted">> = ["new", "reviewing", "contact", "rejected", "archived"];
  if (!allowed.includes(status)) throw new ApiError(400, "invalid_status", "Estado de candidatura no válido.");
  const { rowCount } = await getPool().query(
    `UPDATE auth.applications
        SET status = $1, reviewed_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS'),
            reviewed_by_admin_id = $2
      WHERE id = $3 AND project_id = $4 AND status <> 'accepted'`, [status, adminId, id, project]);
  if (rowCount === 0) throw new ApiError(409, "application_locked", "La candidatura no existe o ya fue aceptada.");
  const list = await listApplications(project, { status });
  const updated = list.find((row) => row.id === id);
  if (!updated) throw new ApiError(404, "application_not_found", "No existe esa candidatura.");
  return updated;
}

export interface AcceptResult {
  application: ApplicationDetail;
  personId: number;
  userId: number;
  createdPerson: boolean;
  activationToken: string;
  activationExpiresAt: string;
}

async function provisionalUsername(client: PoolClient, project: number, first: string, last: string): Promise<string> {
  const base = slugify([first, last].filter(Boolean).join(" "));
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const { rows } = await client.query(
      "SELECT 1 FROM auth.users WHERE project_id = $1 AND lower(name::text) = lower($2)", [project, candidate]);
    if (rows.length === 0 && validUsername(candidate)) return candidate;
  }
  throw new ApiError(409, "username_exhausted", "No se pudo asignar un nombre de usuario provisional.");
}

export async function acceptApplication(
  project: number, id: number, adminId: number | null, createdBy: string, existingPersonId?: number,
): Promise<AcceptResult> {
  const activationToken = newToken();
  const result = await withTransaction(async (client) => {
    const found = await client.query<ApplicationRow>(
      "SELECT * FROM auth.applications WHERE project_id = $1 AND id = $2 FOR UPDATE", [project, id]);
    const application = found.rows[0];
    if (!application) throw new ApiError(404, "application_not_found", "No existe esa candidatura.");
    if (application.status === "accepted") throw new ApiError(409, "already_accepted", "La candidatura ya fue aceptada.");

    let personId: number;
    let createdPerson = false;
    if (existingPersonId) {
      const person = await client.query<{ id: number }>("SELECT id FROM auth.people WHERE id = $1", [existingPersonId]);
      if (!person.rows[0]) throw new ApiError(404, "person_not_found", "No existe la persona indicada.");
      personId = person.rows[0].id;
    } else {
      const person = await client.query<{ id: number }>(
        `INSERT INTO auth.people
           (first_name, last_name, birth_date, whatsapp_phone, email, city, country,
            experience, availability, bio, contact_preference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [application.first_name, application.last_name, application.birth_date,
         application.whatsapp_phone, application.email, application.city, application.country,
         application.experience, application.availability, application.contribution_text,
         application.contact_preference]);
      personId = person.rows[0]!.id;
      createdPerson = true;
    }

    const existing = await client.query("SELECT 1 FROM auth.users WHERE project_id = $1 AND person_id = $2", [project, personId]);
    if (existing.rows[0]) throw new ApiError(409, "duplicate_collaboration", "Esa persona ya colabora en el proyecto.");

    await client.query(
      `INSERT INTO auth.person_catalog_terms (person_id, term_id)
       SELECT $1, term_id FROM auth.application_catalog_terms WHERE application_id = $2
       ON CONFLICT DO NOTHING`, [personId, id]);
    await client.query(
      `INSERT INTO auth.person_links (person_id, type, label, url, is_public, sort_order)
       SELECT $1, al.type, al.label, al.url, 0, al.sort_order
         FROM auth.application_links al
        WHERE al.application_id = $2
          AND NOT EXISTS (SELECT 1 FROM auth.person_links pl WHERE pl.person_id = $1 AND pl.url = al.url)`,
      [personId, id]);

    const name = await provisionalUsername(client, project, application.first_name, application.last_name ?? "");
    let userId: number;
    try {
      const user = await client.query<{ id: number }>(
        `INSERT INTO auth.users
           (person_id, project_id, name, first_name, last_name, access_code_hash, status, signup_source)
         VALUES ($1,$2,$3,$4,$5,NULL,'approved','application') RETURNING id`,
        [personId, project, name, application.first_name, application.last_name]);
      userId = user.rows[0]!.id;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, "duplicate_collaboration", "Esa persona ya tiene una colaboración.");
      throw error;
    }

    await client.query(
      `UPDATE auth.applications
          SET status = 'accepted', person_id = $1, user_id = $2,
              reviewed_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS'),
              reviewed_by_admin_id = $3
        WHERE id = $4 AND project_id = $5`, [personId, userId, adminId, id, project]);

    await client.query(
      `UPDATE auth.activation_tokens
          SET revoked_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')
        WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, [userId]);
    const activation = await client.query<{ expires_at: string }>(
      `INSERT INTO auth.activation_tokens (project_id, user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3,
         to_char(timezone('UTC', statement_timestamp()) + ($4 || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS'),
         $5)
       RETURNING expires_at`,
      [project, userId, hashToken(activationToken), String(ACTIVATION_TTL_DAYS), createdBy]);
    return { personId, userId, createdPerson, expiresAt: activation.rows[0]!.expires_at };
  });

  return {
    application: await getApplication(project, id),
    personId: result.personId,
    userId: result.userId,
    createdPerson: result.createdPerson,
    activationToken,
    activationExpiresAt: result.expiresAt,
  };
}
