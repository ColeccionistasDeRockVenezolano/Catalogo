import { describe, expect, it, vi } from "vitest";
import { CHAT_MESSAGE_LIMIT, mergeMessages, reduceEvent, type ChatState } from "../../src/lib/chatSocket";
import type { ChatMessage } from "../../../src/chat/protocol";

vi.mock("../../src/lib/api", () => ({ ApiError: class extends Error {}, chatApi: {}, chatSocketUrl: vi.fn() }));
vi.mock("../../src/lib/useDailyAsync", () => ({ useDailyAsync: vi.fn() }));

const empty = { name: null, frame: null, background: null, ambient: null, name_font: null, badge: null };
const message = (id: number, actorId = "one"): ChatMessage => ({
  id, roomId: 1, actorId, handle: actorId, displayName: actorId, body: `Mensaje ${id}`, kind: "chat",
  createdAt: "2026-10-28T12:00:00Z", effectCode: null, equipped: { ...empty, name: "neon" },
});
const initialState = (): ChatState => ({
  actor: null, users: [], messages: [], recentMessages: [], recentHasMore: false, followingLatest: true,
  unreadMessages: 0, newerCursors: [], room: null, status: "online", effects: [],
  freshMessageIds: [], entries: [], typing: [], wallet: { coins: 0, credits: 0 }, error: null,
  mutedUntil: null, alerts: [], banned: false, hasMore: false, loadingHistory: false, historyError: null,
});

describe("estado del chat", () => {
  it("combina historia y WS ordenados por ID sin duplicar los solapamientos", () => {
    expect(mergeMessages([message(2), message(1)], [message(3), message(2)]).map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("el equipado y su caducidad actualizan también mensajes que ya están en pantalla", () => {
    const actor = { id: "one", handle: "one", displayName: "Uno", avatarSeed: "one", isBot: false, equipped: { ...empty, name: "neon" } };
    const initial: ChatState = {
      ...initialState(), recentMessages: [message(1), message(2, "other")],
      actor, users: [actor], messages: [message(1), message(2, "other")], room: null, status: "online",
      freshMessageIds: [], entries: [], typing: [], wallet: { coins: 1, credits: 0 }, error: null,
      mutedUntil: null, alerts: [], banned: false, hasMore: false, loadingHistory: false, historyError: null,
      effects: [{ code: "neon", name: "Neón", kind: "name", description: "", manifest: {}, priceCoins: 10, priceCredits: 0, durationDays: 30, sort: 1, owned: true, equipped: true }],
    };
    const next = reduceEvent(initial, { type: "equipped", actorId: "one", equipped: empty });
    expect(next.actor?.equipped.name).toBeNull();
    expect(next.users[0]?.equipped.name).toBeNull();
    expect(next.messages[0]?.equipped?.name).toBeNull();
    expect(next.messages[1]?.equipped?.name).toBe("neon");
    expect(next.recentMessages[0]?.equipped?.name).toBeNull();
    expect(next.effects[0]?.equipped).toBe(false);
    expect(next.freshMessageIds).toEqual([]);
  });

  it("una sesión de 10.000 mensajes conserva solamente los 50 recientes", () => {
    let state = initialState();
    for (let id = 1; id <= 10_000; id++) state = reduceEvent(state, { type: "message", message: message(id) });
    expect(state.messages).toHaveLength(CHAT_MESSAGE_LIMIT);
    expect(state.recentMessages).toBe(state.messages);
    expect(state.freshMessageIds).toHaveLength(CHAT_MESSAGE_LIMIT);
    expect(state.messages[0]?.id).toBe(9951);
    expect(state.messages.at(-1)?.id).toBe(10_000);
    expect(state.hasMore).toBe(true);
    expect(state.unreadMessages).toBe(0);
  });

  it("leer atrás congela la página y cuenta novedades sin acumular ni repetir ecos", () => {
    let state = initialState();
    for (let id = 1; id <= 50; id++) state = reduceEvent(state, { type: "message", message: message(id) });
    state = { ...state, followingLatest: false };
    const reading = state.messages;
    for (let id = 51; id <= 500; id++) state = reduceEvent(state, { type: "message", message: message(id) });
    const beforeEcho = state;
    state = reduceEvent(state, { type: "message", message: message(51) });
    expect(state).toBe(beforeEcho);
    expect(state.messages).toBe(reading);
    expect(state.unreadMessages).toBe(450);
    expect(state.recentMessages).toHaveLength(50);
    expect(state.recentMessages[0]?.id).toBe(451);
    expect(state.messages.at(-1)?.id).toBe(50);
  });

  it("reconectar reinicia las ventanas y no reproduce mensajes históricos", () => {
    const state = reduceEvent({ ...initialState(), followingLatest: false, unreadMessages: 10, newerCursors: [301] }, {
      type: "snapshot", actor: null, room: null, users: [], effects: [], me: { coins: 0, credits: 0 },
      messages: Array.from({ length: 100 }, (_, index) => message(index + 1)),
    });
    expect(state.messages).toHaveLength(50);
    expect(state.recentMessages).toBe(state.messages);
    expect(state.followingLatest).toBe(true);
    expect(state.newerCursors).toEqual([]);
    expect(state.unreadMessages).toBe(0);
    expect(state.freshMessageIds).toEqual([]);
  });

  it("moderar un mensaje lo retira de ambas ventanas y de sus efectos pendientes", () => {
    const state = reduceEvent({ ...initialState(), messages: [message(5)], recentMessages: [message(5)], freshMessageIds: [5] },
      { type: "deleted", messageId: 5 });
    expect(state.messages).toEqual([]);
    expect(state.recentMessages).toEqual([]);
    expect(state.freshMessageIds).toEqual([]);
  });
});
