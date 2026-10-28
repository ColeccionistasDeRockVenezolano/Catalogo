// CRV · Tiempo real del chat (WebSocket).
//
// Un proceso, una sala por conexión, presencia en memoria. El estado durable
// (mensajes, inventario, monedas) vive en PostgreSQL; aquí solo se guarda
// quién está conectado y qué efecto lleva puesto, que es lo que cambia cien
// veces por minuto y no merece una escritura por evento.
import { getEnv } from "../config/env.js";
import {
  ChatError, actorById, effectsFor, equipEffect, equippedFor, insertMessage, listMessages,
  ownsEffect, roomBySlug, updateDisplayName, walletFor,
} from "./repository.js";
import {
  CHAT_RATE, clientEventSchema, type ChatUser, type Equipped, type ServerEvent,
} from "./protocol.js";

/** Lo mínimo que usamos de un socket de `ws` (evita atar el módulo a su tipo). */
export interface ChatSocket {
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
  actorId: string;
  roomSlug: string;
  lastActivity: number;
  sent: number[];
  typingSent: number[];
}

const MAX_TYPING = 20;

export class ChatHub {
  private readonly rooms = new Map<string, Map<string, Member>>();
  private readonly connections = new Map<ChatSocket, Connection>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.sweep(), 30_000);
    this.heartbeat.unref();
  }

  stop(): void {
    clearInterval(this.heartbeat);
    for (const socket of this.connections.keys()) socket.close(1001, "servidor detenido");
    this.connections.clear();
    this.rooms.clear();
  }

  async connect(socket: ChatSocket, actorId: string, roomSlug: string): Promise<void> {
    const [actor, room] = await Promise.all([actorById(actorId), roomBySlug(roomSlug)]);
    if (!actor) {
      send(socket, { type: "error", code: "session_expired", message: "Tu sesión de chat caducó. Recarga la página." });
      socket.close(4401, "sin sesión");
      return;
    }
    if (!room) {
      send(socket, { type: "error", code: "room_not_found", message: "Esa sala no existe." });
      socket.close(4404, "sala inexistente");
      return;
    }

    const equipped = await equippedFor(actor.id);
    const user: ChatUser = {
      id: actor.id, handle: actor.handle, displayName: actor.displayName,
      avatarSeed: actor.avatarSeed, isBot: actor.isBot, equipped,
    };

    const members = this.rooms.get(room.slug) ?? new Map<string, Member>();
    this.rooms.set(room.slug, members);
    const member = members.get(actor.id) ?? { actor: user, sockets: new Set<ChatSocket>() };
    member.actor = user;
    member.sockets.add(socket);
    members.set(actor.id, member);

    const connection: Connection = {
      actorId: actor.id, roomSlug: room.slug, lastActivity: Date.now(), sent: [], typingSent: [],
    };
    this.connections.set(socket, connection);

    socket.on("message", (data) => { void this.onMessage(socket, data); });
    socket.on("close", () => this.onClose(socket));
    socket.on("pong", () => { connection.lastActivity = Date.now(); });

    const [messages, effects, wallet] = await Promise.all([
      listMessages(room.id, 50), effectsFor(actor.id), walletFor(actor.id),
    ]);
    send(socket, {
      type: "snapshot", room, actor: user, me: wallet, messages, users: this.presence(room.slug), effects,
    });
    this.broadcast(room.slug, { type: "presence", users: this.presence(room.slug) });
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
    const room = await roomBySlug(connection.roomSlug);
    if (!room) return;

    try {
      switch (event.data.type) {
        case "ping":
          return;
        case "typing": {
          if (!allow(connection.typingSent, MAX_TYPING)) return;
          const member = this.rooms.get(room.slug)?.get(connection.actorId);
          if (!member) return;
          this.broadcast(room.slug, {
            type: "typing", actorId: connection.actorId,
            displayName: member.actor.displayName, active: event.data.active,
          }, socket);
          return;
        }
        case "message": {
          if (!allow(connection.sent, getEnv().CRV_CHAT_RATE_LIMIT)) {
            send(socket, { type: "error", code: "rate_limited", message: "Vas muy rápido; espera unos segundos." });
            return;
          }
          let effectCode: string | null = event.data.effectCode ?? null;
          if (effectCode && !(await ownsEffect(connection.actorId, effectCode))) effectCode = null;
          const message = await insertMessage({
            roomId: room.id, actorId: connection.actorId, body: event.data.body,
            kind: "chat", effectCode,
          });
          this.broadcast(room.slug, { type: "message", message });
          return;
        }
        case "action": {
          if (!allow(connection.sent, getEnv().CRV_CHAT_RATE_LIMIT)) return;
          const message = await insertMessage({
            roomId: room.id, actorId: connection.actorId, body: event.data.code,
            kind: "action", effectCode: event.data.code,
          });
          this.broadcast(room.slug, { type: "message", message });
          return;
        }
        case "equip": {
          const equipped = await equipEffect({
            actorId: connection.actorId,
            slot: event.data.slot,
            code: event.data.effectCode,
          });
          this.updateEquipped(room.slug, connection.actorId, equipped);
          this.broadcast(room.slug, { type: "equipped", actorId: connection.actorId, equipped });
          this.broadcast(room.slug, { type: "presence", users: this.presence(room.slug) });
          return;
        }
        case "profile": {
          const updated = await updateDisplayName(connection.actorId, event.data.displayName);
          const member = this.rooms.get(room.slug)?.get(connection.actorId);
          if (member) member.actor = { ...member.actor, displayName: updated.displayName };
          this.broadcast(room.slug, { type: "presence", users: this.presence(room.slug) });
          return;
        }
      }
    } catch (error) {
      const known = error instanceof ChatError;
      send(socket, {
        type: "error",
        code: known ? error.code : "internal",
        message: known ? error.message : "No se pudo procesar el evento.",
      });
    }
  }

  private onClose(socket: ChatSocket): void {
    const connection = this.connections.get(socket);
    if (!connection) return;
    this.connections.delete(socket);
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
  }

  private updateEquipped(roomSlug: string, actorId: string, equipped: Equipped): void {
    const member = this.rooms.get(roomSlug)?.get(actorId);
    if (member) member.actor = { ...member.actor, equipped };
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
    const payload = JSON.stringify(event);
    for (const member of members.values()) {
      for (const socket of member.sockets) {
        if (socket === except) continue;
        try { socket.send(payload); } catch { /* el cierre lo limpia el evento close */ }
      }
    }
  }
}

/** Ventana deslizante de 10 s; 0 desactiva el límite. */
function allow(stamps: number[], max: number): boolean {
  if (max <= 0) return true;
  const now = Date.now();
  while (stamps.length > 0 && now - (stamps[0] ?? 0) > CHAT_RATE.windowMs) stamps.shift();
  if (stamps.length >= max) return false;
  stamps.push(now);
  return true;
}

function send(socket: ChatSocket, event: ServerEvent): void {
  try { socket.send(JSON.stringify(event)); } catch { /* conexión ya cerrada */ }
}
