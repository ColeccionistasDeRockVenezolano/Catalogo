/** Preferencia global del catálogo. La portada conserva siempre su tema. */
export const CATALOG_THEMES = ["current", "charcoal", "studio"] as const;
export type CatalogTheme = (typeof CATALOG_THEMES)[number];
export interface SiteAppearance { catalogTheme: CatalogTheme; updatedAt: string | null; }
