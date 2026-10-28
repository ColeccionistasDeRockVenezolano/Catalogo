// CRV · Sesión de invitado del chat.
//
// El navegador recibe un token firmado (HMAC-SHA256) con el id del actor. El
// token viaja en la query del WebSocket —una cookie SameSite=Lax no se envía
// en una conexión WS entre orígenes distintos, como la web de desarrollo en
// :5173 y la API en :8080— y también se guarda en una cookie HttpOnly para
// las llamadas REST. No hay contraseñas: la identidad es un actor de chat que
// la futura cuenta de CRV podrá reclamar.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";

export const CHAT_COOKIE = "crv_chat";
const TOKEN_RE = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/u;

function sign(actorId: string, secret: string): string {
  return createHmac("sha256", secret).update(`chat:${actorId}`).digest("hex");
}

export function issueChatToken(actorId: string): string {
  return `${actorId}.${sign(actorId, getEnv().CRV_CHAT_SECRET)}`;
}

export function verifyChatToken(token: string): string | null {
  const match = TOKEN_RE.exec(token);
  if (!match) return null;
  const [, actorId, signature] = match;
  if (!actorId || !signature) return null;
  const expected = sign(actorId, getEnv().CRV_CHAT_SECRET);
  const given = Buffer.from(signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  return actorId;
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
    maxAge: 60 * 60 * 24 * 365,
  };
}
