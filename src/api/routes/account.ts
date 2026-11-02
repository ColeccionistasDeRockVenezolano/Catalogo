// CRV · «Mi perfil» (/cuenta): lectura, guardado y cambio de clave.
//
// Todas las rutas son de la propia cuenta: no reciben id ni permiten tocar a
// otra persona. El guardián global (src/api/auth.ts) exige sesión y CSRF en
// las escrituras; `roleCanAccess` deja pasar a cualquier rol porque nadie
// administra su perfil con permisos de catálogo.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../http-errors.js";
import { createWindowLimiter } from "../rate-limit.js";
import { readOwnProfile, resolveOwner, saveOwnProfile, changeOwnPassword, validateProfileFields } from "../account/store.js";

const linkBody = z.object({
  type: z.string().trim().max(40).optional(),
  label: z.string().trim().max(120).optional(),
  url: z.string().trim().max(500),
  isPublic: z.boolean().optional(),
});

const profileBody = z.object({
  firstName: z.string().max(80),
  lastName: z.string().max(80),
  birthDate: z.string().trim().max(10).optional(),
  whatsappPhone: z.string().trim().max(120).optional(),
  email: z.string().trim().max(120).optional(),
  city: z.string().max(200).optional(),
  country: z.string().max(200).optional(),
  bio: z.string().max(2_000).optional(),
  experience: z.string().max(2_000).optional(),
  availability: z.string().max(200).optional(),
  contactPreference: z.enum(["whatsapp", "email", "both"]).optional(),
  profileVisibility: z.enum(["private", "public"]).optional(),
  termIds: z.array(z.number().int().positive()).max(40).optional(),
  links: z.array(linkBody).max(10).optional(),
}).strict();

/** TEMPORAL-PORTADA: «Mi perfil» 1:1 guarda perfil y clave con un solo botón. */
const saveBody = profileBody.extend({
  currentAccessCode: z.string().max(200).optional(),
  newAccessCode: z.string().max(200).optional(),
  newAccessCodeConfirm: z.string().max(200).optional(),
}).strict();

const passwordBody = z.object({
  currentAccessCode: z.string().min(1).max(200),
  newAccessCode: z.string().min(1).max(200),
  newAccessCodeConfirm: z.string().min(1).max(200),
}).strict();

/** Sin `request.account` la sesión no es de una cuenta de herra. */
function accountRef(request: { account: { kind: "user" | "admin" | "local"; id: number } | null }) {
  if (!request.account) {
    throw new ApiError(401, "unauthorized", "Inicia sesión para ver tu perfil.");
  }
  return request.account;
}

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  // Cambiar la clave es caro (scrypt) y no debe servir para probar claves
  // ajenas a ritmo de script; el límite es por cuenta autenticada.
  const passwordLimiter = createWindowLimiter({ max: 8, windowMs: 10 * 60_000, maxKeys: 2_000 });

  api.get("/account/profile", { schema: { tags: ["Cuenta"] } }, async (request) => {
    const account = accountRef(request);
    return readOwnProfile(account.kind, account.id);
  });

  api.patch("/account/profile", {
    schema: { tags: ["Cuenta"], body: profileBody },
  }, async (request) => {
    const account = accountRef(request);
    return saveOwnProfile(account.kind, account.id, request.body);
  });

  // Mismo orden que Herra: lo que se puede validar antes de escribir va primero;
  // una clave actual incorrecta no deja el perfil a medio guardar.
  api.post("/account/save", {
    schema: { tags: ["Cuenta"], body: saveBody },
  }, async (request) => {
    const account = accountRef(request);
    const { currentAccessCode, newAccessCode, newAccessCodeConfirm, ...profile } = request.body;
    const owner = await resolveOwner(account.kind, account.id);
    const hasProfile = owner?.user_id != null;
    if (hasProfile) validateProfileFields(profile);
    const wantsPassword = Boolean(currentAccessCode || newAccessCode || newAccessCodeConfirm);
    if (wantsPassword) {
      if (!currentAccessCode) throw new ApiError(400, "password_current_missing", "Escribe tu clave actual para poder cambiarla.");
      if (newAccessCode !== newAccessCodeConfirm) throw new ApiError(400, "password_mismatch", "Las claves nuevas no coinciden.");
      if (!passwordLimiter.take(`${account.kind}:${account.id}`)) {
        throw new ApiError(429, "rate_limited", "Demasiados cambios de clave seguidos. Espera unos minutos.");
      }
      const result = await changeOwnPassword(account.kind, account.id, currentAccessCode, newAccessCode ?? "");
      await request.server.restampSession(request, result.sessionVersion);
    }
    if (hasProfile) await saveOwnProfile(account.kind, account.id, profile);
    return { ok: true as const, saved: wantsPassword ? (hasProfile ? "both" as const : "password" as const) : "profile" as const };
  });

  api.post("/account/password", {
    schema: { tags: ["Cuenta"], body: passwordBody },
  }, async (request) => {
    const account = accountRef(request);
    const { currentAccessCode, newAccessCode, newAccessCodeConfirm } = request.body;
    if (!passwordLimiter.take(`${account.kind}:${account.id}`)) {
      throw new ApiError(429, "rate_limited", "Demasiados cambios de clave seguidos. Espera unos minutos.");
    }
    if (newAccessCode !== newAccessCodeConfirm) {
      throw new ApiError(400, "password_mismatch", "Las claves nuevas no coinciden.");
    }
    const result = await changeOwnPassword(account.kind, account.id, currentAccessCode, newAccessCode);
    // La versión de la cuenta subió: se reestampa la sesión en curso para que
    // quien cambió su clave siga dentro y las demás sesiones queden fuera.
    await request.server.restampSession(request, result.sessionVersion);
    return { ok: true as const };
  });
}
