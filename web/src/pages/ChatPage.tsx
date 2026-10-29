// CRV · Chat de la comunidad (móvil primero).
//
// Una sola columna en el teléfono: cabecera fina, mensajes, compositor pegado
// al borde inferior con la safe-area y dos hojas (usuarios y tienda) que
// suben desde abajo. En escritorio la lista de usuarios vive a la derecha.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Coin, PaperPlaneTilt, ShieldCheck, Sticker, Storefront, Users, VinylRecord, X } from "@phosphor-icons/react";
import { useChat } from "../lib/chatSocket";
import {
  equippedEffect, formatTime, useChatQuality,
} from "../lib/chatEffects";
import { useOperator } from "../lib/OperatorContext";
import { BurstText, ChatAvatar, EffectName, MessageBurst, RoomAmbient, RoomBackdrop, StickerArt } from "../components/chat/Effects";
import { setMotionScope } from "../lib/chatMotion";
import { MaterialStage } from "../components/chat/MaterialStage";
import { ParticleStage } from "../components/chat/ParticleStage";
import { SceneLayer, type SceneRequest } from "../components/chat/Scenes";
import { ShopContent, SLOT_LABEL, actionLabel } from "../components/chat/ShopSheet";
import { EffectFilters } from "../components/chat/TextEffects";
import { MessageMenu, ModerationSheet } from "../components/chat/Moderation";
import type { ChatEffect, ChatMessage, ChatUser } from "../../../src/chat/protocol";
import "../styles/chat.css";
import "../styles/reactbits.css";
import "../styles/chat-motion.css";
import "../styles/chat-materials.css";

export function ChatPage() {
  const chat = useChat("general");
  const quality = useChatQuality();
  const { isAdmin } = useOperator();
  const [sheet, setSheet] = useState<"none" | "users" | "shop" | "mod" | "stickers">("none");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [askName, setAskName] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const loadingEarlier = useRef(false);
  const historyScrollRequest = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [scenes, setScenes] = useState<SceneRequest[]>([]);
  const seenScenes = useRef(new Set<string>());

  // Teclado del móvil: sin esto el compositor queda debajo del teclado.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = (): void => {
      document.documentElement.style.setProperty("--chat-vvh", `${viewport.height}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element || loadingEarlier.current) return;
    if (chat.followingLatest && nearBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [chat.messages, chat.followingLatest]);

  const jumpToLatest = (): void => {
    historyScrollRequest.current += 1;
    loadingEarlier.current = false;
    chat.resumeLatest();
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    nearBottom.current = true;
    setAtBottom(true);
  };

  const loadHistory = async (direction: "earlier" | "newer"): Promise<void> => {
    const element = listRef.current;
    if (!element || loadingEarlier.current) return;
    loadingEarlier.current = true;
    const request = ++historyScrollRequest.current;
    nearBottom.current = false;
    const loaded = await (direction === "earlier" ? chat.loadEarlier() : chat.loadNewer());
    requestAnimationFrame(() => {
      if (request !== historyScrollRequest.current) return;
      if (loaded && element.isConnected) element.scrollTop = 0;
      loadingEarlier.current = false;
    });
  };

  useEffect(() => {
    if (!chat.error) return;
    setNotice(chat.error);
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [chat.error]);

  // Aviso en vivo a moderadores (detector, Laya, reportes).
  const latestAlert = chat.alerts[0];
  useEffect(() => {
    if (latestAlert) setNotice(`Moderación: ${latestAlert.text}`);
  }, [latestAlert]);

  useEffect(() => {
    if (chat.actor?.displayName === "Oyente") setAskName(true);
  }, [chat.actor?.displayName]);

  const myNameEffect = equippedEffect(chat.actor, chat.effects, "name");
  const myFont = equippedEffect(chat.actor, chat.effects, "name_font");
  const myFrame = equippedEffect(chat.actor, chat.effects, "frame");
  // Los IDs frescos vienen de eventos WS; cargar o reconectar el historial
  // nunca reproduce las acciones antiguas.
  useEffect(() => {
    const incoming: SceneRequest[] = [];
    const remember = (id: string): boolean => {
      if (seenScenes.current.has(id)) return false;
      seenScenes.current.add(id);
      if (seenScenes.current.size > 500) seenScenes.current.delete(seenScenes.current.values().next().value!);
      return true;
    };
    for (const message of chat.recentMessages) {
      if (message.kind !== "action" || !chat.freshMessageIds.includes(message.id)) continue;
      const effect = chat.effects.find((item) => item.code === message.effectCode && item.kind === "action");
      if (effect && remember(`message-${message.id}`) && chat.followingLatest && !document.hidden) incoming.push({
        id: `message-${message.id}`, effect, who: message.displayName ?? "Alguien",
        label: `${message.displayName ?? "Alguien"} ${actionLabel(message.body)}`,
      });
    }
    for (const entry of chat.entries) {
      const effect = chat.effects.find((item) => item.code === entry.effectCode && item.kind === "entry");
      if (!effect || !remember(entry.id) || !chat.followingLatest || document.hidden) continue;
      incoming.push({
        id: entry.id, effect, who: entry.displayName, label: `${entry.displayName} entró a La Rockola`,
        nameNode: <EffectName name={entry.displayName}
          effect={equippedEffect(entry, chat.effects, "name")}
          font={equippedEffect(entry, chat.effects, "name_font")}
          cover={chat.cover?.coverUrl ?? null} quality={quality} priority={2} />,
      });
    }
    if (incoming.length) setScenes((current) => [...current, ...incoming].slice(-4));
  }, [chat.recentMessages, chat.freshMessageIds, chat.entries, chat.effects, chat.cover, chat.followingLatest, quality]);
  // El tema de la sala trae fondo y ambiente por defecto; si alguien lleva uno
  // equipado, el suyo manda.
  const themeBackground = typeof chat.room?.theme["background"] === "string" ? chat.room.theme["background"] : null;
  const themeAmbient = typeof chat.room?.theme["ambient"] === "string" ? chat.room.theme["ambient"] : null;
  const background = useMemo(
    () => chat.users.map((user) => equippedEffect(user, chat.effects, "background")).find((effect) => Boolean(effect))
      ?? (themeBackground ? chat.effects.find((effect) => effect.code === themeBackground) ?? null : null),
    [chat.users, chat.effects, themeBackground],
  );
  const ambient = useMemo(
    () => chat.users.map((user) => equippedEffect(user, chat.effects, "ambient")).find((effect) => Boolean(effect))
      ?? (themeAmbient ? chat.effects.find((effect) => effect.code === themeAmbient) ?? null : null),
    [chat.users, chat.effects, themeAmbient],
  );

  const submit = (): void => {
    if (!draft.trim() || chat.status !== "online") return;
    chat.sendMessage(draft);
    setDraft("");
    jumpToLatest();
  };

  return (
    <div className="chat-shell">
      <EffectFilters />
      <RoomBackdrop effect={background} quality={quality} />
      <RoomAmbient effect={ambient} quality={quality} />
      <ParticleStage quality={quality} />
      <MaterialStage quality={quality} />
      <SceneLayer queue={scenes} quality={quality} onDone={(id) => setScenes((current) => current.filter((scene) => scene.id !== id))} />

      <header className="chat-top">
        <Link to="/" className="chat-back" aria-label="Volver al catálogo">
          <ArrowLeft size={20} weight="bold" aria-hidden="true" />
        </Link>
        <div className="chat-room">
          <VinylRecord size={22} weight="duotone" aria-hidden="true" />
          <div>
            <strong>{chat.room?.name ?? "La Rockola"}</strong>
            <span>{chat.status === "online" ? `${chat.users.length} en línea` : chat.status === "offline" ? "sin conexión" : "conectando…"}</span>
          </div>
        </div>
        <div className="chat-top-actions">
          {isAdmin ? (
            <button type="button" className="chat-icon-button" onClick={() => setSheet("mod")} aria-label="Moderación">
              <ShieldCheck size={22} weight="duotone" aria-hidden="true" />
              {chat.alerts.length ? <span className="chat-mod-dot" aria-hidden="true" /> : null}
            </button>
          ) : null}
          <button type="button" className="chat-coin" onClick={() => setSheet("shop")} aria-label="Monedas y tienda">
            <Coin size={18} weight="duotone" aria-hidden="true" />
            <span>{chat.wallet.coins}</span>
          </button>
          <button type="button" className="chat-icon-button" onClick={() => setSheet("shop")} aria-label="Tienda de efectos">
            <Storefront size={22} weight="duotone" aria-hidden="true" />
          </button>
          <button type="button" className="chat-icon-button" onClick={() => setSheet("users")} aria-label="Quiénes están en línea">
            <Users size={22} weight="duotone" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="chat-body">
        <div
          className="chat-messages"
          ref={listRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140;
            setAtBottom(nearBottom.current);
            if (!nearBottom.current) chat.pauseLatest();
          }}
        >
          {chat.hasMore && chat.messages.length > 0 ? (
            <button type="button" className="chat-history-button" disabled={chat.loadingHistory}
              onClick={() => void loadHistory("earlier")}>
              {chat.loadingHistory ? "Cargando mensajes…" : "Cargar mensajes anteriores"}
            </button>
          ) : null}
          {chat.historyError ? <p className="chat-history-error" role="alert">{chat.historyError}</p> : null}
          {chat.messages.length === 0 ? (
            <p className="chat-empty">
              La Rockola está en silencio. Di la primera palabra: ¿qué disco pusiste hoy?
            </p>
          ) : null}
          {chat.messages.map((message, index) => (
            <MessageRow
              key={message.id}
              message={message}
              effects={chat.effects}
              quality={quality}
              cover={chat.cover?.coverUrl ?? null}
              fresh={chat.followingLatest && chat.freshMessageIds.includes(message.id)}
              compact={isCompact(chat.messages[index - 1], message)}
              own={message.actorId === chat.actor?.id} isAdmin={isAdmin} onNotice={setNotice}
            />
          ))}
          {chat.newerCursors.length > 0 ? (
            <button type="button" className="chat-history-button" disabled={chat.loadingHistory}
              onClick={() => void loadHistory("newer")}>
              Cargar mensajes más recientes
            </button>
          ) : null}
        </div>

        <aside className="chat-users-desktop" aria-label="En línea">
          <h2>En línea <span>{chat.users.length}</span></h2>
          <UserList users={chat.users} effects={chat.effects} quality={quality} />
        </aside>
      </div>

      <div className="chat-composer">
        {!atBottom || !chat.followingLatest ? (
          <button type="button" className="chat-new-messages" onClick={jumpToLatest}>
            {chat.unreadMessages > 0 ? `${chat.unreadMessages} ${chat.unreadMessages === 1 ? "mensaje nuevo" : "mensajes nuevos"}` : "Ir a los últimos mensajes"}
          </button>
        ) : null}
        {chat.typing.length > 0 ? (
          <p className="chat-typing" aria-live="polite">
            {chat.typing.slice(0, 2).join(", ")} {chat.typing.length > 1 ? "están escribiendo…" : "está escribiendo…"}
          </p>
        ) : null}
        {notice ? <p className="chat-notice" role="status">{notice}</p> : null}
        <form
          onSubmit={(event) => { event.preventDefault(); submit(); }}
          className="chat-form"
        >
          <ChatAvatar
            user={chat.actor ?? { displayName: "Tú", avatarSeed: "tu" }}
            frame={myFrame}
            quality={quality}
            size={34}
          />
          <textarea
            value={draft}
            onChange={(event) => { setDraft(event.target.value.slice(0, 2000)); chat.notifyTyping(); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={chat.mutedUntil && new Date(chat.mutedUntil) > new Date() ? "Estás en silencio por ahora" : "Escribe en La Rockola…"}
            rows={1}
            enterKeyHint="send"
            aria-label="Mensaje"
          />
          <button type="button" className="chat-icon-button" aria-label="Enviar sticker" onClick={() => setSheet("stickers")}>
            <Sticker size={22} weight="duotone" aria-hidden="true" />
          </button>
          <button type="submit" className="chat-send" disabled={!draft.trim()} aria-label="Enviar mensaje">
            <PaperPlaneTilt size={20} weight="fill" aria-hidden="true" />
          </button>
        </form>
        <p className="chat-self">
          <EffectName
            name={chat.actor ? chat.actor.displayName : "Invitado"}
            effect={myNameEffect}
            font={myFont}
            cover={chat.cover?.coverUrl ?? null}
            quality={quality}
          />
          <span className="chat-self-actions">
            <button type="button" onClick={() => { setNameDraft(chat.actor?.displayName ?? ""); setAskName(true); }}>apodo</button>
            <button type="button" onClick={() => setSheet("shop")}>cambiar efectos</button>
          </span>
        </p>
      </div>

      {askName ? (
        <Sheet
          title={chat.actor?.displayName === "Oyente" ? "¿Cómo te llamas?" : "Cambiar apodo"}
          onClose={() => setAskName(false)}
        >
          <form
            className="chat-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (nameDraft.trim().length < 2) return;
              setNameError(null);
              void chat.setName(nameDraft).then(() => {
                setAskName(false);
                setNotice(`Ahora te llamas «${nameDraft.trim()}».`);
              }).catch((error: unknown) => {
                setNameError(error instanceof Error ? error.message : "No se pudo cambiar el apodo.");
              });
            }}
          >
            <p>Así te verán los demás en La Rockola. Puedes cambiarlo cuando quieras; tus monedas y efectos no se pierden.</p>
            <input
              value={nameDraft}
              onChange={(event) => { setNameDraft(event.target.value.slice(0, 40)); setNameError(null); }}
              placeholder="Tu apodo"
              autoFocus
              maxLength={40}
              aria-label="Tu apodo"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "chat-name-error" : undefined}
            />
            {nameError ? <p id="chat-name-error" role="alert">{nameError}</p> : null}
            <button type="submit" className="chat-primary" disabled={nameDraft.trim().length < 2}>
              Entrar
            </button>
          </form>
        </Sheet>
      ) : null}

      {sheet === "mod" && isAdmin ? (
        <ModerationSheet room={chat.room} alerts={chat.alerts} onClose={() => setSheet("none")} onNotice={setNotice} />
      ) : null}

      {sheet === "users" ? (
        <Sheet title="En línea" onClose={() => setSheet("none")}>
          <UserList users={chat.users} effects={chat.effects} quality={quality} />
        </Sheet>
      ) : null}

      {sheet === "stickers" ? (
        <Sheet title="Tus stickers" onClose={() => setSheet("none")}>
          <div className="chat-sticker-tray">
            {chat.effects.filter((effect) => effect.kind === "sticker" && effect.owned).map((effect) => (
              <button key={effect.code} type="button" aria-label={`Enviar ${effect.name}`} onClick={() => {
                chat.sendMessage(effect.name, effect.code); setSheet("none"); nearBottom.current = true;
              }}><StickerArt effect={effect} quality={quality} /><span>{effect.name}</span></button>
            ))}
          </div>
          {!chat.effects.some((effect) => effect.kind === "sticker" && effect.owned) ? (
            <p className="crv-shop-empty">Tus stickers aparecerán aquí. Puedes probarlos en la tienda antes de comprarlos.</p>
          ) : null}
          <button type="button" className="chat-secondary" onClick={() => setSheet("shop")}>Ver stickers en la tienda</button>
        </Sheet>
      ) : null}

      {sheet === "shop" ? (
        <Sheet title="Efectos" onClose={() => setSheet("none")}>
        <ShopContent
          actor={chat.actor}
          roomBackground={background} roomAmbient={ambient}
          effects={chat.effects}
          wallet={chat.wallet}
          cover={chat.cover?.coverUrl ?? null}
          quality={quality}
          isAdmin={isAdmin}
          onClose={() => setSheet("none")}
          onBuy={async (code) => {
            try {
              const result = await chat.buy(code);
              setNotice(`Compraste «${result.effect.name}». Saldo: ${result.wallet.coins}.`);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "No se pudo comprar.");
              throw error;
            }
          }}
          onEquip={async (slot, code) => {
            try {
              await chat.equip(slot, code);
              setNotice(code ? `Equipado en ${SLOT_LABEL[slot].toLowerCase()}.` : "Efecto retirado.");
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "No se pudo equipar.");
              throw error;
            }
          }}
          onAction={(code) => { chat.sendAction(code); setSheet("none"); }}
        />
        </Sheet>
      ) : null}
    </div>
  );
}

function isCompact(previous: ChatMessage | undefined, current: ChatMessage): boolean {
  if (!previous || previous.actorId !== current.actorId) return false;
  return new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
}

const MessageRow = memo(function MessageRow({ message, effects, quality, cover, compact, own, isAdmin, onNotice, fresh }: {
  message: ChatMessage; effects: ChatEffect[]; quality: ReturnType<typeof useChatQuality>;
  cover: string | null; compact: boolean; own: boolean; isAdmin: boolean; onNotice: (notice: string) => void; fresh: boolean;
}) {
  const user = {
    displayName: message.displayName ?? "Alguien",
    avatarSeed: message.handle ?? "crv",
  };
  const equipped = message.equipped ?? { name: null, frame: null, background: null, ambient: null, name_font: null };
  const nameEffect = equippedEffect({ equipped }, effects, "name");
  const nameFont = equippedEffect({ equipped }, effects, "name_font");
  const frame = equippedEffect({ equipped }, effects, "frame");
  const burst = message.effectCode ? effects.find((effect) => effect.code === message.effectCode) ?? null : null;

  if (message.kind === "system") {
    return <p className="chat-system" data-message-id={message.id}>{message.body}</p>;
  }
  if (message.kind === "action") {
    return (
      <p className="chat-action" data-message-id={message.id}>
        <EffectName name={user.displayName} effect={nameEffect} font={nameFont} cover={cover} quality={quality} />
        <span> {actionLabel(message.body)}</span>
      </p>
    );
  }

  return (
    <article data-message-id={message.id} className={`chat-message${compact ? " is-compact" : ""}`}>
      {compact ? <span className="chat-gutter" aria-hidden="true" /> : (
        <ChatAvatar user={user} frame={frame} quality={quality} size={38} />
      )}
      <div className="chat-bubble">
        {compact ? null : (
          <header>
            <EffectName name={user.displayName} effect={nameEffect} font={nameFont} cover={cover} quality={quality} />
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </header>
        )}
        {burst?.kind === "sticker" ? <StickerArt effect={burst} quality={quality} /> : (
          <BurstText effect={burst} quality={quality} fresh={fresh}>{message.body}</BurstText>
        )}
        <MessageBurst effect={burst?.kind === "message" ? burst : null} quality={quality} fresh={fresh} />
      </div>
      <MessageMenu message={message} own={own} isAdmin={isAdmin} onNotice={onNotice} />
    </article>
  );
});

function UserList({ users, effects, quality }: {
  users: ChatUser[];
  effects: ChatEffect[]; quality: ReturnType<typeof useChatQuality>;
}) {
  return (
    <ul className="chat-user-list">
      {users.map((user) => (
        <li key={user.id}>
          <ChatAvatar user={user} frame={equippedEffect(user, effects, "frame")} quality={quality} size={32} />
          <EffectName
            name={user.displayName}
            effect={equippedEffect(user, effects, "name")}
            font={equippedEffect(user, effects, "name_font")}
            cover={null} quality={quality}
          />
        </li>
      ))}
    </ul>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    setMotionScope(ref.current);
    const behind = [...document.querySelectorAll<HTMLElement>(".chat-top, .chat-body, .chat-composer")];
    const saved = behind.map((element) => element.inert);
    behind.forEach((element) => { element.inert = true; });
    const controls = (): HTMLElement[] => [...(ref.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, textarea, select, a[href], [tabindex="0"]',
    ) ?? [])].filter((element) => element.getClientRects().length > 0);
    (ref.current?.querySelector<HTMLElement>("input") ?? controls()[0] ?? ref.current)?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0]; const last = items.at(-1);
      if (!first) { event.preventDefault(); ref.current?.focus(); return; }
      if (!ref.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      setMotionScope(null);
      behind.forEach((element, index) => { element.inert = saved[index] ?? false; });
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="chat-sheet-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <section ref={ref} tabIndex={-1} className="chat-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar"><X size={20} weight="bold" /></button>
        </header>
        <div className="chat-sheet-body">{children}</div>
      </section>
    </div>
  );
}
