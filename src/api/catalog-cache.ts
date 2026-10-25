import type { FastifyInstance } from "fastify";
import { ReadCache } from "../shared/read-cache.js";
import { catalogCacheKey, catalogCacheTtl, isCommonCatalogRead, isCatalogWrite } from "../shared/catalog-cache-policy.js";
import { dailyDate } from "../shared/daily-cycle.js";
import { publishCatalogRevision, readCatalogRevision } from "../storage/catalog-cache-revision.js";
import { invalidateSearchIndex } from "./search-index.js";
import { clearSearchResults } from "./repositories/search.js";

export function registerCatalogCache(app: FastifyInstance): void {
  const cache = new ReadCache<unknown>();
  const requestKeys = new WeakMap<object, string>();
  let revision: string | undefined;
  let generation = 0;
  async function synchronize(): Promise<void> {
    const current = await readCatalogRevision();
    if (revision === undefined) { revision = current; return; }
    if (revision === current) return;
    revision = current;
    generation++;
    cache.clear();
    clearSearchResults();
    invalidateSearchIndex();
  }

  // También observa el marcador al volver a enfocar una página ya abierta.
  app.get("/catalog/cache-version", async (_request, reply) => {
    await synchronize();
    reply.header("cache-control", "no-store");
    return { revision };
  });

  app.addHook("preHandler", async request => {
    if (request.method === "GET" && request.url.split("?")[0] === "/search") await synchronize();
  });

  app.addHook("onRoute", options => {
    if (options.method !== "GET") return;
    // Las rutas parametrizadas se evalúan con un id representativo.
    if (!catalogCacheTtl(options.url.replace(/:id\b/gu, "1"))) return;
    const handler = options.handler;
    options.handler = async function (request, reply) {
      await synchronize();
      const url = new URL(request.url, "http://catalog.local");
      // Los conteos son comunes; las fichas con datos de trabajo no se comparten.
      if ((request.viewer || request.headers.authorization) && !isCommonCatalogRead(url.pathname)) return handler.call(this, request, reply);
      const ttl = catalogCacheTtl(url.pathname);
      if (url.pathname === "/home" || url.pathname === "/ephemerides" || /^\/artists\/\d+$/u.test(url.pathname)) {
        if (!url.searchParams.has("date")) {
          const date = dailyDate();
          url.searchParams.set("date", date);
          (request.query as { date?: string }).date = date;
        }
      }
      const startedRevision = revision;
      const key = `${generation}:${catalogCacheKey(url)}`;
      requestKeys.set(request, key);
      const hit = cache.has(key);
      const value = await cache.get(key, ttl, async () => {
        const result = await handler.call(this, request, reply);
        if (reply.sent || reply.statusCode !== 200) throw new Error("Una lectura cacheable debe devolver JSON con estado 200");
        return result;
      });
      // Revalidar HTTP permite que deploy invalide inmediatamente la caché del servidor.
      reply.header("cache-control", "private, no-cache");
      reply.header("vary", "Cookie, Authorization, Origin");
      reply.header("x-crv-cache", hit ? "HIT" : "MISS");
      reply.header("x-crv-cache-version", startedRevision);
      reply.header("x-crv-cache-ttl", String(ttl / 1000));
      return value;
    };
  });

  // La validación/serialización de la respuesta también puede fallar después del handler.
  app.addHook("onError", async request => {
    const key = requestKeys.get(request);
    if (key) cache.delete(key);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const path = request.url.split("?")[0]!;
    if (!isCatalogWrite(request.method, path) || reply.statusCode >= 400) return payload;
    try { await publishCatalogRevision(); await synchronize(); }
    catch (error) { cache.clear(); app.log.error({ err: error }, "no se pudo publicar la invalidación de caché"); }
    return payload;
  });
}
