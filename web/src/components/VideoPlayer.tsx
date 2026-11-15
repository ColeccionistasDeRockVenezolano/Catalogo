import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowClockwise, ArrowSquareOut, ArrowsInSimple, ArrowsOutSimple, DotsSix, MonitorPlay, Pause, PictureInPicture, Play, PushPin, SkipBack, SkipForward, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import { loadYoutubeIframeApi, type YoutubePlayback, type YoutubePlayer } from "../lib/youtube";
import { formatDuration } from "../lib/labels";
import { showWithoutFocus, useFloatingVideo } from "../lib/useFloatingVideo";
import { claimMedia, releaseMedia } from "../lib/exclusive-media";
import { useInlineMediaPosition } from "../lib/useInlineMediaPosition";
import { usePlayerModeTransition } from "../lib/usePlayerModeTransition";
import { ExternalMediaProvider } from "./ExternalMediaPlayer";
import { ErrorBoundary, ErrorNotice } from "./ErrorBoundary";
import { tryMediaOperation } from "../lib/media-operation";

export interface CatalogVideo { videoId: string; title: string; album?: { id: number; title: string } | null; }
export interface CatalogVideoTrack { video: CatalogVideo; title: string; seconds: number; }
/**
 * `embeddable`: la sesión nació en un hueco que admite incrustar (solo la ficha
 * del disco). Un video con disco vinculado que se abre desde la portada o
 * Audiovisuales sigue siendo cine + flotante (Brian, 2026-11-14).
 */
interface VideoSession { video: CatalogVideo; owner: string; path: string; autoplay: boolean; tracks: readonly CatalogVideoTrack[]; embeddable: boolean; }
interface VideoContextValue {
  session: VideoSession | null;
  floating: boolean;
  /** Incrustado en su hueco de la página (solo fichas de disco y perfil de artista). */
  inline: boolean;
  playback: YoutubePlayback | null;
  play: (video: CatalogVideo, owner: string, seconds?: number, autoplay?: boolean, tracks?: readonly CatalogVideoTrack[]) => void;
  float: () => void;
  /** Del reproductor incrustado al modo cine (modal), sin perder la reproducción. */
  cinema: () => void;
  restore: () => void;
  close: () => void;
  registerSlot: (owner: string, node: HTMLDivElement | null, embed?: boolean) => void;
}
const VideoContext = createContext<VideoContextValue | null>(null);
export function useVideoPlayer() {
  const value = useContext(VideoContext);
  if (!value) throw new Error("VideoProvider no está disponible.");
  return value;
}

/**
 * The iframe stays mounted when the native dialog becomes a floating window.
 * Modos (Brian, 2026-11-13): incrustado solo en la ficha del disco, con botón
 * «Modo cine»; el modo cine ofrece pasar a flotante. Audiovisuales y la
 * portada abren directamente en modo cine con la opción flotante.
 */
export function VideoProvider({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const mediaOwner = useId();
  const [session, setSession] = useState<VideoSession | null>(null);
  const [floating, setFloating] = useState(false);
  const [theater, setTheater] = useState(false);
  const [playback, setPlayback] = useState<YoutubePlayback | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const lastAudibleVolume = useRef(100);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const player = useRef<YoutubePlayer | null>(null);
  const pendingStart = useRef<number | null>(null);
  const controlPlayer = useCallback((action: (target: YoutubePlayer) => void) => {
    const target = player.current;
    if (!target) return;
    tryMediaOperation(() => action(target), "YouTube", () => {
      setPlayback(null);
      setMessage("No se pudo controlar el video. Reintenta o ábrelo desde YouTube.");
    });
  }, []);
  const previousFocus = useRef<HTMLElement | null>(null);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const embedSlots = useRef(new Set<string>());
  const [, setSlotRevision] = useState(0);
  const registerSlot = useCallback((owner: string, node: HTMLDivElement | null, embed = false) => {
    if (node) slots.current.set(owner, node); else slots.current.delete(owner);
    if (node && embed) embedSlots.current.add(owner); else embedSlots.current.delete(owner);
    setSlotRevision(value => value + 1);
  }, []);
  const slot = session ? slots.current.get(session.owner) : undefined;
  const embeddable = Boolean(session?.embeddable);
  const canEmbed = Boolean(embeddable && slot && pathname === session?.path.split("?")[0]);
  const inline = canEmbed && !floating && !theater;
  const isFloating = Boolean(session && floating);
  const captureMode = usePlayerModeTransition(panel, !session ? "none" : isFloating ? "floating" : inline ? "inline" : "cinema");
  const stop = useCallback(() => {
    tryMediaOperation(() => player.current?.pauseVideo(), "YouTube");
    const iframe = panel.current?.querySelector("iframe");
    if (iframe) iframe.src = "about:blank";
    setSession(null); setPlayback(null); setMessage(null); setFloating(false); setTheater(false);
    pendingStart.current = null;
    releaseMedia(mediaOwner);
  }, [mediaOwner]);
  const close = useCallback(() => {
    stop();
    requestAnimationFrame(() => { if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); });
  }, [stop]);
  useEffect(() => () => releaseMedia(mediaOwner), [mediaOwner]);
  const play = useCallback((video: CatalogVideo, owner: string, seconds?: number, autoplay = true, tracks: readonly CatalogVideoTrack[] = []) => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(video.videoId)) return;
    if (autoplay) claimMedia(mediaOwner, stop);
    if (!dialog.current?.contains(document.activeElement)) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (session?.video.videoId === video.videoId && player.current) {
      controlPlayer(target => {
        if (seconds !== undefined) target.seekTo(seconds, true);
        if (autoplay) target.playVideo();
      });
    } else {
      tryMediaOperation(() => player.current?.pauseVideo(), "YouTube");
      pendingStart.current = seconds ?? (autoplay ? 0 : null);
      setPlayback(null);
    }
    if (session) captureMode();
    setSession({ video, owner, path: `${pathname}${search}`, autoplay, tracks, embeddable: Boolean(video.album) && embedSlots.current.has(owner) });
    setFloating(false); setTheater(false);
  }, [mediaOwner, stop, pathname, search, session, controlPlayer, captureMode]);
  const restore = useCallback(() => {
    if (session?.embeddable && `${pathname}${search}` !== session.path) void navigate(session.path);
    captureMode();
    setFloating(false); setTheater(false);
  }, [session, pathname, search, navigate, captureMode]);
  const cinema = useCallback(() => {
    captureMode();
    setTheater(true); setFloating(false);
    requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
  }, [captureMode]);
  const float = useCallback(() => {
    claimMedia(mediaOwner, stop);
    captureMode();
    setFloating(true);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>(".catalog-video-player__move")?.focus({ preventScroll: true }));
  }, [captureMode, mediaOwner, stop]);
  const originPath = session?.path;
  useEffect(() => {
    // A route change must not opt an inline or cinema session into floating.
    if (originPath && pathname !== originPath.split("?")[0] && !floating) stop();
  }, [pathname, originPath, floating, stop]);
  const playbackReady = playback !== null;
  useEffect(() => {
    if (!playbackReady || !player.current) return;
    controlPlayer(target => {
      target.setVolume?.(volume);
      if (muted) target.mute?.(); else target.unMute?.();
    });
  }, [playbackReady, session?.video.videoId, volume, muted, controlPlayer]);

  const changeVolume = (value: number) => {
    const next = Math.max(0, Math.min(100, value));
    if (next > 0) lastAudibleVolume.current = next;
    setVolume(next); setMuted(next === 0);
    controlPlayer(target => {
      target.setVolume?.(next);
      if (next === 0) target.mute?.(); else target.unMute?.();
    });
  };
  const toggleMute = () => {
    const nextMuted = !(muted || volume === 0);
    const restoredVolume = volume || lastAudibleVolume.current;
    setMuted(nextMuted);
    if (!nextMuted) setVolume(restoredVolume);
    controlPlayer(target => {
      if (nextMuted) target.mute?.();
      else { target.setVolume?.(restoredVolume); target.unMute?.(); }
    });
  };

  const playing = playback?.state === 1;
  const tracks = session?.tracks ?? [];
  let trackIndex = -1;
  tracks.forEach((track, index) => {
    if (track.video.videoId === session?.video.videoId && track.seconds <= (playback?.seconds ?? 0)
      && (trackIndex < 0 || track.seconds > tracks[trackIndex]!.seconds)) trackIndex = index;
  });
  const nextIndex = trackIndex >= 0 ? trackIndex + 1 : tracks.findIndex(track => track.video.videoId === session?.video.videoId);
  const skipTo = (index: number) => {
    const track = tracks[index];
    if (!session || !track) return;
    if (track.video.videoId === session.video.videoId && player.current) {
      controlPlayer(target => {
        target.seekTo(track.seconds, true); target.playVideo();
        setPlayback({ ...playback, seconds: track.seconds, state: 3 });
      });
    } else {
      pendingStart.current = track.seconds;
      setPlayback(null); setMessage(null);
    }
    setSession({ ...session, video: track.video, autoplay: true });
  };
  const togglePlayback = () => controlPlayer(target => { if (playing || playback?.state === 3) target.pauseVideo(); else target.playVideo(); });
  const seek = (seconds: number) => {
    if (!player.current || !playback) return;
    const bounded = Math.max(0, Math.min(playback.duration ?? Infinity, seconds));
    controlPlayer(target => {
      target.seekTo(bounded, true);
      setPlayback({ ...playback, seconds: bounded });
    });
  };
  const status = message ? "Revisar video" : !playback ? "Conectando…" : playing ? "Reproduciendo" : playback.state === 2 ? "En pausa" : playback.state === 0 ? "Finalizado" : playback.state === 3 ? "Cargando…" : "Listo para reproducir";
  const pauseIntent = playing || playback?.state === 3;
  const duration = playback?.duration ?? 0;
  const claimPlayback = useCallback(() => claimMedia(mediaOwner, stop), [mediaOwner, stop]);
  const value = useMemo(() => ({ session, floating: isFloating, inline, playback, play, float, cinema, restore, close, registerSlot }), [session, isFloating, inline, playback, play, float, cinema, restore, close, registerSlot]);
  // Escape o clic fuera: la ventana ampliada se reduce; el cine abierto desde
  // la ficha vuelve a incrustarse; el resto pasa a flotante.
  const dismiss = (floatingUI: ReturnType<typeof useFloatingVideo>) => {
    if (isFloating && floatingUI.expanded) floatingUI.resize(false, false);
    else if (!isFloating && canEmbed) restore();
    else float();
  };
  return <VideoContext.Provider value={value}>
    <ExternalMediaProvider>{children}
    {session ? <ErrorBoundary resetKey={`${session.video.videoId}:${retry}`} onError={() => { player.current = null; setPlayback(null); releaseMedia(mediaOwner); }}
      fallback={(_error, retryPlayer) => createPortal(<div className={inline ? undefined : "video-player-failure"}>
        <ErrorNotice label="el reproductor de YouTube" onRetry={retryPlayer} />
        <button type="button" className="btn btn--sm" onClick={close}>Cerrar video</button>
      </div>, inline && slot ? slot : document.body)}>
      <VideoLayer panel={panel} dialog={dialog} floating={isFloating} inline={inline} slot={slot}>
      {(floatingUI, compact, inlinePosition) => createPortal(<dialog ref={dialog} className={`video-layer${isFloating ? " video-layer--floating" : inline ? " video-layer--inline" : ""}`} aria-label={`Reproductor: ${session.video.title}`}
      onCancel={event => { event.preventDefault(); dismiss(floatingUI); }}
      onClick={event => { if (event.target === event.currentTarget && !isFloating && !inline) dismiss(floatingUI); }}>
      <aside ref={panel} tabIndex={-1} className={`catalog-video-player media-player ${isFloating ? "catalog-video-player--floating" : inline ? "catalog-video-player--inline" : "catalog-video-player--modal"}${compact ? " catalog-video-player--miniature" : ""}${floatingUI.dragging ? " catalog-video-player--dragging" : ""}`} style={isFloating ? floatingUI.style : inline ? inlinePosition : undefined} aria-label={`Reproductor de video: ${session.video.title}`}
        onClickCapture={floatingUI.onClickCapture}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!inline) dismiss(floatingUI); return; }
          if ((event.target as HTMLElement).closest("input, textarea, select, a, button, [contenteditable=true]")) return;
          if (event.key === " " || event.key.toLowerCase() === "k") { event.preventDefault(); togglePlayback(); }
          if (event.key.toLowerCase() === "m") { event.preventDefault(); toggleMute(); }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seek((playback?.seconds ?? 0) + (event.key === "ArrowLeft" ? -10 : 10)); }
        }}>
        <div className="catalog-video-player__toolbar media-player__toolbar">
          {isFloating ? <button type="button" className="catalog-video-player__move" {...floatingUI.gestures} aria-label="Mover reproductor" title="Arrastra o usa las flechas para mover"><DotsSix size={18} /></button> : null}
          <div className="media-player__identity"><strong>{session.video.title}</strong>{!compact ? <span>YouTube · {status}</span> : null}</div>
          <div className="media-player__actions">
            {isFloating && !compact ? <button type="button" className={floatingUI.pinned ? "is-active" : undefined} onClick={floatingUI.togglePinned} aria-pressed={floatingUI.pinned} aria-label={floatingUI.pinned ? "Desanclar reproductor" : "Anclar reproductor"} title="Mantener el tamaño pequeño al navegar"><PushPin size={18} weight={floatingUI.pinned ? "fill" : "regular"} /></button> : null}
            {inline ? <button type="button" onClick={cinema} aria-label="Modo cine" title="Modo cine"><MonitorPlay size={18} /></button> : null}
            {!compact && !inline ? <button type="button" onClick={isFloating ? () => floatingUI.resize(false) : float} aria-label={isFloating ? "Poner en miniatura" : "Video flotante"} title={isFloating ? "Miniatura flotante" : "Modo flotante"}><PictureInPicture size={18} /></button> : null}
            {!isFloating && !inline && canEmbed ? <button type="button" onClick={restore} aria-label="Salir del modo cine" title="Volver al reproductor del disco"><ArrowsInSimple size={18} /></button> : null}
            {isFloating && !compact ? <button type="button" onClick={restore} aria-label={embeddable ? "Volver al disco" : "Modo cine"} title={embeddable ? "Volver al disco" : "Modo cine"}>{embeddable ? <ArrowsInSimple size={18} /> : <ArrowsOutSimple size={18} />}</button> : null}
            <button type="button" className="catalog-video-player__close" onClick={close} aria-label="Cerrar video" title="Cerrar y detener reproducción"><X size={20} /></button>
          </div>
        </div>
        <div className="catalog-video-player__viewport">
          <PersistentEmbed video={session.video} autoplay={session.autoplay} player={player} pendingStart={pendingStart} onPlayback={setPlayback} onMessage={setMessage} retry={retry} onPlaying={claimPlayback} />
        </div>
        {compact ? <div className="media-player__mini-controls"><button type="button" onClick={togglePlayback} disabled={!playback} aria-label={pauseIntent ? "Pausar video" : "Reproducir video"}>{pauseIntent ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button><button type="button" className="media-player__expand" onClick={event => floatingUI.resize(true, event.detail !== 0)} aria-label="Mostrar reproductor pequeño"><ArrowsOutSimple size={16} /> Controles</button></div> : null}
        <div className="catalog-video-player__details" hidden={compact}>
          {message ? <div className="video-player__error" role="status"><p>{message}</p><button type="button" className="btn btn--sm" onClick={() => { pendingStart.current = playback?.seconds ?? 0; setRetry(value => value + 1); }}><ArrowClockwise size={16} /> Reintentar</button></div> : null}
          <header className="catalog-video-player__track">
            <strong title={tracks[trackIndex]?.title ?? session.video.title}>{tracks[trackIndex]?.title ?? session.video.title}</strong>
            <span role="status">{status}</span>
          </header>
          <div className="catalog-video-player__playback" role="group" aria-label="Controles de reproducción">
            <button type="button" className="catalog-video-player__skip" onClick={() => skipTo(trackIndex - 1)} disabled={!playback || trackIndex <= 0} aria-label="Pista anterior" title={tracks[trackIndex - 1]?.title ?? "Pista anterior"}><SkipBack size={26} /></button>
            <button type="button" className="catalog-video-player__skip" disabled={!playback} onClick={() => seek((playback?.seconds ?? 0) - 10)} aria-label="Retroceder 10 segundos" title="Retroceder 10 segundos"><TenSecondIcon /></button>
            <button type="button" className="catalog-video-player__play" onClick={togglePlayback} disabled={!playback} aria-label={pauseIntent ? "Pausar video" : "Reproducir video"} title={pauseIntent ? "Pausar" : "Reproducir"}>{pauseIntent ? <Pause size={30} weight="fill" /> : <Play size={30} weight="fill" />}</button>
            <button type="button" className="catalog-video-player__skip" disabled={!playback} onClick={() => seek((playback?.seconds ?? 0) + 10)} aria-label="Avanzar 10 segundos" title="Avanzar 10 segundos"><TenSecondIcon forward /></button>
            <button type="button" className="catalog-video-player__skip" onClick={() => skipTo(nextIndex)} disabled={!playback || nextIndex < 0 || nextIndex >= tracks.length} aria-label="Próxima pista" title={tracks[nextIndex]?.title ?? "Próxima pista"}><SkipForward size={26} /></button>
          </div>
          <div className="video-player__timeline" style={{ "--seek-fill": `${duration ? Math.min(100, Math.max(0, (playback?.seconds ?? 0) / duration * 100)) : 0}%` } as CSSProperties}>
            <span>{formatDuration(Math.floor(playback?.seconds ?? 0))}</span>
            <input type="range" min={0} max={duration || 1} step={1} value={Math.min(duration || 1, playback?.seconds ?? 0)} disabled={!duration} aria-label="Posición del video" aria-valuetext={`${formatDuration(Math.floor(playback?.seconds ?? 0))} de ${formatDuration(Math.floor(duration))}`} onChange={event => seek(Number(event.target.value))} />
            <span>{duration ? formatDuration(Math.floor(duration)) : "—:—"}</span>
            <PlayerVolume volume={volume} muted={muted} onMute={toggleMute} onChange={changeVolume} />
          </div>
          {!isFloating && tracks.length > 1 ? <details className="video-player__queue"><summary>Pistas y capítulos · {tracks.length}</summary><ol>{tracks.map((track, index) => <li key={`${track.video.videoId}:${track.seconds}:${index}`}><button type="button" aria-current={index === trackIndex ? "true" : undefined} onClick={() => skipTo(index)}><span>{track.title}</span><time>{formatDuration(track.seconds)}</time></button></li>)}</ol></details> : null}
          <div className="catalog-video-player__caption"><div>
            <a href={`https://www.youtube.com/watch?v=${session.video.videoId}`} target="_blank" rel="noreferrer">Abrir desde YouTube <ArrowSquareOut size={14} /></a>
            {session.video.album ? <Link to={`/discos/${session.video.album.id}`} onClick={float}>Ver el disco</Link> : <button type="button" className="video-player__origin" onClick={() => { float(); void navigate(session.path); }}>Ver origen</button>}
          </div></div>
        </div>
      </aside>
    </dialog>, document.body)}</VideoLayer></ErrorBoundary> : null}</ExternalMediaProvider>
  </VideoContext.Provider>;
}

/** Matching circular arrows; only the paths mirror, keeping the number readable. */
function TenSecondIcon({ forward = false }: { forward?: boolean }) {
  return <svg className="catalog-video-player__ten-seconds" viewBox="0 0 32 32" aria-hidden="true">
    <g transform={forward ? "translate(32 0) scale(-1 1)" : undefined}><path d="M8.22 9.22A11 11 0 1 1 5 17" /><path d="M8.22 3.72v5.5h5.5" /></g>
    <text x="16" y="20.5">10</text>
  </svg>;
}

function PlayerVolume({ volume, muted, onMute, onChange }: { volume: number; muted: boolean; onMute: () => void; onChange: (value: number) => void }) {
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const sliderId = useId();
  const [open, setOpen] = useState(false);
  const silent = muted || volume === 0;
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return <div ref={popup} className="catalog-video-player__volume" data-open={open || undefined}
    onPointerEnter={event => { if (event.pointerType === "mouse" || event.pointerType === "pen") setOpen(true); }}
    onPointerLeave={event => { if (event.pointerType !== "touch" && !event.currentTarget.querySelector(":focus-visible")) setOpen(false); }}
    onFocusCapture={event => { if (event.target.matches(":focus-visible")) setOpen(true); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      trigger.current?.focus(); setOpen(false);
    }}>
    <button ref={trigger} type="button" className="catalog-video-player__volume-trigger"
      onPointerDown={event => { if (event.pointerType === "touch") setOpen(true); }}
      onClick={onMute} aria-label={silent ? "Activar sonido" : "Silenciar"} aria-pressed={silent}
      aria-expanded={open} aria-controls={sliderId} title={silent ? "Activar sonido" : "Silenciar"}>
      {silent ? <SpeakerSlash size={21} /> : <SpeakerHigh size={21} />}
    </button>
    <div id={sliderId} className="catalog-video-player__volume-popup" hidden={!open}>
      <output aria-hidden="true">{muted ? 0 : volume}%</output>
      <input type="range" min={0} max={100} value={muted ? 0 : volume} aria-label="Volumen" aria-valuetext={`${muted ? 0 : volume} por ciento`} onChange={event => onChange(Number(event.target.value))} />
    </div>
  </div>;
}

/** Positioning and dialog effects belong to the player's boundary, above routes. */
function VideoLayer({ panel, dialog, floating, inline, slot, children }: {
  panel: React.RefObject<HTMLElement>; dialog: React.RefObject<HTMLDialogElement>;
  floating: boolean; inline: boolean; slot: HTMLDivElement | undefined;
  children: (ui: ReturnType<typeof useFloatingVideo>, compact: boolean, position: ReturnType<typeof useInlineMediaPosition>) => ReactNode;
}) {
  const ui = useFloatingVideo(panel, floating);
  const position = useInlineMediaPosition(panel, slot, inline);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (node.open) node.close();
    if (floating || inline) { showWithoutFocus(node); return () => node.close(); }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    try { node.showModal(); } catch (error) { document.body.style.overflow = overflow; throw error; }
    panel.current?.focus({ preventScroll: true });
    return () => { node.close(); document.body.style.overflow = overflow; };
  }, [floating, inline, dialog, panel]);
  return children(ui, floating && !ui.expanded, position);
}

/** Only album slots can host an embedded video. Other pages open in cinema mode. */
export function VideoSlot({ owner, embed = false }: { owner: string; embed?: boolean }) {
  const { session, floating, inline, restore, registerSlot } = useVideoPlayer();
  const ref = useCallback((node: HTMLDivElement | null) => registerSlot(owner, node, embed), [owner, embed, registerSlot]);
  return <div ref={ref} className={`catalog-video-slot${session?.owner === owner && inline ? " catalog-video-slot--embedded" : ""}`}>
    {session?.owner === owner && floating ? <button type="button" className="btn" onClick={restore}><ArrowsOutSimple size={18} /> {session.embeddable ? "Volver al reproductor" : "Ampliar video"}</button> : null}
  </div>;
}

function PersistentEmbed({ video, autoplay, player, pendingStart, onPlayback, onMessage, retry, onPlaying }: {
  video: CatalogVideo; autoplay: boolean; player: React.MutableRefObject<YoutubePlayer | null>;
  pendingStart: React.MutableRefObject<number | null>; onPlayback: (playback: YoutubePlayback | null) => void;
  onMessage: (message: string | null) => void; retry: number; onPlaying: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const title = useRef(video.title);
  title.current = video.title;
  const initialAutoplay = useRef(autoplay);
  initialAutoplay.current = autoplay;
  // Destroy the API while the iframe is still attached, including on close.
  useLayoutEffect(() => {
    const host = container.current;
    if (!host) return;
    let active = true;
    let instance: YoutubePlayer | undefined;
    let timer: number | undefined;
    let unavailable = false;
    onMessage(null); onPlayback(null);
    const iframe = document.createElement("iframe");
    const params = new URLSearchParams({ autoplay: initialAutoplay.current ? "1" : "0", enablejsapi: "1", origin: window.location.origin, playsinline: "1", rel: "0" });
    if (pendingStart.current !== null) params.set("start", String(Math.floor(pendingStart.current)));
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.videoId}?${params}`;
    iframe.title = `Reproducir ${title.current}`;
    iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    host.append(iframe);
    const failed = () => {
      if (!active) return;
      unavailable = true;
      window.clearInterval(timer);
      onPlayback(null);
      onMessage("No se pudo controlar el video. Reintenta o ábrelo desde YouTube.");
    };
    const report = (target: YoutubePlayer, state?: number) => {
      if (active && !unavailable) tryMediaOperation(() => onPlayback({ seconds: target.getCurrentTime(), state: state ?? target.getPlayerState(), duration: target.getDuration?.() ?? 0 }), "YouTube", failed);
    };
    void loadYoutubeIframeApi().then(api => {
      if (!active) return;
      instance = new api.Player(iframe, { events: {
        onReady: ({ target }) => {
          if (!active) return;
          player.current = target;
          if (pendingStart.current !== null) {
            if (!tryMediaOperation(() => { target.seekTo(pendingStart.current!, true); if (initialAutoplay.current) target.playVideo(); }, "YouTube", failed)) return;
            pendingStart.current = null;
          }
          report(target);
          if (!unavailable) timer = window.setInterval(() => report(target), 500);
        },
        onStateChange: ({ target, data }) => { if (!active) return; if (data === 1) { onPlaying(); unavailable = false; onMessage(null); } report(target, data); },
        onError: ({ data }) => {
          if (!active) return;
          unavailable = true; onPlayback(null);
          onMessage(data === 100 ? "Este video ya no está disponible o es privado." : data === 101 || data === 150 ? "El propietario permite verlo solo desde YouTube." : data === 153 ? "YouTube no pudo verificar el origen del reproductor. Intenta abrirlo desde YouTube." : "No se pudo reproducir el video. Reintenta o ábrelo desde YouTube.");
        },
        onAutoplayBlocked: () => { if (active) onMessage("Pulsa reproducir para comenzar. El navegador bloqueó el inicio automático."); },
      } });
    }).catch(() => { if (active) onMessage("No se pudo conectar con YouTube. Reintenta o usa los controles del video."); });
    return () => { active = false; window.clearInterval(timer); player.current = null; tryMediaOperation(() => instance?.destroy(), "YouTube"); host.replaceChildren(); };
  }, [video.videoId, player, pendingStart, onPlayback, onMessage, retry, onPlaying]);
  return <div className="catalog-video-player__screen" ref={container} />;
}
