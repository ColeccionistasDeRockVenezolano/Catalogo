// CRV · Lecturas del catálogo compartidas entre visitantes y cuentas con sesión.
//
// La caché de rutas (catalog-cache.ts) no sirve a quien tiene sesión cuando la
// respuesta añade datos de trabajo (p. ej. `genreByLaya` en los listados). La
// parte común —el listado en sí, que es lo caro— sí puede compartirse: se
// guarda aquí y la ruta añade encima lo propio de la sesión. Se vacía con la
// misma invalidación que la caché de rutas.
import { ReadCache } from "../shared/read-cache.js";

const cache = new ReadCache<unknown>(512);

export function sharedCatalogRead<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  return cache.get(key, ttl, load) as Promise<T>;
}

export function clearSharedCatalogReads(): void { cache.clear(); }
