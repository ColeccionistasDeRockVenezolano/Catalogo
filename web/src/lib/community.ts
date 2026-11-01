// CRV · Cliente de la API de comunidad (Fase 1).
import { request } from "./api";

export type CollaboratorStatus = "pending" | "approved" | "rejected";
export type ApplicationStatus = "new" | "reviewing" | "contact" | "accepted" | "rejected" | "archived";
export type AdminRole = "admin" | "curator" | "community";

export interface Collaborator {
  id: number; name: string; first_name: string | null; last_name: string | null;
  status: CollaboratorStatus; signup_source: string; session_version: number;
  created_at: string; person_id: number | null; email: string | null;
  whatsapp_phone: string | null; city: string | null; country: string | null; terms: string;
  has_access_code?: boolean;
}

export interface CommunityOverview {
  pending_applications: number; collaborators: number; pending_collaborators: number;
  pending_activations: number; active_invites: number;
}

export interface ApplicationSummary {
  id: number; first_name: string; last_name: string | null; email: string | null;
  whatsapp_phone: string | null; city: string | null; country: string | null;
  status: ApplicationStatus; created_at: string; reviewed_at: string | null;
  terms: string; link_count: number;
}

export interface ApplicationLink { id: number; type: string; label: string | null; url: string }

export interface ApplicationDetail extends ApplicationSummary {
  birth_date: string | null; contact_preference: string; experience: string | null;
  contribution_text: string | null; idea: string | null; idea_reason: string | null;
  wants_to_implement: string; availability: string | null; person_id: number | null;
  user_id: number | null; source_addr: string | null;
  skill_ids: number[]; area_ids: number[]; links: ApplicationLink[];
}

export interface Invite { id: number; created_at: string; expires_at: string; created_by: string; use_count: number }
export interface Activation {
  id: number; user_id: number; name: string; first_name: string | null; last_name: string | null;
  created_at: string; expires_at: string; created_by: string;
}
export interface AdminUser {
  id: number; username: string; role: string; project_id: number | null;
  user_id: number | null; session_version: number; created_at: string; person_name: string | null;
}
export interface FormOption { id: number; label: string }
export interface FormOptions {
  skills: FormOption[]; areas: FormOption[]; linkTypes: FormOption[];
  accessCodeRequirements: string;
}
export interface AcceptResult {
  application: ApplicationDetail; personId: number; userId: number; createdPerson: boolean;
  activationToken: string; activationExpiresAt: string; activationPath: string;
}
export interface InviteCreated { token: string; expiresAt: string; invitePath: string }

/** Ficha global de la persona, para el editor de «Personas y colaboradores». */
export interface PersonProfile {
  person_id: number; user_id: number; username: string;
  first_name: string; last_name: string;
  birth_date: string | null; whatsapp_phone: string | null; email: string | null;
  city: string | null; country: string | null; bio: string | null;
  experience: string | null; availability: string | null;
  contact_preference: string; profile_visibility: string;
}
export interface PersonProfileInput {
  firstName: string; lastName?: string; birthDate?: string; whatsappPhone?: string;
  email?: string; city?: string; country?: string; experience?: string; availability?: string;
}

/** Ventana 3.8: formulario de colaboración y categorías de perfil. */
export type FieldMode = "off" | "optional" | "required";
export type ProfileTermType = "skill" | "contribution_area" | "link_type";
export interface ProfileTerm {
  id: number; type: ProfileTermType; label: string; slug: string; archived: boolean; persons: number;
}
export interface CollaborateForm {
  heroBadge: string;
  heroTitleHtml: string;
  heroSub: string;
  introNote: string;
  pillars: string[];
  steps: Record<string, string>;
  labels: Record<string, string>;
  helps: Record<string, string>;
  placeholders: Record<string, string>;
  submitLabel: string;
  nextStepsTitle: string;
  nextSteps: string[];
  sentTitle: string;
  sentBody: string;
  maxLinks: number;
  fields: Record<string, FieldMode>;
}
export interface CollaborateConfig {
  overrides: Record<string, unknown>;
  form: CollaborateForm;
  catalog: { skills: ProfileTerm[]; areas: ProfileTerm[]; linkTypes: ProfileTerm[] };
  maxLinks: number;
}
export interface ActivationCreated { token: string; expiresAt: string; activationPath: string }

export interface ApplicationInput {
  firstName: string; lastName?: string | undefined; birthDate?: string | undefined;
  whatsappPhone?: string | undefined; email?: string | undefined; city?: string | undefined;
  country?: string | undefined;
  contactPreference?: "whatsapp" | "email" | "both" | undefined;
  experience?: string | undefined; contributionText?: string | undefined;
  idea?: string | undefined; ideaReason?: string | undefined;
  wantsToImplement?: "yes" | "maybe" | "share_only" | undefined;
  availability?: string | undefined;
  skillIds?: number[] | undefined; areaIds?: number[] | undefined;
  links?: Array<{ type?: string | undefined; label?: string | undefined; url: string }> | undefined;
}

export const communityApi = {
  formOptions: () => request<FormOptions>("/community/form-options"),
  apply: (body: ApplicationInput) => request<{ ok: true; id?: number }>("/community/applications", { method: "POST", body }),
  inviteInfo: (token: string) => request<{ valid: boolean; expiresAt: string | null }>(
    `/community/invite/${encodeURIComponent(token)}`),
  register: (body: { token: string; name: string; firstName: string; lastName: string; accessCode: string }) =>
    request<{ ok: true; name: string }>("/community/register", { method: "POST", body }),
  activationInfo: (token: string) => request<{
    valid: boolean; name: string | null; firstName: string | null; lastName: string | null; expiresAt: string | null;
  }>(`/community/activate/${encodeURIComponent(token)}`),
  activate: (body: { token: string; name: string; accessCode: string }) =>
    request<{ ok: true; name: string }>("/community/activate", { method: "POST", body }),

  overview: () => request<CommunityOverview>("/community/admin/overview"),
  collaborators: (query: { status?: string; search?: string } = {}) =>
    request<{ data: Collaborator[] }>("/community/admin/collaborators", { query }),
  createCollaborator: (body: { name: string; firstName: string; lastName?: string | undefined; accessCode: string }) =>
    request<Collaborator>("/community/admin/collaborators", { method: "POST", authenticated: true, body }),
  updateCollaborator: (id: number, body: { firstName?: string; lastName?: string; status?: CollaboratorStatus }) =>
    request<Collaborator>(`/community/admin/collaborators/${id}`, { method: "PATCH", authenticated: true, body }),
  setAccessCode: (id: number, accessCode: string) =>
    request<void>(`/community/admin/collaborators/${id}/access-code`, {
      method: "POST", authenticated: true, body: { accessCode } }),
  revokeCollaborator: (id: number) =>
    request<void>(`/community/admin/collaborators/${id}/revoke`, { method: "POST", authenticated: true }),
  collaboratorPerson: (id: number) => request<PersonProfile>(`/community/admin/collaborators/${id}/person`),
  updateCollaboratorPerson: (id: number, body: PersonProfileInput) =>
    request<PersonProfile>(`/community/admin/collaborators/${id}/person`, { method: "PATCH", authenticated: true, body }),
  setCollaboratorUsername: (id: number, username: string) =>
    request<Collaborator>(`/community/admin/collaborators/${id}/username`, {
      method: "PATCH", authenticated: true, body: { username } }),
  deleteCollaborator: (id: number) =>
    request<void>(`/community/admin/collaborators/${id}`, { method: "DELETE", authenticated: true }),
  createActivation: (id: number) =>
    request<ActivationCreated>(`/community/admin/collaborators/${id}/activation`, { method: "POST", authenticated: true }),

  applications: (query: { status?: string; search?: string } = {}) =>
    request<{ data: ApplicationSummary[] }>("/community/admin/applications", { query }),
  application: (id: number) => request<ApplicationDetail>(`/community/admin/applications/${id}`),
  setApplicationStatus: (id: number, status: Exclude<ApplicationStatus, "accepted">) =>
    request<ApplicationSummary>(`/community/admin/applications/${id}`, {
      method: "PATCH", authenticated: true, body: { status } }),
  acceptApplication: (id: number, existingPersonId?: number) =>
    request<AcceptResult>(`/community/admin/applications/${id}/accept`, {
      method: "POST", authenticated: true, body: existingPersonId ? { existingPersonId } : {} }),

  invites: () => request<{ data: Invite[] }>("/community/admin/invites"),
  createInvite: () => request<InviteCreated>("/community/admin/invites", { method: "POST", authenticated: true }),
  revokeInvite: (id: number) =>
    request<void>(`/community/admin/invites/${id}`, { method: "DELETE", authenticated: true }),

  activations: () => request<{ data: Activation[] }>("/community/admin/activations"),
  revokeActivation: (id: number) =>
    request<void>(`/community/admin/activations/${id}`, { method: "DELETE", authenticated: true }),

  admins: () => request<{ data: AdminUser[] }>("/community/admin/admins"),
  setAdminRole: (id: number, role: AdminRole) =>
    request<AdminUser>(`/community/admin/admins/${id}/role`, {
      method: "PATCH", authenticated: true, body: { role } }),

  // Ventana 3.8 · formulario de colaboración y catálogo de categorías.
  collaborateForm: () => request<CollaborateConfig>("/community/admin/collaborate-form"),
  saveCollaborateForm: (form: Record<string, unknown>) =>
    request<CollaborateConfig>("/community/admin/collaborate-form", {
      method: "PUT", authenticated: true, body: { form } }),
  profileTerms: () => request<{ data: ProfileTerm[]; skills: ProfileTerm[]; areas: ProfileTerm[]; linkTypes: ProfileTerm[] }>(
    "/community/admin/profile-terms"),
  createProfileTerm: (type: ProfileTermType, label: string) =>
    request<ProfileTerm>("/community/admin/profile-terms", {
      method: "POST", authenticated: true, body: { type, label } }),
  updateProfileTerm: (id: number, patch: { label?: string; archived?: boolean }) =>
    request<ProfileTerm>(`/community/admin/profile-terms/${id}`, {
      method: "PATCH", authenticated: true, body: patch }),
};
