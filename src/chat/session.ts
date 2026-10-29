// CRV · Sesión de invitado del chat.
//
// El navegador recibe un token firmado (HMAC-SHA256) con el id del actor. El
// token viaja en la query del WebSocket —una cookie SameSite=Lax no se envía
// en una conexión WS entre orígenes distintos, como la web de desarrollo en
// :5173 y la API en :8080— y también se guarda en una cookie HttpOnly para
// las llamadas REST. No hay contraseñas: la identidad es un actor de chat que
// la futura cuenta de CRV podrá reclamar.
//
// Etapa 1 del plan de apertura: el token caduca (CRV_CHAT_TOKEN_TTL_DAYS) y
// lleva la `token_version` del actor; subirla en la base (baneo, cerrar
// sesiones) invalida todos los tokens emitidos. Formato:
//   v2.<actorId>.<versión>.<caducidad en s>.<firma>
// El formato viejo (<actorId>.<firma>, sin caducidad) solo sirve para
// renovar la sesión en POST /chat/session: así nadie pierde sus monedas.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";
import { meetsDifficulty, sha256Hex } from "./pow.js";

export const CHAT_COOKIE = "crv_chat";
const LEGACY_RE = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/u;
const TOKEN_RE = /^v2\.([0-9a-f-]{36})\.(\d{1,9})\.(\d{10,12})\.([0-9a-f]{64})$/u;
const DEV_SECRET = "crv-chat-dev-secret-cambiar-en-produccion";

export interface ChatTokenClaims {
  actorId: string;
  version: number;
  /** Caducidad en ms desde epoch; `null` en un token del formato viejo. */
  expiresAt: number | null;
  legacy: boolean;
}

function hmac(payload: string): string {
  return createHmac("sha256", getEnv().CRV_CHAT_SECRET).update(payload).digest("hex");
}

function sameHex(given: string, expected: string): boolean {
  const a = Buffer.from(given, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * El secreto de desarrollo es público (está en el repositorio): en
 * producción el chat no arranca con él. Lo llama el entrypoint del chat.
 */
export function assertChatSecret(): void {
  const env = getEnv();
  if (env.NODE_ENV === "production" && env.CRV_CHAT_SECRET === DEV_SECRET) {
    throw new Error(
      "CRV_CHAT_SECRET falta o es el valor de desarrollo; el chat no arranca en producción sin un secreto propio "
      + "(~/.config/crv-chat.env, 32+ caracteres).",
    );
  }
}

export function usingDevSecret(): boolean {
  return getEnv().CRV_CHAT_SECRET === DEV_SECRET;
}

export function issueChatToken(actorId: string, version: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + getEnv().CRV_CHAT_TOKEN_TTL_DAYS * 86_400;
  const body = `v2.${actorId}.${version}.${exp}`;
  return `${body}.${hmac(`chat:${body}`)}`;
}

/** Firma y forma válidas; la versión y el baneo los comprueba quien consulta la base. */
export function verifyChatToken(token: string, options: { allowLegacy?: boolean; now?: number } = {}): ChatTokenClaims | null {
  const now = options.now ?? Date.now();
  const match = TOKEN_RE.exec(token);
  if (match) {
    const [, actorId, version, exp, signature] = match;
    if (!actorId || !version || !exp || !signature) return null;
    const body = `v2.${actorId}.${version}.${exp}`;
    if (!sameHex(signature, hmac(`chat:${body}`))) return null;
    const expiresAt = Number(exp) * 1000;
    if (expiresAt <= now) return null;
    return { actorId, version: Number(version), expiresAt, legacy: false };
  }
  if (!options.allowLegacy) return null;
  const legacy = LEGACY_RE.exec(token);
  if (!legacy) return null;
  const [, actorId, signature] = legacy;
  if (!actorId || !signature || !sameHex(signature, hmac(`chat:${actorId}`))) return null;
  return { actorId, version: 1, expiresAt: null, legacy: true };
}

export function chatCookieOptions(secure: boolean): {
  path: string; httpOnly: true; sameSite: "lax"; secure: boolean; maxAge: number;
} {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // `secure` lo decide el protocolo real de la petición (detrás del proxy
    // de producción llega como https), no una variable de entorno.
    secure,
    maxAge: getEnv().CRV_CHAT_TOKEN_TTL_DAYS * 86_400,
  };
}

// ── Prueba de trabajo para crear invitados ─────────────────────────────────
// Sin captcha de terceros: el navegador busca un `nonce` tal que
// sha256(`${desafío}:${nonce}`) empiece con N bits a cero. El desafío va
// firmado, ligado a la IP, caduca a los 5 minutos y se gasta una sola vez.

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_RE = /^(\d{13})\.([0-9a-f]{24})\.(\d{1,2})\.([0-9a-f]{64})$/u;
const spent = new Map<string, number>();

export interface PowChallenge { challenge: string; bits: number; expiresAt: string }

export function issuePowChallenge(ip: string, now = Date.now()): PowChallenge {
  const bits = getEnv().CRV_CHAT_POW_BITS;
  const body = `${now}.${randomBytes(12).toString("hex")}.${bits}`;
  return {
    challenge: `${body}.${hmac(`pow:${ip}:${body}`)}`,
    bits,
    expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
  };
}

export type PowFailure = "missing" | "malformed" | "forged" | "expired" | "spent" | "weak";

/** Comprueba y gasta un desafío resuelto. Devuelve el motivo del rechazo o `null`. */
export function verifyPow(ip: string, challenge: string | undefined, nonce: string | undefined, now = Date.now()): PowFailure | null {
  const required = getEnv().CRV_CHAT_POW_BITS;
  if (required === 0) return null;
  if (!challenge || !nonce) return "missing";
  const match = CHALLENGE_RE.exec(challenge);
  if (!match || !/^\d{1,12}$/u.test(nonce)) return "malformed";
  const [, issued, random, bits, signature] = match;
  if (!issued || !random || !bits || !signature) return "malformed";
  if (!sameHex(signature, hmac(`pow:${ip}:${issued}.${random}.${bits}`))) return "forged";
  if (now - Number(issued) > CHALLENGE_TTL_MS || Number(issued) > now + 60_000) return "expired";
  // Un desafío emitido con menos bits de los que hoy se exigen no vale.
  if (Number(bits) < required) return "weak";
  if (spent.has(challenge)) return "spent";
  if (!meetsDifficulty(sha256Hex(`${challenge}:${nonce}`), Number(bits))) return "weak";
  for (const [key, at] of spent) if (now - at > CHALLENGE_TTL_MS) spent.delete(key);
  spent.set(challenge, now);
  return null;
}
