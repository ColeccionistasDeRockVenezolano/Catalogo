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
import type { ChatEffect, ChatMessage, ChatRoom, ChatUser, Equipped, Wallet } from "../../../src/chat/protocol";
import { chatApi, chatSocketUrl, type ChatCover, type ChatSession } from "./api";
import type { EffectSlot } from "./chatEffects";

export type ChatStatus = "connecting" | "online" | "offline";

export interface ChatState {
  status: ChatStatus;
  actor: ChatUser | null;
  room: ChatRoom | null;
  messages: ChatMessage[];
  users: ChatUser[];
  effects: ChatEffect[];
  wallet: Wallet;
  typing: string[];
  error: string | null;
  cover: ChatCover | null;
}

const EMPTY: ChatState = {
  status: "connecting", actor: null, room: null, messages: [], users: [], effects: [],
  wallet: { coins: 0, credits: 0 }, typing: [], error: null, cover: null,
};

// Una sola sesión por carga de página: dos POST simultáneos crearían dos actores.
let sessionPromise: Promise<ChatSession> | null = null;
function ensureSession(): Promise<ChatSession> {
  sessionPromise ??= chatApi.session();
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

  const connect = useCallback((generation: number) => {
    if (generation !== generationRef.current || !tokenRef.current) return;
    setState((current) => ({ ...current, status: "connecting" }));
    const socket = new WebSocket(chatSocketUrl(tokenRef.current, roomSlug));
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
      setState((current) => reduceEvent(current, payload));
    };

    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
      if (generation !== generationRef.current) return;
      setState((current) => ({ ...current, status: "offline" }));
      const wait = Math.min(15_000, 800 * 2 ** retryRef.current);
      retryRef.current += 1;
      window.setTimeout(() => connect(generation), wait);
    };

    socket.onerror = () => {
      if (generation !== generationRef.current) return;
      setState((current) => ({ ...current, error: "No se pudo conectar con el chat." }));
    };
  }, [roomSlug]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
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
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect]);

  // Portada del día para el efecto «Vinilo» (una sola descarga).
  useEffect(() => {
    let cancelled = false;
    void chatApi.dailyCover()
      .then((cover) => { if (!cancelled) setState((current) => ({ ...current, cover })); })
      .catch(() => { /* sin portada el efecto se pinta estático */ });
    return () => { cancelled = true; };
  }, []);

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

  /** Cambia el apodo en vivo; si el socket está caído, por HTTP. */
  const setName = useCallback(async (displayName: string) => {
    const clean = displayName.trim().slice(0, 40);
    if (clean.length < 2) return;
    setState((current) => ({
      ...current,
      actor: current.actor ? { ...current.actor, displayName: clean } : current.actor,
    }));
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      send({ type: "profile", displayName: clean });
    } else {
      await chatApi.setName(clean);
    }
  }, [send]);

  return useMemo(() => ({
    ...state,
    sendMessage, sendAction, notifyTyping, equip, buy, setName,
  }), [state, sendMessage, sendAction, notifyTyping, equip, buy, setName]);
}

function reduceEvent(current: ChatState, event: Record<string, unknown>): ChatState {
  switch (event["type"]) {
    case "snapshot": {
      const actor = event["actor"] as ChatUser;
      return {
        ...current,
        status: "online",
        actor,
        room: event["room"] as ChatRoom,
        messages: (event["messages"] as ChatMessage[]).slice(-200),
        users: event["users"] as ChatUser[],
        effects: event["effects"] as ChatEffect[],
        wallet: event["me"] as Wallet,
        error: null,
      };
    }
    case "message": {
      const message = event["message"] as ChatMessage;
      // Un mensaje repetido (reconexión, eco) no se duplica en la lista.
      if (current.messages.some((item) => item.id === message.id)) return current;
      const messages = [...current.messages, message].slice(-200);
      return { ...current, messages };
    }
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
        actor: current.actor?.id === actorId ? { ...current.actor, equipped } : current.actor,
      };
    }
    case "error": {
      const message = String(event["message"] ?? "Error del chat.");
      return { ...current, error: message };
    }
    default:
      return current;
  }
}
