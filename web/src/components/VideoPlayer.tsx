import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowSquareOut, ArrowsInSimple, PictureInPicture, X } from "@phosphor-icons/react";
import { loadYoutubeIframeApi, type YoutubePlayback, type YoutubePlayer } from "../lib/youtube";

export interface CatalogVideo { videoId: string; title: string; album?: { id: number; title: string } | null; }
interface VideoSession { video: CatalogVideo; owner: string; path: string; autoplay: boolean; }
interface VideoContextValue {
  session: VideoSession | null;
  floating: boolean;
  playback: YoutubePlayback | null;
  play: (video: CatalogVideo, owner: string, seconds?: number, autoplay?: boolean) => void;
  registerSlot: (owner: string, node: HTMLDivElement | null) => void;
  float: () => void;
  restore: () => void;
  close: () => void;
}
const VideoContext = createContext<VideoContextValue | null>(null);
export function useVideoPlayer() {
  const value = useContext(VideoContext);
  if (!value) throw new Error("VideoProvider no está disponible.");
  return value;
}

/** El iframe vive fuera de las rutas. Cambiar su posición nunca lo desmonta. */
export function VideoProvider({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<VideoSession | null>(null);
  const [floating, setFloating] = useState(false);
  const [playback, setPlayback] = useState<YoutubePlayback | null>(null);
  const [position, setPosition] = useState<CSSProperties | undefined>();
  const panel = useRef<HTMLElement>(null);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const pendingRestore = useRef<string | null>(null);
  const [slotVersion, setSlotVersion] = useState(0);
  const player = useRef<YoutubePlayer | null>(null);
  const pendingStart = useRef<number | null>(null);
  const registerSlot = useCallback((owner: string, node: HTMLDivElement | null) => {
    if (node) {
      slots.current.set(owner, node);
      if (pendingRestore.current === owner) { pendingRestore.current = null; requestAnimationFrame(() => node.scrollIntoView({ block: "center", behavior: "instant" })); }
    } else slots.current.delete(owner);
    setSlotVersion(value => value + 1);
  }, []);
  const close = useCallback(() => { setSession(null); setPlayback(null); pendingStart.current = null; }, []);
  const play = useCallback((video: CatalogVideo, owner: string, seconds?: number, autoplay = true) => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(video.videoId)) return;
    if (session?.video.videoId === video.videoId && player.current) {
      if (seconds !== undefined) player.current.seekTo(seconds, true);
      if (autoplay) player.current.playVideo();
    } else pendingStart.current = seconds ?? (autoplay ? 0 : null);
    setSession({ video, owner, path: `${pathname}${search}`, autoplay });
    setFloating(false);
  }, [pathname, search, session?.video.videoId]);
  const restore = useCallback(() => {
    if (!session) return;
    if (`${pathname}${search}` !== session.path) { pendingRestore.current = session.owner; navigate(session.path); }
    setFloating(false);
    window.setTimeout(() => slots.current.get(session.owner)?.scrollIntoView({ block: "center", behavior: "instant" }), 100);
  }, [navigate, pathname, search, session]);
  const float = useCallback(() => setFloating(true), []);
  const isFloating = floating || Boolean(session && (pathname !== session.path.split("?")[0] || !slots.current.has(session.owner)));

  useLayoutEffect(() => {
    if (!session || isFloating) return;
    const slot = slots.current.get(session.owner);
    if (!slot) return;
    let frame = 0;
    const measure = () => {
      const height = panel.current?.getBoundingClientRect().height;
      if (height) { slot.style.aspectRatio = "auto"; slot.style.paddingBottom = "0px"; slot.style.height = `${height}px`; }
      const rect = slot.getBoundingClientRect();
      setPosition({ top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(slot);
    resize.observe(document.body);
    if (panel.current) resize.observe(panel.current);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { resize.disconnect(); cancelAnimationFrame(frame); slot.style.removeProperty("height"); slot.style.removeProperty("aspect-ratio"); slot.style.removeProperty("padding-bottom"); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [session, isFloating, slotVersion]);

  const value = useMemo(() => ({ session, floating: isFloating, playback, play, registerSlot, float, restore, close }), [session, isFloating, playback, play, registerSlot, float, restore, close]);
  return <VideoContext.Provider value={value}>
    {children}
    {session ? <aside ref={panel} className={`catalog-video-player${isFloating ? " catalog-video-player--floating" : ""}`} style={isFloating ? undefined : position} aria-label="Reproductor de video">
      <div className="catalog-video-player__toolbar">
        <span>{isFloating ? "Video flotante" : "Reproduciendo en el catálogo"}</span>
        <div>
          <button type="button" onClick={isFloating ? restore : float} aria-label={isFloating ? "Volver al video en la página" : "Video flotante"} title={isFloating ? "Volver a la página del video" : "Seguir navegando con el video flotante"}>
            {isFloating ? <ArrowsInSimple size={19} /> : <PictureInPicture size={19} />}<span>{isFloating ? "Volver" : "Video flotante"}</span>
          </button>
          <button type="button" onClick={close} aria-label="Cerrar video"><X size={20} /></button>
        </div>
      </div>
      <PersistentEmbed video={session.video} autoplay={session.autoplay} player={player} pendingStart={pendingStart} onPlayback={setPlayback} />
      <div className="catalog-video-player__caption">
        <strong>{session.video.title}</strong>
        <div><a href={`https://www.youtube.com/watch?v=${session.video.videoId}`} target="_blank" rel="noreferrer">Abrir desde YouTube <ArrowSquareOut size={14} /></a>
          {session.video.album ? <Link to={`/discos/${session.video.album.id}`}>Ver el disco</Link> : null}</div>
      </div>
    </aside> : null}
  </VideoContext.Provider>;
}

export function VideoSlot({ owner }: { owner: string }) {
  const { session, floating, registerSlot, restore } = useVideoPlayer();
  const ref = useCallback((node: HTMLDivElement | null) => registerSlot(owner, node), [owner, registerSlot]);
  return <div ref={ref} className={`catalog-video-slot${session?.owner === owner && !floating ? " catalog-video-slot--active" : ""}`}>
    {session?.owner === owner && floating ? <button type="button" className="btn" onClick={restore}><ArrowsInSimple size={18} /> Volver a mostrar el video aquí</button> : null}
  </div>;
}

function PersistentEmbed({ video, autoplay, player, pendingStart, onPlayback }: {
  video: CatalogVideo; autoplay: boolean; player: React.MutableRefObject<YoutubePlayer | null>;
  pendingStart: React.MutableRefObject<number | null>; onPlayback: (playback: YoutubePlayback | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const title = useRef(video.title);
  title.current = video.title;
  const initialAutoplay = useRef(autoplay);
  initialAutoplay.current = autoplay;
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let active = true;
    let instance: YoutubePlayer | undefined;
    let timer: number | undefined;
    let unavailable = false;
    setMessage(null);
    onPlayback(null);
    const iframe = document.createElement("iframe");
    const params = new URLSearchParams({ autoplay: initialAutoplay.current ? "1" : "0", enablejsapi: "1", origin: window.location.origin, playsinline: "1", rel: "0" });
    if (pendingStart.current !== null) params.set("start", String(Math.floor(pendingStart.current)));
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.videoId}?${params}`;
    iframe.title = `Reproducir ${title.current}`;
    iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    host.append(iframe);
    const report = (target: YoutubePlayer, state = target.getPlayerState()) => {
      if (active && !unavailable) onPlayback({ seconds: target.getCurrentTime(), state });
    };
    void loadYoutubeIframeApi().then(api => {
      if (!active) return;
      instance = new api.Player(iframe, { events: {
        onReady: ({ target }) => {
          if (!active) return;
          player.current = target;
          if (pendingStart.current !== null) { target.seekTo(pendingStart.current, true); target.playVideo(); pendingStart.current = null; }
          timer = window.setInterval(() => report(target), 500);
        },
        onStateChange: ({ target, data }) => { if (!active) return; if (data === 1) { unavailable = false; setMessage(null); } report(target, data); },
        onError: () => { if (active) { unavailable = true; onPlayback(null); setMessage("Este video no permite reproducción aquí. Ábrelo desde YouTube."); } },
        onAutoplayBlocked: () => { if (active) setMessage("Pulsa reproducir en el video para comenzar."); },
      } });
    }).catch(() => { if (active) setMessage("El control de pistas no se pudo conectar. Puedes usar los controles del video."); });
    return () => { active = false; window.clearInterval(timer); player.current = null; instance?.destroy(); host.replaceChildren(); };
  }, [video.videoId, player, pendingStart, onPlayback]);
  return <><div className="catalog-video-player__screen" ref={container} />{message ? <p className="catalog-video-player__message" role="status">{message}</p> : null}</>;
}
