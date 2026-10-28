// CRV · Chat de la comunidad (móvil primero).
//
// Una sola columna en el teléfono: cabecera fina, mensajes, compositor pegado
// al borde inferior con la safe-area y dos hojas (usuarios y tienda) que
// suben desde abajo. En escritorio la lista de usuarios vive a la derecha.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Coin, PaperPlaneTilt, Storefront, Users, VinylRecord, X } from "@phosphor-icons/react";
import { useChat } from "../lib/chatSocket";
import { chatApi } from "../lib/api";
import {
  equippedEffect, formatTime, useChatQuality, type EffectSlot,
} from "../lib/chatEffects";
import { useOperator } from "../lib/OperatorContext";
import { ChatAvatar, EffectName, EntryBurst, MessageBurst, RoomAmbient, RoomBackdrop } from "../components/chat/Effects";
import type { ChatEffect, ChatMessage } from "../../../src/chat/protocol";
import "../styles/chat.css";

const SLOT_LABEL: Record<EffectSlot, string> = {
  name: "Nombre", frame: "Marco", background: "Fondo", ambient: "Ambiente",
};

const KIND_LABEL: Record<string, string> = {
  name: "Nombres", frame: "Marcos", entry: "Entradas", message: "Mensajes",
  action: "Acciones", sticker: "Stickers", background: "Fondos", ambient: "Ambientes",
};

/** Orden de las pestañas: lo que se lleva puesto primero. */
const KIND_ORDER = ["name", "frame", "entry", "message", "action", "sticker", "background", "ambient"];

export function ChatPage() {
  const chat = useChat("general");
  const quality = useChatQuality();
  const { isAdmin } = useOperator();
  const [sheet, setSheet] = useState<"none" | "users" | "shop">("none");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [askName, setAskName] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);

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

  useEffect(() => {
    const element = listRef.current;
    if (!element || !nearBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [chat.messages.length]);

  useEffect(() => {
    if (!chat.error) return;
    setNotice(chat.error);
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [chat.error]);

  useEffect(() => {
    if (chat.actor?.displayName === "Oyente") setAskName(true);
  }, [chat.actor?.displayName]);

  const myNameEffect = equippedEffect(chat.actor, chat.effects, "name");
  const myFrame = equippedEffect(chat.actor, chat.effects, "frame");
  const entryEffect = chat.effects.find((effect) => effect.kind === "entry" && effect.owned) ?? null;
  const background = useMemo(
    () => chat.users.map((user) => equippedEffect(user, chat.effects, "background")).find((effect) => Boolean(effect)) ?? null,
    [chat.users, chat.effects],
  );
  const ambient = useMemo(
    () => chat.users.map((user) => equippedEffect(user, chat.effects, "ambient")).find((effect) => Boolean(effect)) ?? null,
    [chat.users, chat.effects],
  );

  const submit = (): void => {
    if (!draft.trim()) return;
    chat.sendMessage(draft);
    setDraft("");
    nearBottom.current = true;
  };

  return (
    <div className="chat-shell">
      <RoomBackdrop effect={background} quality={quality} />
      <RoomAmbient effect={ambient} quality={quality} />
      <EntryBurst effect={entryEffect} quality={quality} />

      <header className="chat-top">
        <Link to="/" className="chat-back" aria-label="Volver al catálogo">
          <ArrowLeft size={20} weight="bold" aria-hidden="true" />
        </Link>
        <div className="chat-room">
          <VinylRecord size={22} weight="duotone" aria-hidden="true" />
          <div>
            <strong>{chat.room?.name ?? "La Rockola"}</strong>
            <span>{chat.status === "online" ? `${chat.users.length} en línea` : "conectando…"}</span>
          </div>
        </div>
        <div className="chat-top-actions">
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
          }}
        >
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
              compact={isCompact(chat.messages[index - 1], message)}
            />
          ))}
        </div>

        <aside className="chat-users-desktop" aria-label="En línea">
          <h2>En línea <span>{chat.users.length}</span></h2>
          <UserList users={chat.users} effects={chat.effects} quality={quality} />
        </aside>
      </div>

      <div className="chat-composer">
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
            placeholder="Escribe en La Rockola…"
            rows={1}
            enterKeyHint="send"
            aria-label="Mensaje"
          />
          <button type="submit" className="chat-send" disabled={!draft.trim()} aria-label="Enviar mensaje">
            <PaperPlaneTilt size={20} weight="fill" aria-hidden="true" />
          </button>
        </form>
        <p className="chat-self">
          <EffectName
            name={chat.actor ? chat.actor.displayName : "Invitado"}
            effect={myNameEffect}
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
              void chat.setName(nameDraft);
              setAskName(false);
              setNotice(`Ahora te llamas «${nameDraft.trim()}».`);
            }}
          >
            <p>Así te verán los demás en La Rockola. Puedes cambiarlo cuando quieras; tus monedas y efectos no se pierden.</p>
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value.slice(0, 40))}
              placeholder="Tu apodo"
              autoFocus
              maxLength={40}
              aria-label="Tu apodo"
            />
            <button type="submit" className="chat-primary" disabled={nameDraft.trim().length < 2}>
              Entrar
            </button>
          </form>
        </Sheet>
      ) : null}

      {sheet === "users" ? (
        <Sheet title="En línea" onClose={() => setSheet("none")}>
          <UserList users={chat.users} effects={chat.effects} quality={quality} />
        </Sheet>
      ) : null}

      {sheet === "shop" ? (
        <ShopSheet
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
            }
          }}
          onEquip={async (slot, code) => {
            try {
              await chat.equip(slot, code);
              setNotice(code ? `Equipado en ${SLOT_LABEL[slot].toLowerCase()}.` : "Efecto retirado.");
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "No se pudo equipar.");
            }
          }}
          onAction={(code) => { chat.sendAction(code); setSheet("none"); }}
        />
      ) : null}
    </div>
  );
}

function isCompact(previous: ChatMessage | undefined, current: ChatMessage): boolean {
  if (!previous || previous.actorId !== current.actorId) return false;
  return new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
}

function MessageRow({ message, effects, quality, cover, compact }: {
  message: ChatMessage; effects: ChatEffect[]; quality: ReturnType<typeof useChatQuality>;
  cover: string | null; compact: boolean;
}) {
  const user = {
    displayName: message.displayName ?? "Alguien",
    avatarSeed: message.handle ?? "crv",
  };
  const nameEffect = equippedEffect({ equipped: message.equipped ?? { name: null, frame: null, background: null, ambient: null } }, effects, "name");
  const frame = equippedEffect({ equipped: message.equipped ?? { name: null, frame: null, background: null, ambient: null } }, effects, "frame");
  const burst = message.effectCode ? effects.find((effect) => effect.code === message.effectCode) ?? null : null;

  if (message.kind === "system") {
    return <p className="chat-system">{message.body}</p>;
  }
  if (message.kind === "action") {
    return (
      <p className="chat-action">
        <EffectName name={user.displayName} effect={nameEffect} cover={cover} quality={quality} />
        <span> {actionLabel(message.body)}</span>
        <MessageBurst effect={burst} quality={quality} />
      </p>
    );
  }

  return (
    <article className={`chat-message${compact ? " is-compact" : ""}`}>
      {compact ? <span className="chat-gutter" aria-hidden="true" /> : (
        <ChatAvatar user={user} frame={frame} quality={quality} size={38} />
      )}
      <div className="chat-bubble">
        {compact ? null : (
          <header>
            <EffectName name={user.displayName} effect={nameEffect} cover={cover} quality={quality} />
            {message.effectCode === "sticker" ? <span className="chat-sticker">🎵</span> : null}
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </header>
        )}
        <p>{message.body}</p>
        <MessageBurst effect={burst} quality={quality} />
      </div>
    </article>
  );
}

function actionLabel(code: string): string {
  const labels: Record<string, string> = {
    pogo: "se lanzó al pogo 🤘",
    crowd: "encendió al público 🙌",
  };
  return labels[code] ?? "hizo una acción";
}

function UserList({ users, effects, quality }: {
  users: Array<{ id: string; displayName: string; avatarSeed: string; equipped: { name: string | null; frame: string | null; background: string | null; ambient: string | null } }>;
  effects: ChatEffect[]; quality: ReturnType<typeof useChatQuality>;
}) {
  return (
    <ul className="chat-user-list">
      {users.map((user) => (
        <li key={user.id}>
          <ChatAvatar user={user} frame={equippedEffect(user, effects, "frame")} quality={quality} size={32} />
          <EffectName name={user.displayName} effect={equippedEffect(user, effects, "name")} cover={null} quality={quality} />
        </li>
      ))}
    </ul>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="chat-sheet-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <section className="chat-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar"><X size={20} weight="bold" /></button>
        </header>
        <div className="chat-sheet-body">{children}</div>
      </section>
    </div>
  );
}

function ShopSheet({ effects, wallet, cover, quality, isAdmin, onClose, onBuy, onEquip, onAction }: {
  effects: ChatEffect[]; wallet: { coins: number; credits: number }; cover: string | null;
  quality: ReturnType<typeof useChatQuality>; isAdmin: boolean; onClose: () => void;
  onBuy: (code: string) => Promise<void>; onEquip: (slot: EffectSlot, code: string | null) => Promise<void>;
  onAction: (code: string) => void;
}) {
  const kinds = [...new Set(effects.map((effect) => effect.kind))]
    .sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  const [kind, setKind] = useState<string>(kinds[0] ?? "name");
  const [selected, setSelected] = useState<ChatEffect | null>(null);
  const list = effects.filter((effect) => effect.kind === kind);
  const equippable = selected && ["name", "frame", "background", "ambient"].includes(selected.kind);

  return (
    <Sheet title="Efectos" onClose={onClose}>
      <p className="chat-wallet-line">
        <Coin size={18} weight="duotone" aria-hidden="true" /> {wallet.coins} monedas
        {wallet.credits > 0 ? <span> · {wallet.credits} créditos</span> : null}
      </p>
      <div className="chat-kind-tabs" role="tablist">
        {kinds.map((item) => (
          <button
            key={item} type="button" role="tab" aria-selected={kind === item}
            className={kind === item ? "is-active" : ""} onClick={() => { setKind(item); setSelected(null); }}
          >
            {KIND_LABEL[item] ?? item}
          </button>
        ))}
      </div>

      <div className="chat-effect-grid">
        {list.map((effect) => (
          <button
            key={effect.code} type="button"
            className={`chat-effect-card${selected?.code === effect.code ? " is-selected" : ""}${effect.equipped ? " is-equipped" : ""}`}
            onClick={() => setSelected(effect)}
          >
            <span className="chat-effect-preview" data-kind={effect.kind}>
              <EffectName name={effect.name} effect={effect} cover={cover} quality={quality} />
            </span>
            <span className="chat-effect-price">
              {effect.owned ? (effect.equipped ? "Equipado" : "Tuyo") : `${effect.priceCoins} ¢`}
            </span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="chat-effect-detail">
          <h3>{selected.name}</h3>
          <p>{selected.description}</p>
          <p className="chat-effect-meta">
            {selected.durationDays ? `Alquiler ${selected.durationDays} días` : "Permanente"}
            {selected.priceCoins > 0 ? ` · ${selected.priceCoins} monedas` : ""}
          </p>
          <div className="chat-effect-actions">
            {!selected.owned ? (
              <button type="button" className="chat-primary" onClick={() => void onBuy(selected.code)}>
                Comprar por {selected.priceCoins} ¢
              </button>
            ) : null}
            {equippable ? (
              <button
                type="button" className="chat-secondary"
                onClick={() => void onEquip(selected.kind as EffectSlot, selected.equipped ? null : selected.code)}
              >
                {selected.equipped ? "Quitar" : "Equipar"}
              </button>
            ) : null}
            {selected.owned && selected.kind === "action" ? (
              <button type="button" className="chat-primary" onClick={() => onAction(selected.code)}>
                Hacerlo ahora
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isAdmin ? <AdminEffectEditor onClose={onClose} /> : null}
    </Sheet>
  );
}

/** Editor mínimo de efectos (E4): valida el manifiesto en el servidor. */
function AdminEffectEditor({ onClose }: { onClose: () => void }) {
  const [json, setJson] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const publishNow = async (): Promise<void> => {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      await chatApi.publishEffect(parsed);
      setMessage("Efecto publicado. Ya aparece en el catálogo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Manifiesto inválido.");
    }
  };
  return (
    <details className="chat-admin">
      <summary>Administración · publicar efecto</summary>
      <textarea
        value={json}
        onChange={(event) => setJson(event.target.value)}
        placeholder={'{"code":"nuevo","name":"Nuevo","kind":"name","manifest":{"version":1,"triggers":["always"],"cost":2,"reducedMotion":"static","layers":[{"type":"css","preset":"neon","colors":["#e50914"]}]}}'}
        rows={6}
      />
      <div className="chat-effect-actions">
        <button type="button" className="chat-primary" onClick={() => void publishNow()} disabled={!json.trim()}>
          Publicar
        </button>
        <button type="button" className="chat-secondary" onClick={onClose}>Cerrar</button>
      </div>
      {message ? <p className="chat-notice">{message}</p> : null}
    </details>
  );
}
