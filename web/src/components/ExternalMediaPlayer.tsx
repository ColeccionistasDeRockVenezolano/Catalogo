import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowSquareOut, ArrowsInSimple, ArrowsOutSimple, DotsSix, Minus, PictureInPicture, PushPin, X } from "@phosphor-icons/react";
import type { EmbedSpec } from "../lib/embeds";
import { claimMedia, releaseMedia } from "../lib/exclusive-media";
import { showWithoutFocus, useFloatingVideo } from "../lib/useFloatingVideo";
import { useInlineMediaPosition } from "../lib/useInlineMediaPosition";
import { ErrorBoundary, ErrorNotice } from "./ErrorBoundary";
import { tryMediaOperation } from "../lib/media-operation";

export interface ExternalMediaSource { id: string; subject: string; label: string; url: string; path: string; embed: EmbedSpec; video: boolean;
  /** Abre directamente el reproductor flotante grande (p. ej. «Un disco para hoy»). */
  float?: boolean; }
interface Registry {
  register: (source: ExternalMediaSource, slot: HTMLDivElement | null) => void;
  show: (id: string) => void;
}
const Context = createContext<Registry | null>(null);
export function useExternalMedia() {
  const context = useContext(Context);
  if (!context) throw new Error("ExternalMediaProvider no está disponible.");
  return context;
}

/** Widgets live above routes; detaching a page slot never detaches an active iframe. */
export function ExternalMediaProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<ExternalMediaSource[]>([]);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const active = useRef<string | null>(null);
  const [, setRevision] = useState(0);
  const [shown, setShown] = useState<{ id: string; revision: number } | null>(null);
  const register = useCallback((source: ExternalMediaSource, slot: HTMLDivElement | null) => {
    if (slot) {
      slots.current.set(source.id, slot);
      setSources(previous => previous.some(item => item.id === source.id) ? previous : [...previous, source]);
    } else slots.current.delete(source.id);
    // React may detach and reattach a ref in the same commit or StrictMode pass.
    queueMicrotask(() => {
      setSources(previous => previous.filter(item => slots.current.has(item.id) || active.current === item.id));
      setRevision(value => value + 1);
    });
  }, []);
  const show = useCallback((id: string) => setShown(value => ({ id, revision: (value?.revision ?? 0) + 1 })), []);
  const activate = useCallback((id: string | null) => { active.current = id; }, []);
  const remove = useCallback((id: string) => {
    if (active.current === id) active.current = null;
    if (!slots.current.has(id)) setSources(previous => previous.filter(item => item.id !== id));
  }, []);
  return <Context.Provider value={{ register, show }}>{children}{sources.map(source => <ErrorBoundary key={source.id}
    resetKey={shown?.id === source.id ? shown.revision : 0}
    onError={() => { releaseMedia(source.id); remove(source.id); }}
    fallback={(_error, retry) => createPortal(<ErrorNotice label={`el reproductor de ${source.label}`} onRetry={retry} />, slots.current.get(source.id) ?? document.body)}>
    <ExternalPlayer source={source} slot={slots.current.get(source.id)} shown={shown?.id === source.id ? shown.revision : 0} onActive={activate} onRelease={remove} />
  </ErrorBoundary>)}</Context.Provider>;
}

interface SoundCloudWidget { bind: (event: string, callback: () => void) => void; unbind: (event: string) => void; pause: () => void; }
type SoundCloudWindow = Window & { SC?: { Widget: ((frame: HTMLIFrameElement) => SoundCloudWidget) & { Events: { PLAY: string } } } };
let soundCloudApi: Promise<void> | undefined;
function loadSoundCloud() {
  if ((window as SoundCloudWindow).SC) return Promise.resolve();
  return soundCloudApi ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script"); script.src = "https://w.soundcloud.com/player/api.js";
    script.onload = () => resolve(); script.onerror = () => { soundCloudApi = undefined; reject(new Error("SoundCloud no disponible")); }; document.head.append(script);
  });
}

function ExternalPlayer({ source, slot, shown, onActive, onRelease }: {
  source: ExternalMediaSource; slot: HTMLDivElement | undefined; shown: number;
  onActive: (id: string | null) => void; onRelease: (id: string) => void;
}) {
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const widget = useRef<SoundCloudWidget | null>(null);
  const disposeWidget = useRef<(() => void) | null>(null);
  const attachIframe = useCallback((node: HTMLIFrameElement | null) => {
    // A keyed iframe can be replaced before its parent's layout cleanup.
    // Ref detachment is the last point where the old contentWindow exists.
    if (iframe.current !== node) disposeWidget.current?.();
    iframe.current = node;
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"inline" | "modal" | "floating">(source.float ? "floating" : source.video ? "modal" : "inline");
  const [generation, setGeneration] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [hidden, setHidden] = useState(Boolean(source.float));
  const floating = mode === "floating" || !slot;
  const modal = mode === "modal" && !floating;
  const ui = useFloatingVideo(panel, floating);
  const compact = floating && !ui.expanded;
  const inlinePosition = useInlineMediaPosition(panel, slot, !floating && !modal);
  const stop = useCallback(() => {
    tryMediaOperation(() => widget.current?.pause(), source.label);
    // unbind also reads src to determine postMessage's target origin.
    disposeWidget.current?.();
    if (iframe.current) iframe.current.src = "about:blank";
    setLoaded(false); setEngaged(false); setGeneration(value => value + 1);
    releaseMedia(source.id); onRelease(source.id);
    setMode(source.float ? "floating" : "inline");
    setHidden(source.video || Boolean(source.float));
  }, [source.id, source.video, source.float, source.label, onRelease]);
  const activate = useCallback(() => {
    claimMedia(source.id, stop); onActive(source.id); setEngaged(true);
  }, [source.id, stop, onActive]);
  useEffect(() => () => releaseMedia(source.id), [source.id]);
  useEffect(() => {
    if (!shown) return;
    setHidden(false);
    if (source.float) { activate(); setMode("floating"); setExpandOnShow(shown); return; }
    setMode(source.video ? "modal" : "inline");
  }, [shown, source.video, source.float, activate]);
  const [expandOnShow, setExpandOnShow] = useState(0);
  useEffect(() => { if (expandOnShow && floating) ui.resize(true, false); }, [expandOnShow, floating]); // eslint-disable-line react-hooks/exhaustive-deps
  const float = () => { activate(); setMode("floating"); };
  const restore = () => {
    if (source.float) { ui.resize(true); return; }
    if (!slot) navigate(source.path);
    setMode(source.video ? "modal" : "inline");
  };
  // Cross-origin widgets receive clicks inside their own document. Focus intent
  // claims exclusivity before playback; SoundCloud PLAY also covers auto-next.
  useEffect(() => {
    let timer: number | undefined;
    const focus = () => { timer = window.setTimeout(() => { if (document.activeElement === iframe.current) activate(); }, 0); };
    window.addEventListener("blur", focus);
    const frame = iframe.current;
    frame?.addEventListener("focus", activate);
    return () => { window.clearTimeout(timer); window.removeEventListener("blur", focus); frame?.removeEventListener("focus", activate); };
  }, [activate, generation, hidden]);
  // The widget sends postMessage even from unbind. Dispose it before React
  // detaches the iframe; passive effect cleanup sees contentWindow === null.
  useLayoutEffect(() => {
    const frame = iframe.current;
    if (source.embed.platform !== "soundcloud" || !loaded || !frame) return;
    let disposed = false;
    let instance: SoundCloudWidget | undefined;
    let eventName: string | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      widget.current = null;
      disposeWidget.current = null;
      if (eventName) tryMediaOperation(() => instance?.unbind(eventName!), source.label);
    };
    disposeWidget.current = dispose;
    void loadSoundCloud().then(() => {
      const api = (window as SoundCloudWindow).SC;
      if (disposed || !api || iframe.current !== frame) return;
      instance = api.Widget(frame); eventName = api.Widget.Events.PLAY;
      widget.current = instance; instance.bind(eventName, activate);
    }).catch(() => { /* Native controls and iframe focus still work offline. */ });
    return dispose;
  }, [loaded, source.embed.platform, source.label, activate, generation]);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node || hidden) return;
    if (node.open) node.close();
    if (!modal) { showWithoutFocus(node); return () => node.close(); }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    try { node.showModal(); } catch (error) { document.body.style.overflow = overflow; throw error; }
    return () => { node.close(); document.body.style.overflow = overflow; };
  }, [modal, hidden]);

  if (hidden) return null;
  return createPortal(<dialog ref={dialog} className={`video-layer video-layer--external${modal ? "" : floating ? " video-layer--floating" : " video-layer--inline"}`} aria-label={`${source.subject} en ${source.label}`}
    onCancel={event => { event.preventDefault(); if (floating && ui.expanded) ui.resize(false, false); else float(); }}
    onClick={event => { if (modal && event.target === event.currentTarget) float(); }}>
    <div ref={panel} className={`listen-embed media-player${source.embed.height === null || source.video ? " media-player--video" : ""}${loaded ? " is-loaded" : ""}${floating ? " listen-embed--floating" : ""}${compact ? " listen-embed--compact" : ""}${modal ? " media-player--modal" : ""}${ui.dragging ? " listen-embed--dragging" : ""}`} style={floating ? ui.style : modal ? undefined : inlinePosition} onClickCapture={ui.onClickCapture}>
      <div className="listen-embed__toolbar media-player__toolbar">
        {floating ? <button type="button" className="listen-embed__move" {...ui.gestures} aria-label="Mover reproductor"><DotsSix size={18} /></button> : null}
        <div className="media-player__identity"><strong>{source.subject}</strong><span>{source.label}{engaged ? " · Sesión activa" : ""}</span></div>
        <div className="media-player__actions">
          {floating && !compact ? <button type="button" className={ui.pinned ? "is-active" : undefined} onClick={ui.togglePinned} aria-label={ui.pinned ? "Desanclar reproductor" : "Anclar reproductor"} aria-pressed={ui.pinned} title="Mantener el tamaño pequeño al navegar"><PushPin size={18} weight={ui.pinned ? "fill" : "regular"} /></button> : null}
          {!compact ? <button type="button" onClick={floating ? () => ui.resize(false) : float} aria-label={floating ? "Poner en miniatura" : "Video flotante"} title="Miniatura flotante"><PictureInPicture size={18} /></button> : null}
          {floating && !compact ? <button type="button" onClick={restore} aria-label={source.video ? "Abrir en modal" : "Volver al reproductor"}><ArrowsOutSimple size={18} /></button> : null}
          {floating || modal ? <button type="button" onClick={stop} aria-label="Cerrar reproductor"><X size={18} /></button> : null}
        </div>
      </div>
      <div className="listen-embed__frame" style={source.embed.height ? { height: source.embed.height } : { aspectRatio: "16 / 9", minHeight: 200 }}>
        <iframe ref={attachIframe} key={generation} src={source.embed.src} title={`${source.subject} en ${source.label}`} loading="eager" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setLoaded(true)} onFocus={activate} />
      </div>
      {compact ? <button type="button" className="media-player__expand" onClick={event => ui.resize(true, event.detail !== 0)} aria-label="Mostrar reproductor pequeño"><ArrowsOutSimple size={16} /> Mostrar controles</button> : <div className="media-player__footer"><a href={source.url} target="_blank" rel="noreferrer">Abrir en {source.label}<ArrowSquareOut size={14} /></a>{floating ? <button type="button" onClick={restore}><ArrowsInSimple size={16} /> {source.video ? "Modal" : "Volver"}</button> : <button type="button" onClick={float}><Minus size={16} /> Miniatura</button>}</div>}
    </div>
  </dialog>, document.body);
}
