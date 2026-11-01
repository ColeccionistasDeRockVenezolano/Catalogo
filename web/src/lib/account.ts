// CRV · Cliente de «Mi perfil» (/cuenta).
//
// Todas las rutas son de la propia cuenta: el servidor resuelve la persona y
// el colaborador desde la sesión, nunca desde el cuerpo.
import { request } from "./api";

export type GapKey = "age" | "whatsapp" | "experience" | "categories" | "links";

export interface CatalogTerm {
  id: number;
  type: string;
  label: string;
  slug: string;
}

export interface OwnPerson {
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

export interface OwnLink {
  id: number;
  type: string;
  label: string | null;
  url: string;
  is_public: boolean;
  sort_order: number;
}

export interface OwnAccount {
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
  account: OwnAccount;
  project: { id: number; name: string };
  person: OwnPerson | null;
  termIds: number[];
  links: OwnLink[];
  gaps: GapKey[];
  catalog: { skills: CatalogTerm[]; areas: CatalogTerm[]; linkTypes: CatalogTerm[] };
  accessCodeRequirements: string;
}

export interface OwnLinkInput {
  type?: string;
  label?: string;
  url: string;
  isPublic?: boolean;
}

export interface ProfileInput {
  firstName: string;
  lastName: string;
  birthDate?: string;
  whatsappPhone?: string;
  email?: string;
  city?: string;
  country?: string;
  bio?: string;
  experience?: string;
  availability?: string;
  contactPreference?: "whatsapp" | "email" | "both";
  profileVisibility?: "private" | "public";
  termIds?: number[];
  links?: OwnLinkInput[];
}

export const accountApi = {
  profile: () => request<OwnProfile>("/account/profile"),
  save: (body: ProfileInput) =>
    request<OwnProfile>("/account/profile", { method: "PATCH", authenticated: true, body }),
  password: (body: { currentAccessCode: string; newAccessCode: string; newAccessCodeConfirm: string }) =>
    request<{ ok: true }>("/account/password", { method: "POST", authenticated: true, body }),
};
