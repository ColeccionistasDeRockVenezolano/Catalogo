/** Solo lecturas del catálogo público; las rutas de trabajo nunca entran. */
export function catalogCacheTtl(path: string): number {
  if (path === "/sitemap-ids") return 3_600_000;
  if (path === "/ephemerides") return 3_600_000;
  if (path === "/home") return 900_000;
  if (path === "/catalog/overview" || path === "/genres/facets"
    || /^\/(artists|albums|persons|organizations)\/facets$/u.test(path)) return 1_800_000;
  if (/^\/(artists|albums|persons|organizations)(\/\d+)?$/u.test(path)
    || /^\/(places|series)\/\d+$/u.test(path)) return 600_000;
  return 0;
}

/** Estas respuestas son idénticas para visitantes y cuentas con sesión. */
export function isCommonCatalogRead(path: string): boolean {
  return ["/home", "/ephemerides", "/catalog/overview", "/genres/facets", "/sitemap-ids"].includes(path)
    || /^\/(artists|albums|persons|organizations)\/facets$/u.test(path);
}

export function isCatalogWrite(method: string, path: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method)
    && !/^\/(auth|discovery\/metrics|search\/confirmations)(\/|$)/u.test(path);
}

/** Ordena claves distintas sin cambiar el orden de los valores repetidos (filtros). */
export function catalogCacheKey(url: URL): string {
  const query = new URLSearchParams(url.searchParams);
  query.sort();
  return `${url.pathname}?${query}`;
}
