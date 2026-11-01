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
}

export interface PublicProjectConfig {
  name: string;
  visibility: ProjectVisibility;
  defaultLang: ProjectLang;
  acceptsApplications: boolean;
  showLogin: boolean;
  visitorCounter: boolean;
}

const VISIBILITY: readonly ProjectVisibility[] = ["hidden", "progress", "completed", "full"];
const LANGS: readonly ProjectLang[] = ["es", "en"];

function rowToConfig(row: {
  id: number; name: string; visibility_mode: string; default_lang: string;
  accepts_applications: number; show_login: number; visitor_counter: number; updated_at: string | null;
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
  };
}

const SELECT = `
  SELECT id, name, visibility_mode, default_lang, accepts_applications,
         show_login, visitor_counter, updated_at
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
