// CRV · «Mi perfil» (/cuenta): datos de la propia cuenta.
//
// La persona es global; la cuenta (`auth.users`) es de este proyecto y la
// sesión puede ser de un colaborador o de un administrador. Todo lo que se
// escribe aquí es del usuario que lo pide: no hay parámetro de id.
//
// Las validaciones viven fuera del acceso a datos para poder probarlas sin
// PostgreSQL (`validateProfileFields`, `profileGaps`, `cleanLinks`).
import type { PoolClient } from "pg";
import { getPool } from "../../db/client.js";
import { ApiError } from "../http-errors.js";
import { herraPasswordMatches } from "../herra-accounts.js";
import {
  MAX_FIELD, MAX_LINKS, MAX_PERSON_NAME, hashAccessCode, isStrongAccessCode,
  isValidBirthDate, isValidEmail, isValidPhone, isValidUrl, normalizePersonName, passwordRequirementsText,
} from "../community/validation.js";
import { projectId, syncLinkedAdminCredential, withTransaction } from "../community/store.js";

const UTC_NOW = "to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')";

/** Huecos del perfil, con la misma lista que «Personas y colaboradores». */
export const GAP_KEYS = ["age", "whatsapp", "experience", "categories", "links"] as const;
export type GapKey = typeof GAP_KEYS[number];

export const MAX_BIO = 2_000;

export interface PersonRow {
  first_name: string;
  last_name: string | null;
  birth_date: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  bio: string | null;
  experience: string | null;
  availability: string | null;
  contact_preference: "whatsapp" | "email" | "both";
  profile_visibility: "private" | "public";
}

export interface LinkRow {
  id: number;
  type: string;
  label: string | null;
  url: string;
  is_public: boolean;
  sort_order: number;
}

export interface CatalogTerm {
  id: number;
  type: string;
  label: string;
  slug: string;
}

export interface AccountOwner {
  username: string;
  name: string;
  first_name: string;
  last_name: string;
  role: string;
  person_id: number | null;
  user_id: number | null;
  admin_id: number | null;
}

export interface OwnProfile {
  account: AccountOwner;
  project: { id: number; name: string };
  person: PersonRow | null;
  termIds: number[];
  links: LinkRow[];
  gaps: GapKey[];
  catalog: { skills: CatalogTerm[]; areas: CatalogTerm[]; linkTypes: CatalogTerm[] };
  accessCodeRequirements: string;
}

export interface ProfileInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  birthDate?: string | undefined;
  whatsappPhone?: string | undefined;
  email?: string | undefined;
  city?: string | undefined;
  country?: string | undefined;
  bio?: string | undefined;
  experience?: string | undefined;
  availability?: string | undefined;
  contactPreference?: string | undefined;
  profileVisibility?: string | undefined;
  termIds?: number[] | undefined;
  links?: Array<{ type?: string | undefined; label?: string | undefined; url: string; isPublic?: boolean | undefined }> | undefined;
}

export interface CleanProfile {
  firstName: string;
  lastName: string;
  person: {
    birthDate: string | null;
    whatsappPhone: string | null;
    email: string | null;
    city: string | null;
    country: string | null;
    bio: string | null;
    experience: string | null;
    availability: string | null;
    contactPreference: "whatsapp" | "email" | "both";
    profileVisibility: "private" | "public";
  };
  termIds: number[];
  links: Array<{ type: string; label: string | null; url: string; isPublic: boolean }>;
}

const CONTACT_PREFERENCES = ["whatsapp", "email", "both"] as const;
const VISIBILITIES = ["private", "public"] as const;

function text(value: string | undefined, max: number, field: string): string {
  // Sin NUL (rompe PostgreSQL) pero conservando saltos de línea del texto largo.
  const clean = (value ?? "").split("\u0000").join("").trim();
  if (clean.length > max) {
    throw new ApiError(400, "field_too_long", `El campo ${field} no puede superar ${max} caracteres.`);
  }
  return clean;
}

function optional(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Valida y normaliza el cuerpo completo de «Mi perfil». Los enlaces se
 * comprueban antes de escribir nada: un error de tecleo no deja el perfil a
 * medio guardar.
 */
export function validateProfileFields(input: ProfileInput): CleanProfile {
  const firstName = normalizePersonName(input.firstName ?? "");
  const lastName = normalizePersonName(input.lastName ?? "");
  if (!firstName || !lastName) {
    throw new ApiError(400, "invalid_name", "Nombre y apellido son obligatorios.");
  }
  if (firstName.length > MAX_PERSON_NAME || lastName.length > MAX_PERSON_NAME) {
    throw new ApiError(400, "invalid_name", `Nombre y apellido admiten como máximo ${MAX_PERSON_NAME} caracteres cada uno.`);
  }
  const birthDate = text(input.birthDate, 10, "la fecha de nacimiento");
  if (birthDate && !isValidBirthDate(birthDate)) {
    throw new ApiError(400, "invalid_birth_date", "La fecha de nacimiento no es válida.");
  }
  const whatsappPhone = text(input.whatsappPhone, 120, "el WhatsApp");
  if (whatsappPhone && !isValidPhone(whatsappPhone)) {
    throw new ApiError(400, "invalid_phone", "El número de WhatsApp no parece válido. Inclúyelo con su código de país.");
  }
  const email = text(input.email, 120, "el correo");
  if (email && !isValidEmail(email)) {
    throw new ApiError(400, "invalid_email", "El correo no parece válido.");
  }
  const contactPreference = (input.contactPreference ?? "whatsapp") as typeof CONTACT_PREFERENCES[number];
  if (!CONTACT_PREFERENCES.includes(contactPreference)) {
    throw new ApiError(400, "invalid_contact_preference", "La preferencia de contacto no es válida.");
  }
  const profileVisibility = (input.profileVisibility ?? "private") as typeof VISIBILITIES[number];
  if (!VISIBILITIES.includes(profileVisibility)) {
    throw new ApiError(400, "invalid_visibility", "La visibilidad del perfil no es válida.");
  }
  const termIds = [...new Set((input.termIds ?? []).filter((id) => Number.isInteger(id) && id > 0))];
  if (termIds.length > 40) throw new ApiError(400, "too_many_terms", "Demasiadas categorías seleccionadas.");
  return {
    firstName,
    lastName,
    person: {
      birthDate: optional(birthDate),
      whatsappPhone: optional(whatsappPhone),
      email: optional(email),
      city: optional(text(input.city, MAX_FIELD, "la ciudad")),
      country: optional(text(input.country, MAX_FIELD, "el país")),
      bio: optional(text(input.bio, MAX_BIO, "la biografía")),
      experience: optional(text(input.experience, MAX_BIO, "la experiencia")),
      availability: optional(text(input.availability, MAX_FIELD, "la disponibilidad")),
      contactPreference,
      profileVisibility,
    },
    termIds,
    links: cleanLinks(input.links ?? []),
  };
}

/** Filas de enlace tal como las manda la página: vacías se descartan. */
export function cleanLinks(links: NonNullable<ProfileInput["links"]>): CleanProfile["links"] {
  const valid = links
    .map((link) => ({
      type: (link.type ?? "").trim().slice(0, 40),
      label: (link.label ?? "").trim().slice(0, 120),
      url: (link.url ?? "").trim(),
      isPublic: link.isPublic === true,
    }))
    .filter((link) => link.url !== "");
  if (valid.length > MAX_LINKS) {
    throw new ApiError(400, "too_many_links", `Se admiten como máximo ${MAX_LINKS} enlaces.`);
  }
  if (valid.some((link) => link.url.length > 500 || !isValidUrl(link.url))) {
    throw new ApiError(400, "invalid_link", "Alguno de los enlaces no es una dirección válida (debe empezar por http:// o https://).");
  }
  return valid.map((link) => ({ ...link, label: link.label === "" ? null : link.label }));
}

/** Qué le falta al perfil; sin huecos, «completo». */
export function profileGaps(
  person: Pick<PersonRow, "birth_date" | "whatsapp_phone" | "experience"> | null,
  termIds: number[],
  links: Array<{ url: string }>,
): GapKey[] {
  const gaps: GapKey[] = [];
  if (!person?.birth_date) gaps.push("age");
  if (!person?.whatsapp_phone) gaps.push("whatsapp");
  if (!person?.experience) gaps.push("experience");
  if (termIds.length === 0) gaps.push("categories");
  if (links.length === 0) gaps.push("links");
  return gaps;
}

// ---------------------------------------------------------------- lectura

/** Cuenta de la sesión, sea de colaborador o de administrador. */
export async function resolveOwner(kind: string, id: number): Promise<AccountOwner | undefined> {
  if (kind === "user") {
    const { rows } = await getPool().query<AccountOwner>(
      `SELECT u.name::text AS username,
              coalesce(nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.name::text) AS name,
              coalesce(u.first_name, '') AS first_name, coalesce(u.last_name, '') AS last_name,
              'reader' AS role, u.person_id, u.id AS user_id,
              (SELECT a.id FROM auth.admins a WHERE a.user_id = u.id ORDER BY a.id LIMIT 1) AS admin_id
         FROM auth.users u WHERE u.id = $1`, [id]);
    return rows[0];
  }
  if (kind === "admin") {
    const { rows } = await getPool().query<AccountOwner>(
      `SELECT a.username::text AS username,
              coalesce(
                (SELECT coalesce(nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.name::text)
                   FROM auth.users u WHERE u.id = a.user_id),
                a.username::text) AS name,
              coalesce((SELECT u.first_name FROM auth.users u WHERE u.id = a.user_id), '') AS first_name,
              coalesce((SELECT u.last_name FROM auth.users u WHERE u.id = a.user_id), '') AS last_name,
              a.role, u.person_id, a.user_id, a.id AS admin_id
         FROM auth.admins a LEFT JOIN auth.users u ON u.id = a.user_id
        WHERE a.id = $1`, [id]);
    return rows[0];
  }
  if (kind === "local") {
    const { rows } = await getPool().query<AccountOwner>(
      `SELECT username::text AS username, name, '' AS first_name, '' AS last_name, role,
              NULL::int AS person_id, NULL::int AS user_id, NULL::int AS admin_id
         FROM auth.local_accounts WHERE id = $1 AND enabled`, [id]);
    return rows[0];
  }
  return undefined;
}

async function personById(personId: number): Promise<PersonRow | null> {
  const { rows } = await getPool().query<PersonRow>(
    `SELECT first_name, last_name, birth_date, whatsapp_phone, email, city, country,
            bio, experience, availability, contact_preference, profile_visibility
       FROM auth.people WHERE id = $1`, [personId]);
  return rows[0] ?? null;
}

async function linksByPerson(personId: number): Promise<LinkRow[]> {
  const { rows } = await getPool().query<LinkRow>(
    `SELECT id, type, label, url, (is_public = 1) AS is_public, sort_order
       FROM auth.person_links WHERE person_id = $1
      ORDER BY sort_order ASC, id ASC`, [personId]);
  return rows;
}

async function termIdsByPerson(personId: number): Promise<number[]> {
  const { rows } = await getPool().query<{ term_id: number }>(
    "SELECT term_id FROM auth.person_catalog_terms WHERE person_id = $1 ORDER BY term_id", [personId]);
  return rows.map((row) => row.term_id);
}

export async function catalogGroups(): Promise<OwnProfile["catalog"]> {
  const { rows } = await getPool().query<CatalogTerm>(
    `SELECT id, type, label, slug FROM auth.catalog_terms
      WHERE archived_at IS NULL AND type IN ('skill', 'contribution_area', 'link_type')
      ORDER BY type, label`);
  return {
    skills: rows.filter((term) => term.type === "skill"),
    areas: rows.filter((term) => term.type === "contribution_area"),
    linkTypes: rows.filter((term) => term.type === "link_type"),
  };
}

async function projectName(id: number): Promise<string> {
  const { rows } = await getPool().query<{ name: string }>("SELECT name FROM auth.projects WHERE id = $1", [id]);
  return rows[0]?.name ?? "";
}

export async function readOwnProfile(kind: string, id: number): Promise<OwnProfile> {
  const account = await resolveOwner(kind, id);
  if (!account) throw new ApiError(401, "unauthorized", "La sesión no corresponde a una cuenta de este proyecto.");
  const project = await projectId();
  const [person, catalog] = await Promise.all([
    account.person_id === null ? Promise.resolve(null) : personById(account.person_id),
    catalogGroups(),
  ]);
  let termIds: number[] = [];
  let links: LinkRow[] = [];
  if (account.person_id !== null) {
    [termIds, links] = await Promise.all([termIdsByPerson(account.person_id), linksByPerson(account.person_id)]);
  }
  return {
    account,
    project: { id: project, name: await projectName(project) },
    person,
    termIds,
    links,
    gaps: profileGaps(person, termIds, links),
    catalog,
    accessCodeRequirements: passwordRequirementsText(),
  };
}

// --------------------------------------------------------------- escritura

/** Solo se guardan términos del catálogo vivo y con el tipo permitido. */
async function assertTerms(client: PoolClient, termIds: number[]): Promise<void> {
  if (termIds.length === 0) return;
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM auth.catalog_terms
      WHERE id = ANY($1::int[]) AND archived_at IS NULL
        AND type IN ('skill', 'contribution_area')`, [termIds]);
  if (rows.length !== termIds.length) {
    throw new ApiError(400, "invalid_term", "Alguna de las categorías elegidas ya no está disponible.");
  }
}

async function linkTypeSlugs(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ slug: string }>(
    "SELECT slug FROM auth.catalog_terms WHERE archived_at IS NULL AND type = 'link_type'");
  return new Set(rows.map((row) => row.slug));
}

export async function saveOwnProfile(kind: string, id: number, input: ProfileInput): Promise<OwnProfile> {
  const clean = validateProfileFields(input);
  const account = await resolveOwner(kind, id);
  if (!account) throw new ApiError(401, "unauthorized", "La sesión no corresponde a una cuenta de este proyecto.");
  await withTransaction(async (client) => {
    if (account.user_id !== null) {
      await client.query(
        `UPDATE auth.users SET first_name = $1, last_name = $2, updated_at = ${UTC_NOW} WHERE id = $3`,
        [clean.firstName, clean.lastName, account.user_id]);
    }
    if (account.person_id === null) return;
    const person = clean.person;
    await client.query(
      `UPDATE auth.people SET birth_date = $1, whatsapp_phone = $2, email = $3, city = $4, country = $5,
              bio = $6, experience = $7, availability = $8, contact_preference = $9,
              profile_visibility = $10, updated_at = ${UTC_NOW}
        WHERE id = $11`,
      [person.birthDate, person.whatsappPhone, person.email, person.city, person.country,
        person.bio, person.experience, person.availability, person.contactPreference,
        person.profileVisibility, account.person_id]);
    await assertTerms(client, clean.termIds);
    await client.query("DELETE FROM auth.person_catalog_terms WHERE person_id = $1", [account.person_id]);
    if (clean.termIds.length > 0) {
      await client.query(
        `INSERT INTO auth.person_catalog_terms (person_id, term_id)
         SELECT $1, unnest($2::int[])`, [account.person_id, clean.termIds]);
    }
    const slugs = await linkTypeSlugs(client);
    const fallback = [...slugs][0] ?? "web";
    for (const link of clean.links) {
      if (link.type !== "" && !slugs.has(link.type)) {
        throw new ApiError(400, "invalid_link_type", "El tipo de un enlace ya no está disponible.");
      }
    }
    await client.query("DELETE FROM auth.person_links WHERE person_id = $1", [account.person_id]);
    let order = 1;
    for (const link of clean.links) {
      await client.query(
        `INSERT INTO auth.person_links (person_id, type, label, url, is_public, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [account.person_id, link.type === "" ? fallback : link.type, link.label, link.url,
          link.isPublic ? 1 : 0, order]);
      order += 1;
    }
  });
  return readOwnProfile(kind, id);
}

export interface PasswordChangeResult {
  /** Nueva versión de la cuenta, para reestampar la sesión en curso. */
  sessionVersion: number;
}

/**
 * Cambia la clave de la propia cuenta y de su otra puerta, si la tiene: una
 * persona con colaborador y administración vinculados tiene una sola clave.
 * La versión de cuenta sube: cualquier otra sesión abierta deja de valer en la
 * siguiente petición.
 */
export async function changeOwnPassword(
  kind: string, id: number, current: string, next: string,
): Promise<PasswordChangeResult> {
  const account = await resolveOwner(kind, id);
  if (!account) throw new ApiError(401, "unauthorized", "La sesión no corresponde a una cuenta de este proyecto.");
  if (kind === "local") {
    throw new ApiError(400, "password_managed",
      "Esta cuenta la administra el servidor; su clave no se cambia desde aquí.");
  }
  if (!isStrongAccessCode(next, account.username)) {
    throw new ApiError(400, "weak_access_code", `Clave insegura. ${passwordRequirementsText()}`);
  }
  const table = kind === "admin" ? "auth.admins" : "auth.users";
  const hashColumn = kind === "admin" ? "password_hash" : "access_code_hash";
  const { rows } = await getPool().query<{ hash: string | null; version: number }>(
    `SELECT ${hashColumn} AS hash, session_version AS version FROM ${table} WHERE id = $1`, [id]);
  const stored = rows[0];
  if (!stored?.hash) throw new ApiError(400, "password_missing", "Esta cuenta no tiene una clave que cambiar.");
  // Quien aún tenga dos claves distintas entra con cualquiera de ellas, así que
  // cualquiera sirve como clave actual; este cambio las deja en una.
  const linkedUserId = account.user_id;
  const known = new Set([stored.hash]);
  if (linkedUserId !== null) {
    const { rows: linked } = await getPool().query<{ hash: string }>(
      `SELECT access_code_hash AS hash FROM auth.users WHERE id = $1 AND access_code_hash IS NOT NULL
       UNION SELECT password_hash FROM auth.admins WHERE user_id = $1 AND role <> 'superadmin'`, [linkedUserId]);
    for (const row of linked) known.add(row.hash);
  }
  let matches = false;
  for (const hash of known) {
    if (await herraPasswordMatches(current, hash)) { matches = true; break; }
  }
  if (!matches) throw new ApiError(400, "invalid_current_password", "La clave actual no es correcta.");
  const passwordHash = hashAccessCode(next);
  const updated = await withTransaction(async (client) => {
    // La fila propia va después: `auth.revoke_changed_user` sube la versión de la
    // administración vinculada, y la que se devuelve reestampa esta sesión.
    if (linkedUserId !== null && kind === "admin") {
      await client.query(
        `UPDATE auth.users SET access_code_hash = $1, session_version = session_version + 1, updated_at = ${UTC_NOW} WHERE id = $2`,
        [passwordHash, linkedUserId]);
    }
    const own = await client.query<{ version: number }>(
      `UPDATE ${table} SET ${hashColumn} = $1, session_version = session_version + 1,
              updated_at = ${UTC_NOW}
        WHERE id = $2 RETURNING session_version AS version`,
      [passwordHash, id]);
    if (linkedUserId !== null) {
      await syncLinkedAdminCredential(client, linkedUserId, passwordHash, kind === "admin" ? id : null);
    }
    return own.rows;
  });
  const version = updated[0]?.version;
  if (version === undefined) throw new ApiError(404, "account_not_found", "No existe esa cuenta.");
  return { sessionVersion: version };
}
