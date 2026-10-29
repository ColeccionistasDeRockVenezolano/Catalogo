// CRV · Sesión de colaborador vista desde el proceso del chat.
//
// Las sesiones de administrador viven en la memoria de la API del catálogo
// (src/api/auth.ts). El chat es otro proceso, así que sin esto un
// administrador con sesión abierta recibía 401 en /chat/admin/*. El chat
// reenvía la cookie a `GET /auth/me` por loopback y guarda la respuesta 30 s.
// El CSRF que devuelve la API se compara después en el hook de auth igual
// que una sesión local.
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getEnv } from "../config/env.js";
import type { AccountRole, RemoteSessionResolver } from "../api/auth.js";

interface Cached { value: { name: string; role: AccountRole; csrf: string } | undefined; until: number }

const cache = new Map<string, Cached>();
const TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 5_000;

export function apiSessionResolver(baseUrl = `http://127.0.0.1:${getEnv().PORT}`): RemoteSessionResolver {
  return async (request: FastifyRequest) => {
    const cookie = request.headers.cookie;
    // Sin la cookie de sesión de colaborador no hay nada que preguntar.
    if (!cookie || !/(?:^|;\s*)crv_session=/u.test(cookie)) return undefined;
    const key = createHash("sha256").update(cookie).digest("base64url");
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.until > now) return hit.value;
    let value: Cached["value"];
    try {
      const response = await fetch(`${baseUrl}/auth/me`, {
        headers: { cookie },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const body = await response.json() as { user?: { name?: string; role?: AccountRole }; csrf?: string };
        if (body.user?.name && body.user.role && body.csrf) value = { name: body.user.name, role: body.user.role, csrf: body.csrf };
      }
    } catch {
      // API caída: sin sesión (las rutas de administración responden 401).
      value = undefined;
    }
    if (cache.size > 2_000) cache.clear();
    cache.set(key, { value, until: now + (value ? TTL_MS : NEGATIVE_TTL_MS) });
    return value;
  };
}
