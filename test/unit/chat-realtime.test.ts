import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHub, type ChatSocket, type ConnectContext } from "../../src/chat/realtime.js";
import * as repo from "../../src/chat/repository.js";
import type { Equipped, ServerEvent } from "../../src/chat/protocol.js";

vi.mock("../../src/chat/repository.js", async (original) => ({
  ...await original<typeof import("../../src/chat/repository.js")>(),
  actorById: vi.fn(), roomBySlug: vi.fn(), isIpBanned: vi.fn(), equippedFor: vi.fn(),
  listMessages: vi.fn(), effectsFor: vi.fn(), walletFor: vi.fn(), touchActor: vi.fn(), equippedForMany: vi.fn(),
}));

const empty: Equipped = { name: null, frame: null, background: null, ambient: null, name_font: null, badge: null };
const actor: repo.Actor = { id: "00000000-0000-4000-8000-000000000001", kind: "guest", handle: "ensayo", displayName: "Ensayo", avatarSeed: "ensayo",
  claimedUserId: null, isBot: false, tokenVersion: 1, mutedUntil: null, bannedAt: null, createdAt: new Date(0) };

class Socket extends EventEmitter implements ChatSocket {
  readyState = 1;
  bufferedAmount = 0;
  events: ServerEvent[] = [];
  closeCode: number | undefined;
  send(data: string): void { this.events.push(JSON.parse(data) as ServerEvent); }
  close(code?: number): void { this.closeCode = code; this.readyState = 3; this.emit("close"); }
  ping(): void {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("arranque y presión del WebSocket", () => {
  let hub: ChatHub;
  const context = (): ConnectContext => ({
    claims: { actorId: actor.id, version: 1, expiresAt: Date.now() + 60_000, legacy: false },
    roomSlug: "general", origin: { ip: "198.51.100.1", fingerprint: null, userAgent: null }, moderator: null,
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(repo.actorById).mockResolvedValue(actor);
    vi.mocked(repo.roomBySlug).mockResolvedValue({ id: 1, slug: "general", name: "Sala", description: "", theme: {}, slowModeSeconds: 0 });
    vi.mocked(repo.isIpBanned).mockResolvedValue(false);
    vi.mocked(repo.equippedFor).mockResolvedValue({ ...empty });
    vi.mocked(repo.equippedForMany).mockResolvedValue(new Map());
    vi.mocked(repo.listMessages).mockResolvedValue([]);
    vi.mocked(repo.effectsFor).mockResolvedValue([]);
    vi.mocked(repo.walletFor).mockResolvedValue({ coins: 10, credits: 0 });
    vi.mocked(repo.touchActor).mockResolvedValue();
    hub = new ChatHub();
  });
  afterEach(() => hub.stop());

  it("entrega primero el snapshot y conserva eventos recibidos mientras carga", async () => {
    const pending = deferred<Awaited<ReturnType<typeof repo.listMessages>>>();
    vi.mocked(repo.listMessages).mockReturnValueOnce(pending.promise);
    const socket = new Socket(); const connecting = hub.connect(socket, context());
    await vi.waitFor(() => expect(repo.listMessages).toHaveBeenCalled());
    hub.removeMessage("general", 99);
    expect(socket.events).toEqual([]);
    pending.resolve([]); await connecting;
    expect(socket.events.map((event) => event.type).slice(0, 2)).toEqual(["snapshot", "deleted"]);
    expect(socket.events[1]).toEqual({ type: "deleted", messageId: 99 });
  });

  it("no deja presencia fantasma si se cierra durante la carga", async () => {
    const pending = deferred<Awaited<ReturnType<typeof repo.listMessages>>>();
    vi.mocked(repo.listMessages).mockReturnValueOnce(pending.promise);
    const socket = new Socket(); const connecting = hub.connect(socket, context());
    await vi.waitFor(() => expect(repo.listMessages).toHaveBeenCalled());
    socket.close(); pending.resolve([]); await connecting;
    const observer = new Socket();
    vi.mocked(repo.actorById).mockResolvedValue({ ...actor, id: "00000000-0000-4000-8000-000000000002" });
    await hub.connect(observer, { ...context(), claims: { ...context().claims, actorId: "00000000-0000-4000-8000-000000000002" } });
    const snapshot = observer.events.find((event) => event.type === "snapshot");
    expect(snapshot?.type === "snapshot" && snapshot.users.map((user) => user.id)).toEqual(["00000000-0000-4000-8000-000000000002"]);
  });

  it("devuelve el cupo si falla una consulta tras reservar conexión", async () => {
    for (let index = 0; index < 5; index++) {
      vi.mocked(repo.equippedFor).mockRejectedValueOnce(new Error("base temporalmente caída"));
      await expect(hub.connect(new Socket(), context())).rejects.toThrow("base temporalmente caída");
    }
    const socket = new Socket(); await hub.connect(socket, context());
    expect(socket.events[0]?.type).toBe("snapshot");
  });

  it("cierra un cliente lento sin impedir entregar a los demás", async () => {
    const slow = new Socket(); await hub.connect(slow, context());
    const fast = new Socket(); await hub.connect(fast, context());
    slow.bufferedAmount = 300 * 1024;
    hub.removeMessage("general", 17);
    expect(slow.closeCode).toBe(1013);
    expect(fast.events).toContainEqual({ type: "deleted", messageId: 17 });
  });

  it("acota los eventos acumulados durante un snapshot lento", async () => {
    const pending = deferred<Awaited<ReturnType<typeof repo.listMessages>>>();
    vi.mocked(repo.listMessages).mockReturnValueOnce(pending.promise);
    const socket = new Socket(); const connecting = hub.connect(socket, context());
    await vi.waitFor(() => expect(repo.listMessages).toHaveBeenCalled());
    for (let index = 0; index < 130; index++) hub.removeMessage("general", index);
    expect(socket.closeCode).toBe(1013);
    pending.resolve([]); await connecting;
    expect(socket.events).toEqual([]);
  });
});
