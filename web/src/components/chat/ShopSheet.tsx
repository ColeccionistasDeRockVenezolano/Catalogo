import { EQUIPPED_SLOTS } from "../../../../src/chat/slots";
// CRV · Tienda de efectos con probador en vivo.
//
// Arriba, un escenario con tu avatar, tu nombre, un mensaje de ejemplo, el
// fondo y el ambiente. Tocar una tarjeta prueba el efecto al instante sin
// comprarlo; «Reproducir» repite los que se disparan (mensajes, entradas,
// acciones y stickers). El probador tiene prioridad en el presupuesto: lo que
// pruebas siempre se mueve; las tarjetas solo animan mientras se ven.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatCircleText, Coin, DoorOpen, HandsClapping, ImageSquare, Play, Sparkle, X,
} from "@phosphor-icons/react";
import type { ChatEffect, ChatUser } from "../../../../src/chat/protocol";
import { RARITY_LABEL, rarityOf, type Rarity } from "../../../../src/chat/rarity";
import { chatApi } from "../../lib/api";
import { equippedEffect, layerStyle, manifestOf, type EffectSlot, type Quality } from "../../lib/chatEffects";
import { BurstText, ChatAvatar, EffectName, MessageBurst, RoomAmbient, RoomBackdrop, StickerArt } from "./Effects";
import { SceneLayer, type SceneRequest } from "./Scenes";

export const SLOT_LABEL: Record<EffectSlot, string> = {
  name: "Nombre", frame: "Marco", background: "Fondo", ambient: "Ambiente", name_font: "Fuente", badge: "Placa",
};

const KIND_LABEL: Record<string, string> = {
  name: "Nombres", name_font: "Fuentes", badge: "Placas", frame: "Marcos", entry: "Entradas", message: "Mensajes",
  action: "Acciones", sticker: "Stickers", background: "Fondos", ambient: "Ambientes",
};

/** Orden de las pestañas: lo que se lleva puesto primero. */
const KIND_ORDER = ["name", "name_font", "badge", "frame", "entry", "message", "action", "sticker", "background", "ambient"];
const SLOTS = EQUIPPED_SLOTS;
const PLAYABLE = new Set(["message", "entry", "action", "sticker"]);

type Ownership = "all" | "owned" | "equipped";
type Sort = "shop" | "price-asc" | "price-desc";

export const ACTION_LABEL: Record<string, string> = {
  pogo: "se lanzó al pogo 🤘",
  crowd: "encendió al público 🙌",
  choque: "chocó vinilos 💥",
  aplausos: "pidió aplausos 👏",
};

export function actionLabel(code: string): string {
  return ACTION_LABEL[code] ?? "hizo una acción";
}

/** «12 d 4 h», «3 h 20 min» o «caducado». */
export function remaining(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "caducado";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${Math.max(1, minutes)} min`;
}

export function ShopContent({ actor, effects, wallet, cover, quality, isAdmin, onClose, onBuy, onEquip, onAction, roomBackground, roomAmbient }: {
  actor: ChatUser | null;
  roomBackground: ChatEffect | null; roomAmbient: ChatEffect | null;
  effects: ChatEffect[]; wallet: { coins: number; credits: number }; cover: string | null;
  quality: Quality; isAdmin: boolean; onClose: () => void;
  onBuy: (code: string) => Promise<void>; onEquip: (slot: EffectSlot, code: string | null) => Promise<void>;
  onAction: (code: string) => void;
}) {
  const kinds = [...new Set(effects.map((effect) => effect.kind))]
    .sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  const stageRef = useRef<HTMLElement | null>(null);
  const [kind, setKind] = useState<string>(kinds[0] ?? "name");
  const [trial, setTrial] = useState<ChatEffect | null>(null);
  const [ownership, setOwnership] = useState<Ownership>("all");
  const [sort, setSort] = useState<Sort>("shop");
  const [affordable, setAffordable] = useState(false);
  const [expiry, setExpiry] = useState<Map<string, string | null>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [scenes, setScenes] = useState<SceneRequest[]>([]);
  const [replay, setReplay] = useState(0);

  // Cuenta atrás de los alquileres: el inventario trae la caducidad.
  const ownedKey = effects.filter((effect) => effect.owned).map((effect) => effect.code).join(",");
  useEffect(() => {
    let cancelled = false;
    void chatApi.inventory()
      .then((result) => {
        if (!cancelled) setExpiry(new Map(result.inventory.map((item) => [item.code, item.expiresAt])));
      })
      .catch(() => { /* sin inventario no se muestra la cuenta atrás */ });
    return () => { cancelled = true; };
  }, [ownedKey, wallet.coins, wallet.credits]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const current = trial ? effects.find((effect) => effect.code === trial.code) ?? trial : null;

  // Lo que se ve en el probador: lo equipado, salvo la ranura que pruebas.
  const pick = (slot: EffectSlot): ChatEffect | null => (
    current?.kind === slot ? current : equippedEffect(actor, effects, slot)
      ?? (slot === "background" ? roomBackground : slot === "ambient" ? roomAmbient : null)
  );
  const nameEffect = pick("name");
  const font = pick("name_font");
  const badge = pick("badge");
  const frame = pick("frame");
  const background = pick("background");
  const ambient = pick("ambient");
  const displayName = actor?.displayName ?? "Invitado";
  const myName = (
    <EffectName name={displayName} effect={nameEffect} font={font} badge={badge} cover={cover} quality={quality} priority={2} />
  );

  const play = useCallback((effect: ChatEffect): void => {
    setReplay((value) => value + 1);
    if (effect.kind === "entry" || effect.kind === "action") {
      setScenes([{
        id: `${effect.code}-${Date.now()}`, effect, who: displayName,
        label: effect.kind === "entry" ? `${displayName} entró a La Rockola` : `${displayName} ${actionLabel(effect.code)}`,
        nameNode: effect.kind === "entry" ? (
          <EffectName name={displayName} effect={nameEffect} font={font} badge={badge} cover={cover} quality={quality} priority={2} className="crv-scene-name" />
        ) : undefined,
      }]);
    }
  }, [badge, cover, displayName, font, nameEffect, quality]);

  const tryOn = (effect: ChatEffect): void => {
    setTrial(effect);
    if (PLAYABLE.has(effect.kind)) play(effect);
    const body = stageRef.current?.closest(".chat-sheet-body");
    if (body) body.scrollTop = 0;
  };

  const list = useMemo(() => {
    const filtered = effects.filter((effect) => effect.kind === kind
      && (ownership === "all" || (ownership === "owned" ? effect.owned : effect.equipped))
      && (!affordable || effect.owned || (effect.priceCoins <= wallet.coins || effect.priceCredits <= wallet.credits)));
    if (sort === "price-asc") filtered.sort((a, b) => a.priceCoins - b.priceCoins);
    if (sort === "price-desc") filtered.sort((a, b) => b.priceCoins - a.priceCoins);
    return filtered;
  }, [affordable, effects, kind, ownership, sort, wallet.coins, wallet.credits]);

  const equippable = current && (SLOTS as readonly string[]).includes(current.kind);
  const messageEffect = current?.kind === "message" ? current : null;
  const sticker = current?.kind === "sticker" ? current : null;
  const left = current ? remaining(expiry.get(current.code) ?? null, now) : null;
  const [buying, setBuying] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const purchase = async (code: string): Promise<void> => {
    if (buying) return;
    setBuying(true); setFeedback(null);
    try { await onBuy(code); setFeedback("Compra completada."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "No se pudo comprar."); }
    finally { setBuying(false); }
  };

  return (
    <>
      <section ref={stageRef} className="crv-probador" aria-label="Probador">
        <RoomBackdrop effect={background} quality={quality} contained />
        <RoomAmbient effect={ambient} quality={quality} contained />
        <div className="crv-probador-row">
          <ChatAvatar user={actor ?? { displayName, avatarSeed: "tu" }} frame={frame} quality={quality} size={44} priority={2} />
          <div className="crv-probador-bubble">
            <header>{myName}<time>ahora</time></header>
            {sticker ? (
              <StickerArt key={`st-${replay}`} effect={sticker} quality={quality} />
            ) : (
              <BurstText key={`m-${replay}`} effect={messageEffect} fresh quality={quality} priority={2}>
                ¿Qué disco pusiste hoy?
              </BurstText>
            )}
            {messageEffect ? <MessageBurst key={`b-${replay}`} effect={messageEffect} quality={quality} fresh priority={2} /> : null}
          </div>
        </div>
        <SceneLayer queue={scenes} quality={quality} scope="stage" onDone={(id) => setScenes((items) => items.filter((item) => item.id !== id))} />
        {current && PLAYABLE.has(current.kind) ? (
          <button type="button" className="crv-probador-play" onClick={() => play(current)}>
            <Play size={14} weight="fill" aria-hidden="true" /> Reproducir
          </button>
        ) : null}
        {current ? (
          <span className="crv-probador-tag">
            {current.owned ? "Tuyo" : "Probando"} · {current.name}
          </span>
        ) : <span className="crv-probador-tag">Toca un efecto para probarlo</span>}
      </section>

      <p className="chat-wallet-line">
        <Coin size={18} weight="duotone" aria-hidden="true" /> {wallet.coins} monedas
        <span> · {wallet.credits} créditos</span>
      </p>

      <div className="chat-kind-tabs" role="group" aria-label="Tipo de efecto">
        {kinds.map((item) => (
          <button
            key={item} type="button" aria-pressed={kind === item}
            className={kind === item ? "is-active" : ""} onClick={() => { setKind(item); const body = stageRef.current?.closest(".chat-sheet-body"); if (body) body.scrollTop = 0; }}
          >
            {KIND_LABEL[item] ?? item}
          </button>
        ))}
      </div>

      <div className="crv-shop-filters">
        <div className="crv-chip-group" role="group" aria-label="Mostrar">
          {([["all", "Todos"], ["owned", "Tuyos"], ["equipped", "Equipados"]] as const).map(([value, label]) => (
            <button
              key={value} type="button" aria-pressed={ownership === value}
              className={ownership === value ? "is-active" : ""} onClick={() => setOwnership(value)}
            >
              {label}
            </button>
          ))}
          <button type="button" aria-pressed={affordable} className={affordable ? "is-active" : ""} onClick={() => setAffordable((value) => !value)}>
            Me alcanza
          </button>
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Ordenar por precio">
          <option value="shop">Orden de la tienda</option>
          <option value="price-asc">Precio: menor a mayor</option>
          <option value="price-desc">Precio: mayor a menor</option>
        </select>
      </div>

      {current ? (
        <div className="chat-effect-detail">
          <div className="chat-effect-detail-head">
            <h3>{current.name} <RarityBadge rarity={rarityOf(current)} /></h3>
            <button type="button" onClick={() => setTrial(null)} aria-label="Dejar de probar"><X size={16} weight="bold" /></button>
          </div>
          <p>{current.description}</p>
          <p className="chat-effect-meta">
            {current.durationDays ? `Alquiler de ${current.durationDays} días` : "Permanente"}
            {" · "}{current.priceCoins} monedas o {current.priceCredits} créditos
            {current.owned && left ? <strong className="crv-countdown"> · quedan {left}</strong> : null}
            {current.owned && !left && !current.durationDays ? " · tuyo para siempre" : null}
          </p>
          {feedback ? <p role="status">{feedback}</p> : null}
          <div className="chat-effect-actions">
            {!current.owned ? (
              <button
                type="button" className="chat-primary"
                disabled={buying || (current.priceCoins > wallet.coins && current.priceCredits > wallet.credits)}
                onClick={() => void purchase(current.code)}
              >
                Comprar por {current.priceCoins} ¢
              </button>
            ) : null}
            {current.owned && current.durationDays ? (
              <button type="button" className="chat-secondary" disabled={buying} onClick={() => void purchase(current.code)}>
                Renovar ({current.priceCoins} ¢)
              </button>
            ) : null}
            {equippable && current.owned ? (
              <button
                type="button" className="chat-secondary"
                onClick={() => void onEquip(current.kind as EffectSlot, current.equipped ? null : current.code)}
              >
                {current.equipped ? "Quitar" : "Equipar"}
              </button>
            ) : null}
            {current.owned && current.kind === "action" ? (
              <button type="button" className="chat-primary" onClick={() => onAction(current.code)}>
                Hacerlo ahora
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {list.length === 0 ? <p className="crv-shop-empty">Nada por aquí con estos filtros.</p> : null}
      <div className="chat-effect-grid">
        {list.map((effect) => (
          <EffectCard
            key={effect.code}
            effect={effect}
            selected={current?.code === effect.code}
            left={effect.owned ? remaining(expiry.get(effect.code) ?? null, now) : null}
            cover={cover}
            quality={quality}
            onSelect={() => tryOn(effect)}
          />
        ))}
      </div>

      {isAdmin ? <AdminEffectEditor onClose={onClose} /> : null}
    </>
  );
}

function RarityBadge({ rarity }: { rarity: Rarity }) {
  return <span className={`crv-rarity crv-rarity-${rarity}`}>{RARITY_LABEL[rarity]}</span>;
}

function EffectCard({ effect, selected, left, cover, quality, onSelect }: {
  effect: ChatEffect; selected: boolean; left: string | null; cover: string | null;
  quality: Quality; onSelect: () => void;
}) {
  const rarity = rarityOf(effect);
  return (
    <button
      type="button"
      className={`chat-effect-card crv-card-${rarity}${selected ? " is-selected" : ""}${effect.equipped ? " is-equipped" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="chat-effect-preview" data-kind={effect.kind}>
        <CardPreview effect={effect} cover={cover} quality={quality} />
      </span>
      <span className="chat-effect-name">{effect.name}</span>
      <span className="crv-card-foot">
        <RarityBadge rarity={rarity} />
        <span className="chat-effect-price">
          {effect.owned
            ? (effect.equipped ? "Equipado" : left ? `Tuyo · ${left}` : "Tuyo")
            : `${effect.priceCoins} ¢ · ${effect.priceCredits} cr`}
        </span>
      </span>
    </button>
  );
}

/** Miniatura por tipo: lo que se lleva puesto, animado solo si se ve. */
function CardPreview({ effect, cover, quality }: { effect: ChatEffect; cover: string | null; quality: Quality }) {
  switch (effect.kind) {
    case "name":
    case "name_font":
      return (
        <EffectName
          name={effect.kind === "name_font" ? "La Rockola" : effect.name}
          effect={effect.kind === "name" ? effect : null}
          font={effect.kind === "name_font" ? effect : null}
          cover={cover} quality={quality}
        />
      );
    case "badge":
      return <EffectName name="Rock" effect={null} badge={effect} cover={cover} quality={quality} />;
    case "frame":
      return <ChatAvatar user={{ displayName: effect.name, avatarSeed: effect.code }} frame={effect} quality={quality} size={30} />;
    case "sticker":
      return <StickerArt effect={effect} quality="low" />;
    case "background": {
      const layer = manifestOf(effect)?.layers.find((item) => item.type === "css");
      return layer ? <span className={`crv-swatch crv-backdrop fx-${layer.preset} is-static`} style={layerStyle(layer)} /> : null;
    }
    default: {
      const Icon = effect.kind === "entry" ? DoorOpen : effect.kind === "action" ? HandsClapping
        : effect.kind === "message" ? ChatCircleText : effect.kind === "ambient" ? Sparkle : ImageSquare;
      const colors = manifestOf(effect)?.layers[0]?.colors ?? [];
      return <Icon size={26} weight="duotone" color={colors[0] ?? undefined} aria-hidden="true" />;
    }
  }
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

/** Referencia estable para no reiniciar escenas al re-renderizar la tienda. */
export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
