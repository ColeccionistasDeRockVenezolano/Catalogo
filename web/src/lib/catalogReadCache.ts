import { ReadCache } from "../../../src/shared/read-cache";
import { catalogCacheKey, catalogCacheTtl } from "../../../src/shared/catalog-cache-policy";

const cache = new ReadCache<unknown>();
interface Flight { controller: AbortController; users: number; done: boolean }
const flights = new Map<string, Flight>();
let revision: string | null = null;

export function clearCatalogReadCache(): void { cache.clear(); flights.clear(); }

export function observeCatalogRevision(value: string | null): boolean {
  if (!value || value === revision) return false;
  const changed = revision !== null;
  revision = value;
  if (changed) clearCatalogReadCache();
  return changed;
}

/** Cada consumidor puede cancelar su espera sin cancelar la carga compartida. */
export function waitForRead<T>(value: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return value;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void value.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function cachedCatalogRead<T>(url: URL, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  // La URL de transporte incluye /crv/api; el llamador entrega el path lógico.
  const ttl = catalogCacheTtl(url.pathname);
  const key = catalogCacheKey(url);
  if (signal?.aborted) return Promise.reject(signal.reason);
  let value = cache.getIfFresh(key) as Promise<T> | undefined;
  let flight = flights.get(key);
  if (!value) {
    flight = { controller: new AbortController(), users: 0, done: false };
    flights.set(key, flight);
    const current = flight;
    value = cache.get(key, ttl, () => load(AbortSignal.any([
      current.controller.signal, AbortSignal.timeout(30_000),
    ])).finally(() => {
      current.done = true;
      if (flights.get(key) === current) flights.delete(key);
    })) as Promise<T>;
  }
  if (flight) flight.users++;
  return waitForRead(value, signal).then(result => structuredClone(result)).finally(() => {
    if (!flight || --flight.users > 0 || flight.done) return;
    flight.controller.abort();
    if (flights.get(key) === flight) { flights.delete(key); cache.delete(key); }
  });
}

export function canCacheCatalogRead(path: string, query?: object): boolean {
  // Estas fichas comprueban en vivo la disponibilidad de los videos CRV.
  if (/^\/(artists|albums)\/\d+$/u.test(path)) return false;
  if (!catalogCacheTtl(path)) return false;
  // Las superficies diarias dependen de la fecha entregada por DailyCycleProvider.
  if (path === "/home" || path === "/ephemerides") {
    return typeof (query as { date?: unknown } | undefined)?.date === "string";
  }
  return true;
}
