// CRV · Cliente de la configuración del proyecto.
import { request } from "./api";

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

export interface UpdateProjectConfig {
  name: string;
  visibility: ProjectVisibility;
  defaultLang: ProjectLang;
  acceptsApplications: boolean;
  showLogin: boolean;
  visitorCounter: boolean;
}

export const projectApi = {
  get: () => request<ProjectConfig>("/community/admin/project"),
  update: (body: UpdateProjectConfig) =>
    request<ProjectConfig>("/community/admin/project", { method: "PATCH", body, authenticated: true }),
};
