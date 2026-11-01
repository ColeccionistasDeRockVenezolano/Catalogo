// CRV · Cliente de identidad (3.10), idiomas (3.11) y tema (3.12).
import { request } from "./api";

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

export type AssetKind = "favicon" | "share_image";

export const identityApi = {
  get: () => request<IdentityData>("/community/admin/identity"),
  saveBranding: (branding: Record<string, unknown>) =>
    request<IdentityData>("/community/admin/branding", { method: "PUT", authenticated: true, body: { branding } }),
  saveTheme: (theme: Record<string, unknown>) =>
    request<IdentityData>("/community/admin/theme", { method: "PUT", authenticated: true, body: { theme } }),
  saveI18n: (i18n: Record<string, unknown>) =>
    request<IdentityData>("/community/admin/i18n", { method: "PUT", authenticated: true, body: { i18n } }),
  uploadAsset: (kind: AssetKind, file: File) =>
    request<IdentityData>(`/community/admin/assets/${kind}`, { method: "POST", authenticated: true, binaryBody: file }),
  deleteAsset: (kind: AssetKind) =>
    request<IdentityData>(`/community/admin/assets/${kind}`, { method: "DELETE", authenticated: true }),
};

/** Ruta pública de una imagen del proyecto (con su versión para saltar caché). */
export function assetUrl(kind: AssetKind, asset: ProjectAsset | null): string | null {
  if (!asset) return null;
  return `${import.meta.env.BASE_URL}api/landing-media/${kind === "favicon" ? "favicon" : "share"}?v=${asset.checksum}`;
}

/** Texto de un JSON de identidad (las columnas son TEXT con JSON dentro). */
export function str(source: Record<string, unknown>, key: string, fallback = ""): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}
