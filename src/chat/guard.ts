// CRV · Límites anti-abuso del chat (en memoria, por proceso).
//
// Cada escritura cuenta a la vez contra el ACTOR (todas sus pestañas y
// conexiones suman) y contra la IP (varias cuentas desde el mismo equipo
// suman). Antes el límite era por conexión: abrir cinco pestañas multiplicaba
// por cinco el cupo. El chat vive en un solo proceso (docs/CHAT.md), así que
// la memoria basta; con varios procesos esto pasaría a Redis.
import { getEnv } from "../config/env.js";
import { createWindowLimiter, type WindowLimiter } from "../api/rate-limit.js";
import { repeatKey } from "./moderation/text.js";

export type GuardKind =
  | "message" | "typing" | "equip" | "profile" | "action" | "report" | "buy" | "session" | "challenge";

interface Rule { windowMs: number; actor: number; ip: number }

/** Topes por ventana. `message` toma el valor de CRV_CHAT_RATE_LIMIT. */
export function guardRules(): Record<GuardKind, Rule> {
  const perActor = getEnv().CRV_CHAT_RATE_LIMIT;
  return {
    message: { windowMs: 10_000, actor: perActor, ip: perActor * 3 },
    typing: { windowMs: 10_000, actor: 20, ip: 60 },
    equip: { windowMs: 60_000, actor: 12, ip: 40 },
    profile: { windowMs: 10 * 60_000, actor: 3, ip: 10 },
    action: { windowMs: 60_000, actor: 4, ip: 12 },
    report: { windowMs: 10 * 60_000, actor: 6, ip: 20 },
    buy: { windowMs: 60_000, actor: 20, ip: 60 },
    session: { windowMs: 10 * 60_000, actor: 0, ip: getEnv().CRV_CHAT_SESSIONS_PER_IP },
    challenge: { windowMs: 10 * 60_000, actor: 0, ip: 30 },
  };
}

/** Mensajes por 10 s de una cuenta nueva (primeros CRV_CHAT_NEW_ACCOUNT_MINUTES). */
export const NEW_ACCOUNT_MESSAGES = 3;
export const MAX_SOCKETS_PER_ACTOR = 4;
export const MAX_SOCKETS_PER_IP = 12;
/** Tras una expulsión, el actor no puede volver a conectar durante este tiempo. */
export const KICK_COOLDOWN_MS = 5 * 60_000;

export type GuardResult = { ok: true } | { ok: false; scope: "actor" | "ip" };
export type RepeatResult = "ok" | "repeated";

export class ChatGuard {
  private readonly limiters = new Map<string, WindowLimiter>();
  private readonly socketsByActor = new Map<string, number>();
  private readonly socketsByIp = new Map<string, number>();
  private readonly lastInRoom = new Map<string, number>();
  private readonly recent = new Map<string, Array<{ key: string; at: number }>>();
  private readonly kicked = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private limiter(name: string, max: number, windowMs: number): WindowLimiter {
    const id = `${name}:${max}:${windowMs}`;
    let limiter = this.limiters.get(id);
    if (!limiter) {
      limiter = createWindowLimiter({ max, windowMs, maxKeys: 20_000 });
      this.limiters.set(id, limiter);
    }
    return limiter;
  }

  /**
   * Consume cupo de actor e IP. Una cuenta nueva tiene un cupo de mensajes
   * menor. El cupo del actor se consume primero: si la IP ya está llena, el
   * actor pierde ese intento igualmente (no hay forma de «ahorrar» cupo).
   */
  take(kind: GuardKind, who: { actorId?: string; ip?: string; newAccount?: boolean }): GuardResult {
    const rule = guardRules()[kind];
    if (who.actorId && rule.actor > 0) {
      const max = kind === "message" && who.newAccount ? Math.min(rule.actor, NEW_ACCOUNT_MESSAGES) : rule.actor;
      if (!this.limiter(`${kind}:actor`, max, rule.windowMs).take(who.actorId)) return { ok: false, scope: "actor" };
    }
    if (who.ip && rule.ip > 0) {
      if (!this.limiter(`${kind}:ip`, rule.ip, rule.windowMs).take(who.ip)) return { ok: false, scope: "ip" };
    }
    return { ok: true };
  }

  // ── Conexiones ───────────────────────────────────────────────────────────

  /** Reserva un hueco de conexión; `release` lo devuelve al cerrar. */
  openSocket(actorId: string, ip: string): "ok" | "actor_limit" | "ip_limit" | "kicked" {
    const until = this.kicked.get(actorId);
    if (until !== undefined) {
      if (until > this.now()) return "kicked";
      this.kicked.delete(actorId);
    }
    if ((this.socketsByActor.get(actorId) ?? 0) >= MAX_SOCKETS_PER_ACTOR) return "actor_limit";
    if ((this.socketsByIp.get(ip) ?? 0) >= MAX_SOCKETS_PER_IP) return "ip_limit";
    this.socketsByActor.set(actorId, (this.socketsByActor.get(actorId) ?? 0) + 1);
    this.socketsByIp.set(ip, (this.socketsByIp.get(ip) ?? 0) + 1);
    return "ok";
  }

  releaseSocket(actorId: string, ip: string): void {
    decrement(this.socketsByActor, actorId);
    decrement(this.socketsByIp, ip);
  }

  kick(actorId: string): void {
    this.kicked.set(actorId, this.now() + KICK_COOLDOWN_MS);
  }

  // ── Modo lento y repeticiones ────────────────────────────────────────────

  /** Segundos que faltan para poder escribir en la sala (0 si ya puede). */
  slowModeWait(roomSlug: string, actorId: string, seconds: number): number {
    if (seconds <= 0) return 0;
    const last = this.lastInRoom.get(`${roomSlug}:${actorId}`);
    if (last === undefined) return 0;
    const wait = last + seconds * 1000 - this.now();
    return wait > 0 ? Math.ceil(wait / 1000) : 0;
  }

  /**
   * ¿Repite lo mismo? Bloquea el mismo texto que el mensaje anterior en
   * menos de 15 s, o la tercera vez en 3 minutos. El texto se compara por
   * su esqueleto: «HOLA», «h0la» y «hoooola» son el mismo mensaje.
   */
  checkRepeat(actorId: string, body: string): RepeatResult {
    const key = repeatKey(body);
    if (!key) return "ok";
    const now = this.now();
    const history = (this.recent.get(actorId) ?? []).filter((item) => now - item.at < 3 * 60_000);
    const last = history[history.length - 1];
    if (last && last.key === key && now - last.at < 15_000) return "repeated";
    if (history.filter((item) => item.key === key).length >= 2) return "repeated";
    return "ok";
  }

  /** Registra un mensaje enviado (para modo lento y repeticiones). */
  recordMessage(roomSlug: string, actorId: string, body: string): void {
    const now = this.now();
    this.lastInRoom.set(`${roomSlug}:${actorId}`, now);
    const history = (this.recent.get(actorId) ?? []).filter((item) => now - item.at < 3 * 60_000);
    history.push({ key: repeatKey(body), at: now });
    this.recent.set(actorId, history.slice(-5));
  }

  /** Limpieza periódica de las tablas en memoria. */
  sweep(): void {
    const now = this.now();
    for (const [key, at] of this.lastInRoom) if (now - at > 3_600_000) this.lastInRoom.delete(key);
    for (const [key, items] of this.recent) if (items.every((item) => now - item.at > 3 * 60_000)) this.recent.delete(key);
    for (const [key, until] of this.kicked) if (until <= now) this.kicked.delete(key);
  }
}

function decrement(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 0) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}
