import { EQUIPPED_SLOTS } from "./slots.js";
// CRV · Tiempo real del chat (WebSocket).
//
// Un proceso, una sala por conexión, presencia en memoria. El estado durable
// (mensajes, inventario, monedas, sanciones) vive en PostgreSQL; aquí solo se
// guarda quién está conectado y qué efecto lleva puesto, que es lo que cambia
// cien veces por minuto y no merece una escritura por evento.
//
// Etapa 1 del plan de apertura (docs/CHAT.md §«Seguridad y moderación»): cada
// evento pasa por el guardia (límites por actor e IP, modo lento,
// repeticiones), el filtro de texto y el detector de actividad sospechosa.
import { randomUUID } from "node:crypto";
import { getEnv } from "../config/env.js";
import { moduleLogger } from "../logger/index.js";
import {
  ChatError, actorById, effectsFor, equipEffect, equippedFor, equippedForMany, insertMessage, isIpBanned, listMessages,
  ownedEffectKind, ownsEffect, roomBySlug, touchActor, updateDisplayName, walletFor, type Actor, type ChatOrigin,
} from "./repository.js";
import { clientEventSchema, type ChatRoom, type ChatUser, type Equipped, type ModerationAlert, type ServerEvent } from "./protocol.js";
import { ChatGuard, type GuardKind } from "./guard.js";
import { SuspicionDetector, type SuspicionTrip } from "./moderation/detector.js";
import { containsLink, filterText, repeatKey, sanitizeBody } from "./moderation/text.js";
import { createReport, hideMessage, muteActor } from "./moderation/store.js";
import type { ChatTokenClaims } from "./session.js";

const log = moduleLogger("chat-realtime");

/** Minutos de silencio automático cuando el detector supera el umbral. */
export const AUTO_MUTE_MINUTES = 15;

/** Lo mínimo que usamos de un socket de `ws` (evita atar el módulo a su tipo). */
export interface ChatSocket {
  readonly bufferedAmount?: number;
  readonly readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "pong", listener: () => void): void;
  ping(): void;
}

interface Member {
  actor: ChatUser;
  sockets: Set<ChatSocket>;
}

interface Connection {
  ready: boolean;
  outgoing: ServerEvent[];
  actorId: string;
  roomSlug: string;
  lastActivity: number;
  origin: ChatOrigin;
  ip: string;
  /** Cuenta de CRV con rol de administrador que abrió este socket, o null. */
  moderator: string | null;
  createdAt: number;
  mutedUntil: number | null;
}

export interface ConnectContext {
  claims: ChatTokenClaims;
  roomSlug: string;
  origin: ChatOrigin;
  moderator: string | null;
}

/** Cierres con código propio: el cliente no reintenta 4401/4403. */
export const CLOSE = {
  noSession: 4401,
  banned: 4403,
  roomMissing: 4404,
  tooMany: 4429,
} as const;

export class ChatHub {
  private readonly rooms = new Map<string, Map<string, Member>>();
  private readonly connections = new Map<ChatSocket, Connection>();
  private stopped = false;
  private refreshing = false;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly eventQueues = new Map<string, { tail: Promise<void>; size: number }>();
  readonly guard: ChatGuard;
  readonly detector: SuspicionDetector;

  constructor(options: { now?: () => number } = {}) {
    this.guard = new ChatGuard(options.now);
    this.detector = new SuspicionDetector((trip) => { void this.onSuspicionTrip(trip); }, options.now);
    this.heartbeat = setInterval(() => this.sweep(), 30_000);
    this.heartbeat.unref();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.heartbeat);
    for (const socket of this.connections.keys()) socket.close(1001, "servidor detenido");
    this.connections.clear();
    this.rooms.clear();
  }

  async connect(socket: ChatSocket, context: ConnectContext): Promise<void> {
    // Los listeners se registran ANTES de consultar la base: un cliente que
    // escribe nada más abrir el socket no puede perder el mensaje. Los
    // eventos que llegan durante el arranque se guardan y se procesan al
    // final, justo después del snapshot (con tope: un cliente no puede
    // llenar la memoria mientras espera).
    let connection: Connection | null = null;
    let closed = false;
    const pending: unknown[] = [];
    socket.on("message", (data) => {
      if (connection?.ready) this.enqueue(socket, connection.actorId, data);
      else if (pending.length < 10) pending.push(data);
    });
    socket.on("close", () => { closed = true; this.onClose(socket); });
    socket.on("pong", () => { if (connection) connection.lastActivity = Date.now(); });

    const ip = context.origin.ip ?? "desconocida";
    const [actor, room, ipBanned] = await Promise.all([
      actorById(context.claims.actorId), roomBySlug(context.roomSlug), isIpBanned(context.origin.ip),
    ]);
    if (!actor || actor.tokenVersion !== context.claims.version) {
      send(socket, { type: "error", code: "session_expired", message: "Tu sesión de chat caducó. Recarga la página." });
      socket.close(CLOSE.noSession, "sin sesión");
      return;
    }
    if (actor.bannedAt || ipBanned) {
      send(socket, { type: "error", code: "banned", message: "No puedes entrar a La Rockola." });
      socket.close(CLOSE.banned, "baneado");
      return;
    }
    if (!room) {
      send(socket, { type: "error", code: "room_not_found", message: "Esa sala no existe." });
      socket.close(CLOSE.roomMissing, "sala inexistente");
      return;
    }
    const slot = this.guard.openSocket(actor.id, ip);
    if (slot !== "ok") {
      const message = slot === "kicked"
        ? "Te sacaron de la sala hace poco. Vuelve en unos minutos."
        : "Tienes demasiadas conexiones abiertas. Cierra alguna pestaña.";
      send(socket, { type: "error", code: slot, message });
      socket.close(slot === "kicked" ? CLOSE.banned : CLOSE.tooMany, slot);
      return;
    }
    // Se cerró mientras consultábamos la base: devolver el hueco y salir.
    if (closed || this.stopped) {
      this.guard.releaseSocket(actor.id, ip);
      return;
    }

    try {
      const equipped = await equippedFor(actor.id);
      if (closed || this.stopped) { this.guard.releaseSocket(actor.id, ip); return; }
      const user = toChatUser(actor, equipped);
      const members = this.rooms.get(room.slug) ?? new Map<string, Member>();
      this.rooms.set(room.slug, members);
      const firstConnection = !members.has(actor.id);
      const member = members.get(actor.id) ?? { actor: user, sockets: new Set<ChatSocket>() };
      member.actor = user;
      member.sockets.add(socket);
      members.set(actor.id, member);

      connection = {
        ready: false, outgoing: [],
        actorId: actor.id, roomSlug: room.slug, lastActivity: Date.now(), origin: context.origin, ip,
        moderator: context.moderator, createdAt: actor.createdAt.getTime(),
        mutedUntil: actor.mutedUntil ? actor.mutedUntil.getTime() : null,
      };
      this.connections.set(socket, connection);
      void touchActor(actor.id, context.origin).catch((error: unknown) => log.warn({ err: error }, "no se pudo registrar la visita"));

      const [messages, effects, wallet] = await Promise.all([
        listMessages(room.id, 50), effectsFor(actor.id), walletFor(actor.id),
      ]);
      if (closed) return;
      send(socket, {
        type: "snapshot", room, actor: member.actor, me: wallet, messages, users: this.presence(room.slug), effects,
      });
      connection.ready = true;
      for (const event of connection.outgoing.splice(0)) send(socket, event);
      if (connection.mutedUntil && connection.mutedUntil > Date.now()) {
        send(socket, { type: "muted", until: new Date(connection.mutedUntil).toISOString(), reason: "" });
      }
      this.broadcast(room.slug, { type: "presence", users: this.presence(room.slug) });

      // Solo una entrada por presencia, incluso con varias pestañas abiertas.
      const entry = effects.filter((effect) => effect.kind === "entry" && effect.owned)
        .sort((a, b) => b.priceCoins - a.priceCoins || a.code.localeCompare(b.code))[0];
      if (firstConnection && entry) this.broadcast(room.slug, {
        type: "entry", id: randomUUID(), actorId: user.id, displayName: user.displayName,
        effectCode: entry.code, equipped,
      });
      for (const data of pending.splice(0)) this.enqueue(socket, connection.actorId, data);
    } catch (error) {
      if (connection) this.onClose(socket);
      else this.guard.releaseSocket(actor.id, ip);
      throw error;
    }
  }

  /** Todas las pestañas de un actor comparten orden y una cola acotada.
   * El siguiente evento comprueba modo lento/repetidos después del INSERT
   * anterior, nunca mientras ese INSERT sigue pendiente.
   */
  private enqueue(socket: ChatSocket, actorId: string, data: unknown): void {
    const queue = this.eventQueues.get(actorId) ?? { tail: Promise.resolve(), size: 0 };
    if (queue.size >= 16) {
      this.detector.add(actorId, "rate_limited");
      send(socket, { type: "error", code: "rate_limited", message: "Vas muy rápido; espera unos segundos." });
      return;
    }
    queue.size += 1;
    queue.tail = queue.tail.then(() => this.onMessage(socket, data)).catch((error: unknown) => {
      log.error({ err: error }, "evento del chat falló");
      send(socket, { type: "error", code: "internal", message: "No se pudo procesar el evento." });
    }).finally(() => {
      queue.size -= 1;
      if (queue.size === 0) this.eventQueues.delete(actorId);
    });
    this.eventQueues.set(actorId, queue);
  }

  private limit(socket: ChatSocket, connection: Connection, kind: GuardKind, quiet = false): boolean {
    const result = this.guard.take(kind, {
      actorId: connection.actorId, ip: connection.ip, newAccount: this.isNewAccount(connection),
    });
    if (result.ok) return true;
    if (kind === "message" || kind === "action") this.detector.add(connection.actorId, "rate_limited");
    if (!quiet) {
      send(socket, {
        type: "error", code: "rate_limited",
        message: result.scope === "ip"
          ? "Demasiada actividad desde tu conexión; espera unos segundos."
          : "Vas muy rápido; espera unos segundos.",
      });
    }
    return false;
  }

  private isNewAccount(connection: Connection): boolean {
    return Date.now() - connection.createdAt < getEnv().CRV_CHAT_NEW_ACCOUNT_MINUTES * 60_000;
  }

  private isMuted(socket: ChatSocket, connection: Connection): boolean {
    if (!connection.mutedUntil || connection.mutedUntil <= Date.now()) return false;
    const minutes = Math.ceil((connection.mutedUntil - Date.now()) / 60_000);
    send(socket, {
      type: "error", code: "muted",
      message: `Estás silenciado en La Rockola durante ${minutes} min más.`,
    });
    return true;
  }

  private async onMessage(socket: ChatSocket, raw: unknown): Promise<void> {
    const connection = this.connections.get(socket);
    if (!connection) return;
    connection.lastActivity = Date.now();
    const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      send(socket, { type: "error", code: "bad_json", message: "Evento ilegible." });
      return;
    }
    const event = clientEventSchema.safeParse(parsed);
    if (!event.success) {
      send(socket, { type: "error", code: "bad_event", message: "Evento no válido." });
      return;
    }
    if (event.data.type === "ping") return;
    const room = await roomBySlug(connection.roomSlug);
    if (!room) return;

    try {
      switch (event.data.type) {
        case "typing": {
          if (!this.limit(socket, connection, "typing", true)) return;
          if (event.data.active && connection.mutedUntil && connection.mutedUntil > Date.now()) return;
          const member = this.rooms.get(room.slug)?.get(connection.actorId);
          if (!member) return;
          this.broadcast(room.slug, {
            type: "typing", actorId: connection.actorId,
            displayName: member.actor.displayName, active: event.data.active,
          }, socket);
          return;
        }
        case "message":
          await this.onChatMessage(socket, connection, room, event.data.body, event.data.effectCode ?? null);
          return;
        case "action": {
          if (this.isMuted(socket, connection)) return;
          if (!this.limit(socket, connection, "action") || !this.limit(socket, connection, "message")) return;
          // Una acción es un efecto de la tienda: hay que tenerla.
          if (!(await ownsEffect(connection.actorId, event.data.code, ["action"]))) {
            send(socket, { type: "error", code: "not_owned", message: "Primero consigue esa acción en la tienda." });
            return;
          }
          const message = await insertMessage({
            roomId: room.id, actorId: connection.actorId, body: event.data.code,
            kind: "action", effectCode: event.data.code, origin: connection.origin,
          });
          this.broadcast(room.slug, { type: "message", message });
          return;
        }
        case "equip": {
          if (!this.limit(socket, connection, "equip")) return;
          const equipped = await equipEffect({
            actorId: connection.actorId,
            slot: event.data.slot,
            code: event.data.effectCode,
          });
          this.equipped(connection.actorId, equipped);
          return;
        }
        case "profile": {
          if (!this.limit(socket, connection, "profile")) return;
          const updated = await updateDisplayName(connection.actorId, event.data.displayName);
          this.renamed(connection.actorId, updated.displayName);
          return;
        }
      }
    } catch (error) {
      const known = error instanceof ChatError;
      if (!known) log.error({ err: error }, "evento del chat falló");
      send(socket, {
        type: "error",
        code: known ? error.code : "internal",
        message: known ? error.message : "No se pudo procesar el evento.",
      });
    }
  }

  private async onChatMessage(
    socket: ChatSocket, connection: Connection, room: ChatRoom, rawBody: string, requestedEffect: string | null,
  ): Promise<void> {
    if (this.isMuted(socket, connection)) return;
    const wait = this.guard.slowModeWait(room.slug, connection.actorId, connection.moderator ? 0 : room.slowModeSeconds);
    if (wait > 0) {
      send(socket, {
        type: "error", code: "slow_mode", retryAfter: wait,
        message: `Modo lento: puedes escribir de nuevo en ${wait} s.`,
      });
      return;
    }
    if (!this.limit(socket, connection, "message")) return;

    const clean = sanitizeBody(rawBody);
    if ("problem" in clean) {
      send(socket, {
        type: "error", code: clean.problem,
        message: clean.problem === "too_many_lines"
          ? "Demasiados saltos de línea: escribe en un solo bloque."
          : "El mensaje está vacío.",
      });
      return;
    }
    const isNew = this.isNewAccount(connection);
    if (isNew && containsLink(clean.body)) {
      this.detector.add(connection.actorId, "new_account_link");
      send(socket, {
        type: "error", code: "links_not_yet",
        message: `Las cuentas nuevas no pueden enviar enlaces durante sus primeros ${getEnv().CRV_CHAT_NEW_ACCOUNT_MINUTES} minutos.`,
      });
      return;
    }
    const filtered = filterText(clean.body);
    if (filtered.verdict === "block") {
      this.detector.add(connection.actorId, "blocked_words");
      send(socket, {
        type: "error", code: "blocked_words",
        message: "Ese mensaje contiene insultos discriminatorios y no se publicó.",
      });
      return;
    }
    if (this.guard.checkRepeat(connection.actorId, filtered.text) === "repeated") {
      this.detector.add(connection.actorId, "repeated");
      send(socket, { type: "error", code: "repeated", message: "Ya enviaste ese mensaje. Di algo nuevo." });
      return;
    }

    let effectCode = requestedEffect;
    const effectKind = effectCode ? await ownedEffectKind(connection.actorId, effectCode) : null;
    if (effectKind !== "message" && effectKind !== "sticker") effectCode = null;
    const message = await insertMessage({
      roomId: room.id, actorId: connection.actorId, body: filtered.text, kind: effectKind === "sticker" ? "sticker" : "chat", effectCode,
      origin: connection.origin, moderation: filtered.verdict === "mask" ? "masked" : null,
    });
    this.guard.recordMessage(room.slug, connection.actorId, filtered.text);
    this.broadcast(room.slug, { type: "message", message });
    this.detector.onMessage(connection.actorId, repeatKey(filtered.text), Date.now() - connection.createdAt);
  }

  private onClose(socket: ChatSocket): void {
    const connection = this.connections.get(socket);
    if (!connection) return;
    this.connections.delete(socket);
    this.guard.releaseSocket(connection.actorId, connection.ip);
    const members = this.rooms.get(connection.roomSlug);
    const member = members?.get(connection.actorId);
    if (members && member) {
      member.sockets.delete(socket);
      if (member.sockets.size === 0) {
        // Si se va mientras escribía, el aviso no puede quedarse pegado.
        this.broadcast(connection.roomSlug, {
          type: "typing", actorId: connection.actorId, displayName: member.actor.displayName, active: false,
        });
        members.delete(connection.actorId);
      }
      if (members.size === 0) this.rooms.delete(connection.roomSlug);
      this.broadcast(connection.roomSlug, { type: "presence", users: this.presence(connection.roomSlug) });
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - 90_000;
    for (const [socket, connection] of this.connections) {
      if (connection.lastActivity < cutoff) {
        socket.close(1000, "inactivo");
        continue;
      }
      try { socket.ping(); } catch { socket.close(1011, "ping fallido"); }
    }
    this.guard.sweep();
    this.detector.sweep();
    void this.refreshEquipped();
  }

  // ── Moderación (la llaman las rutas de administración y la IA) ──────────

  /** Cambio de apodo hecho por REST o por WS: presencia y detector. */
  renamed(actorId: string, displayName: string): void {
    this.detector.onRename(actorId);
    for (const [slug, members] of this.rooms) {
      const member = members.get(actorId);
      if (!member) continue;
      member.actor = { ...member.actor, displayName };
      this.broadcast(slug, { type: "presence", users: this.presence(slug) });
    }
  }

  /** Quita un mensaje de todas las pantallas. */
  removeMessage(roomSlug: string, messageId: number): void {
    this.broadcast(roomSlug, { type: "deleted", messageId });
  }

  /** Aplica un silencio a las conexiones abiertas (la base ya lo guardó). */
  applyMute(actorId: string, until: Date | null, reason: string): void {
    for (const [socket, connection] of this.connections) {
      if (connection.actorId !== actorId) continue;
      connection.mutedUntil = until ? until.getTime() : null;
      send(socket, { type: "muted", until: until ? until.toISOString() : null, reason });
    }
  }

  /** Expulsa (con espera para volver) o cierra por baneo. Devuelve cuántos sockets cerró. */
  disconnect(actorId: string, mode: "kick" | "ban", reason: string): number {
    if (mode === "kick") this.guard.kick(actorId);
    let closed = 0;
    for (const [socket, connection] of this.connections) {
      if (connection.actorId !== actorId) continue;
      send(socket, {
        type: "error", code: mode === "kick" ? "kicked" : "banned",
        message: mode === "kick"
          ? `Un moderador te sacó de la sala${reason ? `: ${reason}` : ""}. Podrás volver en unos minutos.`
          : "Un moderador te baneó de La Rockola.",
      });
      socket.close(CLOSE.banned, mode);
      closed += 1;
    }
    return closed;
  }

  /** Cierra todo lo que venga de una IP baneada. */
  disconnectIp(ip: string): number {
    let closed = 0;
    for (const [socket, connection] of this.connections) {
      if (connection.ip !== ip) continue;
      send(socket, { type: "error", code: "banned", message: "No puedes entrar a La Rockola." });
      socket.close(CLOSE.banned, "ip");
      closed += 1;
    }
    return closed;
  }

  /** Modo lento cambiado: todos reciben la sala actualizada. */
  async refreshRoom(roomSlug: string): Promise<void> {
    const room = await roomBySlug(roomSlug);
    if (room) this.broadcast(roomSlug, { type: "room", room });
  }

  /** Avisa a los moderadores conectados (sockets abiertos por un administrador de CRV). */
  alertModerators(alert: Omit<ModerationAlert, "at">): void {
    const event: ServerEvent = { type: "mod_alert", alert: { ...alert, at: new Date().toISOString() } };
    for (const [socket, connection] of this.connections) {
      if (!connection.moderator) continue;
      if (connection.ready) send(socket, event);
    }
  }

  displayNameOf(actorId: string): string | null {
    for (const members of this.rooms.values()) {
      const member = members.get(actorId);
      if (member) return member.actor.displayName;
    }
    return null;
  }

  /** El detector superó el umbral: silencio automático, auditoría, reporte y aviso. */
  private async onSuspicionTrip(trip: SuspicionTrip): Promise<void> {
    const reason = `Detector: ${trip.rules.join(", ")} (puntuación ${trip.score})`;
    try {
      const until = await muteActor({
        actorId: trip.actorId, minutes: AUTO_MUTE_MINUTES, moderator: "detector", reason, automatic: true,
      });
      await createReport({
        source: "detector", targetActor: trip.actorId, reason,
        details: { score: trip.score, rules: trip.rules },
      });
      this.applyMute(trip.actorId, until, "Actividad sospechosa: silencio automático.");
      this.alertModerators({
        kind: "auto_mute", actorId: trip.actorId, displayName: this.displayNameOf(trip.actorId), messageId: null,
        text: `${this.displayNameOf(trip.actorId) ?? "Un usuario"} quedó silenciado ${AUTO_MUTE_MINUTES} min. ${reason}`,
      });
      log.warn({ actorId: trip.actorId, score: trip.score, rules: trip.rules }, "silencio automático del detector");
    } catch (error) {
      log.error({ err: error, actorId: trip.actorId }, "no se pudo aplicar el silencio automático");
    }
  }

  /** La IA o los reportes ocultaron un mensaje. */
  async autoHide(messageId: number, moderator: "ia" | "reportes", reason: string): Promise<void> {
    const ref = await hideMessage({ messageId, moderator, reason, action: "auto_hide" });
    this.removeMessage(ref.roomSlug, messageId);
    this.alertModerators({
      kind: "auto_hide", actorId: ref.actorId, displayName: ref.actorId ? this.displayNameOf(ref.actorId) : null,
      messageId, text: `Mensaje ocultado (${moderator}): «${ref.body.slice(0, 80)}». ${reason}`,
    });
  }

  /** REST y WS actualizan todas las salas y pestañas del actor. */
  equipped(actorId: string, equipped: Equipped): void {
    for (const [slug, members] of this.rooms) {
      const member = members.get(actorId);
      if (!member) continue;
      member.actor = { ...member.actor, equipped };
      this.broadcast(slug, { type: "equipped", actorId, equipped });
      this.broadcast(slug, { type: "presence", users: this.presence(slug) });
    }
  }

  /** Una consulta por barrido, incluidos los alquileres que vencen en vivo. */
  async refreshEquipped(): Promise<void> {
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    try {
      const ids = [...new Set([...this.connections.values()].map((connection) => connection.actorId))];
      const current = await equippedForMany(ids);
      for (const actorId of ids) {
        const equipped = current.get(actorId) ?? { name: null, name_font: null, frame: null, background: null, ambient: null };
        const member = [...this.rooms.values()].map((members) => members.get(actorId)).find(Boolean);
        if (member && EQUIPPED_SLOTS.some((slot) => member.actor.equipped[slot] !== equipped[slot])) this.equipped(actorId, equipped);
      }
    } catch (error) { log.warn({ err: error }, "no se pudo refrescar el equipado"); }
    finally { this.refreshing = false; }
  }

  private presence(roomSlug: string): ChatUser[] {
    const members = this.rooms.get(roomSlug);
    if (!members) return [];
    return [...members.values()]
      .map((member) => member.actor)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
  }

  private broadcast(roomSlug: string, event: ServerEvent, except?: ChatSocket): void {
    const members = this.rooms.get(roomSlug);
    if (!members) return;
    for (const member of members.values()) {
      for (const socket of member.sockets) {
        if (socket === except) continue;
        const connection = this.connections.get(socket);
        if (connection && !connection.ready) {
          if (connection.outgoing.length >= 128) { socket.close(1013, "cliente lento"); this.onClose(socket); }
          else connection.outgoing.push(event);
        } else send(socket, event);
      }
    }
  }
}

export function toChatUser(actor: Actor, equipped: Equipped): ChatUser {
  return {
    id: actor.id, handle: actor.handle, displayName: actor.displayName,
    avatarSeed: actor.avatarSeed, isBot: actor.isBot, equipped,
  };
}

function send(socket: ChatSocket, event: ServerEvent): void {
  if (socket.readyState !== undefined && socket.readyState !== 1) return;
  if ((socket.bufferedAmount ?? 0) > 256 * 1024) { socket.close(1013, "cliente lento"); return; }
  try { socket.send(JSON.stringify(event)); } catch { /* conexión ya cerrada */ }
}
