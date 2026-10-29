// CRV · Conexión del chat (sesión + WebSocket + reconexión).
//
// El token de invitado vive en memoria y en una cookie HttpOnly: el navegador
// no lo guarda en localStorage. Si el socket se cae, se reconecta solo con
// espera creciente y vuelve a pedir el snapshot; el usuario no pierde el hilo.
//
// Cada montaje lleva una «generación»: React StrictMode monta el efecto dos
// veces en desarrollo y sin este guard quedaban dos sockets del mismo actor,
// mensajes duplicados y una presencia que se apagaba sola.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatEffect, ChatEntry, ChatMessage, ChatRoom, ChatUser, Equipped, ModerationAlert, Wallet } from "../../../src/chat/protocol";
import { sha256Hex, solvePow } from "../../../src/chat/pow";
import { ApiError, chatApi, chatSocketUrl, type ChatSession } from "./api";
import type { EffectSlot } from "./chatEffects";
import { useDailyAsync } from "./useDailyAsync";

export type ChatStatus = "connecting" | "online" | "offline";
export const CHAT_MESSAGE_LIMIT = 50;

export interface ChatState {
  /** Solo la página visible y una ventana reciente; nunca todo el historial. */
  recentMessages: ChatMessage[];
  recentHasMore: boolean;
  followingLatest: boolean;
  unreadMessages: number;
  newerCursors: number[];
  hasMore: boolean;
  loadingHistory: boolean;
  historyError: string | null;
  status: ChatStatus;
  actor: ChatUser | null;
  room: ChatRoom | null;
  messages: ChatMessage[];
  freshMessageIds: number[];
  entries: ChatEntry[];
  users: ChatUser[];
  effects: ChatEffect[];
  wallet: Wallet;
  typing: string[];
  error: string | null;
  /** Silencio vigente (ISO) impuesto por moderación o por el detector. */
  mutedUntil: string | null;
  /** Avisos para moderadores (solo los reciben sus conexiones). */
  alerts: ModerationAlert[];
  /** Cuenta o IP baneada: no se reintenta la conexión. */
  banned: boolean;
}

const EMPTY: ChatState = {
  recentMessages: [], recentHasMore: false, followingLatest: true, unreadMessages: 0, newerCursors: [],
  hasMore: true, loadingHistory: false, historyError: null,
  status: "connecting", actor: null, room: null, messages: [], users: [], effects: [],
  wallet: { coins: 0, credits: 0 }, typing: [], error: null,
  mutedUntil: null, alerts: [], banned: false, freshMessageIds: [], entries: [],
};

// Códigos de cierre del servidor (src/chat/realtime.ts → CLOSE).
const CLOSE_NO_SESSION = 4401;
const CLOSE_BANNED = 4403;
const CLOSE_ROOM_MISSING = 4404;
const CLOSE_TOO_MANY = 4429;

/**
 * Huella del navegador: 32 hex de rasgos estables (idioma, pantalla, zona,
 * núcleos, lienzo). No identifica a nadie fuera del chat; solo sirve para
 * ver que veinte «invitados» salen del mismo navegador.
 */
let fingerprintCache: string | null = null;
export function browserFingerprint(): string {
  if (fingerprintCache) return fingerprintCache;
  const parts: Array<string | number> = [
    navigator.userAgent, navigator.language, (navigator.languages ?? []).join(","),
    `${screen.width}x${screen.height}x${screen.colorDepth}`, window.devicePixelRatio,
    Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.hardwareConcurrency ?? 0,
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0, navigator.maxTouchPoints ?? 0,
  ];
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 40;
    const context = canvas.getContext("2d");
    if (context) {
      context.textBaseline = "top";
      context.font = "16px 'Arial'";
      context.fillStyle = "#f60";
      context.fillRect(10, 5, 90, 20);
      context.fillStyle = "#069";
      context.fillText("La Rockola ¿🤘?", 4, 12);
      parts.push(sha256Hex(canvas.toDataURL()));
    }
  } catch {
    // Lienzo bloqueado (modo privado estricto): la huella sigue sin él.
  }
  fingerprintCache = sha256Hex(parts.join("|")).slice(0, 32);
  return fingerprintCache;
}

/**
 * Sesión del chat. Primero intenta sin desafío (renovación con la cookie);
 * si el servidor pide prueba de trabajo (428), la resuelve y repite.
 */
async function openSession(): Promise<ChatSession> {
  const fp = browserFingerprint();
  try {
    return await chatApi.session({ fp });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "pow_required") throw error;
  }
  const { challenge, bits } = await chatApi.challenge();
  const nonce = await solvePow(challenge, bits);
  return chatApi.session({ fp, challenge, nonce });
}

// Una sola sesión por carga de página: dos POST simultáneos crearían dos actores.
let sessionPromise: Promise<ChatSession> | null = null;
function ensureSession(): Promise<ChatSession> {
  sessionPromise ??= openSession().catch((error: unknown) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

export function useChat(roomSlug: string) {
  const [state, setState] = useState<ChatState>(EMPTY);
  const socketRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string>("");
  const effectsRef = useRef<ChatEffect[]>([]);
  const generationRef = useRef(0);
  const typingSentRef = useRef(0);
  const typingTimerRef = useRef<number | null>(null);
  const retryRef = useRef(0);
  const authRetryRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const historyRequestRef = useRef(0);
  const historyBusyRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const connect = useCallback((generation: number) => {
    if (generation !== generationRef.current || !tokenRef.current) return;
    setState((current) => ({ ...current, status: "connecting" }));
    const socket = new WebSocket(chatSocketUrl(tokenRef.current, roomSlug, browserFingerprint()));
    socketRef.current = socket;

    socket.onopen = () => {
      if (generation !== generationRef.current) return;
      retryRef.current = 0;
      setState((current) => ({ ...current, status: "online", error: null }));
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      if (generation !== generationRef.current) return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (payload["type"] === "snapshot") {
        authRetryRef.current = 0;
        historyRequestRef.current += 1;
        historyBusyRef.current = false;
      }
      setState((current) => reduceEvent(current, payload));
    };

    socket.onclose = (event) => {
      if (socketRef.current === socket) socketRef.current = null;
      if (generation !== generationRef.current) return;
      if (event.code === CLOSE_BANNED) {
        const kicked = event.reason === "kick" || event.reason === "kicked";
        setState((current) => ({
          ...current, status: "offline",
          banned: !kicked,
          error: kicked ? "Te sacaron de la sala." : "No puedes entrar a La Rockola.",
        }));
        // Una expulsión deja volver tras la espera; un baneo no. El servidor decide.
        if (kicked) reconnectTimerRef.current = window.setTimeout(() => connect(generation), 5 * 60_000);
        return;
      }
      if (event.code === CLOSE_ROOM_MISSING) {
        setState((current) => ({ ...current, status: "offline", error: "Esa sala no existe." }));
        return;
      }
      setState((current) => ({ ...current, status: "offline" }));
      if (event.code === CLOSE_NO_SESSION) {
        // Una sola renovación: otro 4401 requiere intervención, no un bucle.
        if (authRetryRef.current >= 1) {
          sessionPromise = null;
          tokenRef.current = "";
          setState((current) => ({ ...current, error: "Tu sesión no es válida. Recarga la página para volver a entrar." }));
          return;
        }
        authRetryRef.current += 1;
        // Token caducado o revocado: se pide uno nuevo antes de reconectar.
        sessionPromise = null;
        tokenRef.current = "";
        void ensureSession()
          .then((session) => {
            if (generation !== generationRef.current) return;
            tokenRef.current = session.token;
            setState((current) => ({ ...current, actor: session.actor, wallet: session.wallet }));
            connect(generation);
          })
          .catch((error: unknown) => {
            if (generation !== generationRef.current) return;
            const banned = error instanceof ApiError && error.code === "banned";
            setState((current) => ({
              ...current, banned,
              error: error instanceof Error ? error.message : "No se pudo entrar al chat.",
            }));
          });
        return;
      }
      const base = event.code === CLOSE_TOO_MANY ? 10_000 : 800;
      const wait = Math.min(30_000, base * 2 ** retryRef.current);
      retryRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => connect(generation), wait);
    };

    socket.onerror = () => {
      if (generation !== generationRef.current) return;
      setState((current) => ({ ...current, error: "No se pudo conectar con el chat." }));
    };
  }, [roomSlug]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setState(EMPTY);
    authRetryRef.current = 0;
    void ensureSession()
      .then((session) => {
        if (generation !== generationRef.current) return;
        tokenRef.current = session.token;
        setState((current) => ({ ...current, actor: session.actor, wallet: session.wallet }));
        connect(generation);
      })
      .catch((error: unknown) => {
        if (generation !== generationRef.current) return;
        setState((current) => ({
          ...current,
          status: "offline",
          error: error instanceof Error ? error.message : "No se pudo entrar al chat.",
        }));
      });
    return () => {
      // Invalida la generación: callbacks y reintentos del montaje viejo mueren.
      generationRef.current += 1;
      historyRequestRef.current += 1;
      historyBusyRef.current = false;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect]);

  // Comparte el ciclo del servidor e invalida la portada anterior al cambiar el día.
  const dailyCover = useDailyAsync((date, signal) => chatApi.dailyCover(date, signal));

  // El catálogo cambia al comprar/equipar; el envío automático del efecto de
  // mensaje lee el valor más reciente sin re-suscribir el compositor.
  useEffect(() => { effectsRef.current = state.effects; }, [state.effects]);

  const send = useCallback((event: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }, []);

  const sendMessage = useCallback((body: string, effectCode?: string) => {
    const clean = body.trim().slice(0, 2000);
    if (!clean) return;
    // El efecto de mensaje comprado se aplica solo: el usuario no tiene que
    // activarlo en cada envío. Si manda uno explícito, ese gana.
    const auto = effectCode ?? effectsRef.current.find((effect) => effect.kind === "message" && effect.owned)?.code;
    send({ type: "message", body: clean, ...(auto ? { effectCode: auto } : {}) });
  }, [send]);

  const sendAction = useCallback((code: string) => send({ type: "action", code }), [send]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingSentRef.current > 2000) {
      typingSentRef.current = now;
      send({ type: "typing", active: true });
    }
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      typingSentRef.current = 0;
      send({ type: "typing", active: false });
    }, 2500);
  }, [send]);

  const pauseLatest = useCallback(() => {
    setState((current) => current.followingLatest ? { ...current, followingLatest: false } : current);
  }, []);

  const resumeLatest = useCallback(() => {
    historyRequestRef.current += 1;
    historyBusyRef.current = false;
    setState((current) => ({ ...current, messages: current.recentMessages, hasMore: current.recentHasMore,
      followingLatest: true, unreadMessages: 0, newerCursors: [], loadingHistory: false, historyError: null }));
  }, []);

  const loadHistory = useCallback(async (direction: "earlier" | "newer"): Promise<boolean> => {
    const current = stateRef.current;
    const before = direction === "earlier" ? current.messages[0]?.id : current.newerCursors.at(-1);
    if (!before || (direction === "earlier" && !current.hasMore) || historyBusyRef.current) return false;
    historyBusyRef.current = true;
    const request = ++historyRequestRef.current;
    const generation = generationRef.current;
    setState((value) => ({ ...value, followingLatest: false, loadingHistory: true, historyError: null }));
    try {
      const { messages } = await chatApi.messages(roomSlug, before);
      if (request !== historyRequestRef.current || generation !== generationRef.current) return false;
      setState((value) => {
        const page = mergeMessages([], messages).slice(-CHAT_MESSAGE_LIMIT);
        // Un historial agotado no borra la página que se estaba leyendo.
        if (!page.length) return { ...value, hasMore: direction === "earlier" ? false : value.hasMore, loadingHistory: false };
        const nextCursor = (current.messages.at(-1)?.id ?? 0) + 1;
        return { ...value, messages: page, hasMore: messages.length === CHAT_MESSAGE_LIMIT, loadingHistory: false,
          newerCursors: direction === "earlier" ? [...value.newerCursors, nextCursor] : value.newerCursors.slice(0, -1) };
      });
      return true;
    } catch (error) {
      if (request === historyRequestRef.current && generation === generationRef.current) setState((value) => ({
        ...value, loadingHistory: false, historyError: error instanceof Error ? error.message : "No se pudieron cargar los mensajes. Vuelve a intentarlo.",
      }));
      return false;
    } finally {
      if (request === historyRequestRef.current) historyBusyRef.current = false;
    }
  }, [roomSlug]);
  const loadEarlier = useCallback(() => loadHistory("earlier"), [loadHistory]);
  const loadNewer = useCallback(() => loadHistory("newer"), [loadHistory]);

  const equip = useCallback(async (slot: EffectSlot, code: string | null) => {
    const result = await chatApi.equip(slot, code);
    setState((current) => ({
      ...current,
      effects: result.effects,
      actor: current.actor ? { ...current.actor, equipped: result.equipped } : current.actor,
    }));
    return result.equipped;
  }, []);

  const buy = useCallback(async (code: string) => {
    const result = await chatApi.buy(code, crypto.randomUUID());
    setState((current) => ({ ...current, wallet: result.wallet, effects: result.effects }));
    return result;
  }, []);

  /** Solo muestra el apodo que el servidor aceptó; sus errores llegan al formulario. */
  const setName = useCallback(async (displayName: string) => {
    const clean = displayName.trim();
    if (clean.length < 2) return;
    const result = await chatApi.setName(clean);
    setState((current) => ({ ...current, actor: result.actor }));
  }, []);

  return useMemo(() => ({
    ...state, cover: dailyCover.data ?? null,
    sendMessage, sendAction, notifyTyping, equip, buy, setName, loadEarlier, loadNewer, pauseLatest, resumeLatest,
  }), [state, dailyCover.data, sendMessage, sendAction, notifyTyping, equip, buy, setName, loadEarlier, loadNewer, pauseLatest, resumeLatest]);
}

export function reduceEvent(current: ChatState, event: Record<string, unknown>): ChatState {
  switch (event["type"]) {
    case "snapshot": {
      const actor = event["actor"] as ChatUser;
      const snapshot = event["messages"] as ChatMessage[];
      const messages = mergeMessages([], snapshot).slice(-CHAT_MESSAGE_LIMIT);
      return {
        ...current,
        status: "online",
        actor,
        room: event["room"] as ChatRoom,
        messages, recentMessages: messages, recentHasMore: snapshot.length >= CHAT_MESSAGE_LIMIT,
        followingLatest: true, unreadMessages: 0, newerCursors: [],
        hasMore: snapshot.length >= CHAT_MESSAGE_LIMIT,
        loadingHistory: false, historyError: null,
        freshMessageIds: [], entries: [],
        users: event["users"] as ChatUser[],
        effects: event["effects"] as ChatEffect[],
        wallet: event["me"] as Wallet,
        error: null,
      };
    }
    case "message": {
      const message = event["message"] as ChatMessage;
      // Un mensaje repetido (reconexión, eco) no se duplica en la lista.
      if (current.recentMessages.some((item) => item.id === message.id) || current.messages.some((item) => item.id === message.id)) return current;
      // Un eco atrasado fuera de ambas ventanas no vuelve a entrar como novedad.
      if (message.id <= (current.recentMessages.at(-1)?.id ?? 0)) return current;
      const combined = [...current.recentMessages, message];
      const recentMessages = combined.slice(-CHAT_MESSAGE_LIMIT);
      const recentHasMore = current.recentHasMore || combined.length > CHAT_MESSAGE_LIMIT;
      return { ...current, recentMessages, recentHasMore,
        messages: current.followingLatest ? recentMessages : current.messages,
        hasMore: current.followingLatest ? recentHasMore : current.hasMore,
        unreadMessages: current.followingLatest ? 0 : current.unreadMessages + 1,
        freshMessageIds: [...current.freshMessageIds, message.id].slice(-CHAT_MESSAGE_LIMIT) };
    }
    case "entry":
      return { ...current, entries: [...current.entries, event as unknown as ChatEntry].slice(-20) };
    case "presence":
      return { ...current, users: event["users"] as ChatUser[] };
    case "typing": {
      const name = String(event["displayName"] ?? "");
      const active = Boolean(event["active"]);
      const typing = active
        ? [...new Set([...current.typing, name])].slice(-4)
        : current.typing.filter((item) => item !== name);
      return { ...current, typing };
    }
    case "wallet":
      return { ...current, wallet: { coins: Number(event["coins"]), credits: Number(event["credits"]) } };
    case "equipped": {
      const actorId = String(event["actorId"]);
      const equipped = event["equipped"] as Equipped;
      return {
        ...current,
        users: current.users.map((user) => (user.id === actorId ? { ...user, equipped } : user)),
        messages: current.messages.map((message) => message.actorId === actorId ? { ...message, equipped } : message),
        recentMessages: current.recentMessages.map((message) => message.actorId === actorId ? { ...message, equipped } : message),
        actor: current.actor?.id === actorId ? { ...current.actor, equipped } : current.actor,
        effects: current.actor?.id === actorId
          ? current.effects.map((effect) => ({ ...effect, equipped: Object.values(equipped).includes(effect.code) }))
          : current.effects,
      };
    }
    case "deleted": {
      const messageId = Number(event["messageId"]);
      return { ...current, messages: current.messages.filter((item) => item.id !== messageId),
        recentMessages: current.recentMessages.filter((item) => item.id !== messageId),
        freshMessageIds: current.freshMessageIds.filter((id) => id !== messageId) };
    }
    case "muted": {
      const until = typeof event["until"] === "string" ? event["until"] : null;
      const reason = String(event["reason"] ?? "");
      return {
        ...current,
        mutedUntil: until,
        error: until ? `Estás en silencio hasta las ${formatClock(until)}${reason ? `: ${reason}` : "."}` : "Ya puedes escribir de nuevo.",
      };
    }
    case "room":
      return { ...current, room: event["room"] as ChatRoom };
    case "mod_alert":
      return { ...current, alerts: [event["alert"] as ModerationAlert, ...current.alerts].slice(0, 50) };
    case "error": {
      const message = String(event["message"] ?? "Error del chat.");
      // Mismo texto dos veces seguidas: se renueva para que el aviso vuelva a salir.
      return { ...current, error: current.error === message ? `${message}\u2009` : message };
    }
    default:
      return current;
  }
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
}

/** Historial y WS pueden solaparse durante el snapshot o una reconexión. */
export function mergeMessages(older: ChatMessage[], newer: ChatMessage[]): ChatMessage[] {
  return [...new Map([...older, ...newer].map((message) => [message.id, message])).values()]
    .sort((a, b) => a.id - b.id);
}
