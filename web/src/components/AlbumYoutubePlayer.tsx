import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { loadYoutubeIframeApi, type YoutubePlayback, type YoutubePlayer } from "../lib/youtube";

export interface AlbumYoutubePlayerHandle {
  playFrom: (seconds: number) => void;
}

interface AlbumYoutubePlayerProps {
  videoId: string;
  title: string;
  onPlaybackChange: (playback: YoutubePlayback | null) => void;
}

export const AlbumYoutubePlayer = forwardRef<AlbumYoutubePlayerHandle, AlbumYoutubePlayerProps>(
  function AlbumYoutubePlayer({ videoId, title, onPlaybackChange }, ref) {
    const container = useRef<HTMLDivElement>(null);
    const player = useRef<YoutubePlayer | null>(null);
    const pendingStart = useRef<number | null>(null);
    const lastPlayback = useRef<YoutubePlayback | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      playFrom(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return;
        lastPlayback.current = null;
        onPlaybackChange({ seconds, state: 3 });
        if (player.current) {
          player.current.seekTo(seconds, true);
          player.current.playVideo();
        } else {
          // El usuario puede elegir una pista antes de que YouTube esté listo.
          pendingStart.current = seconds;
        }
        container.current?.scrollIntoView({ block: "center", behavior: "instant" });
      },
    }), [onPlaybackChange]);

    useEffect(() => {
      const host = container.current;
      if (!host) return;
      let active = true;
      let instance: YoutubePlayer | undefined;
      let progressTimer: number | undefined;
      let unavailable = false;
      const reportPlayback = (target: YoutubePlayer, state = target.getPlayerState()) => {
        if (!active || unavailable) return;
        const seconds = Math.floor(target.getCurrentTime());
        if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(state)) return;
        if (lastPlayback.current?.seconds === seconds && lastPlayback.current.state === state) return;
        lastPlayback.current = { seconds, state };
        onPlaybackChange(lastPlayback.current);
      };
      const iframe = document.createElement("iframe");
      const params = new URLSearchParams({ enablejsapi: "1", origin: window.location.origin, playsinline: "1", rel: "0" });
      iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
      iframe.title = `Reproductor de YouTube: ${title}`;
      iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
      iframe.allowFullscreen = true;
      // YouTube requiere el Referer incluso si el gateway usa no-referrer.
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      host.append(iframe);

      void loadYoutubeIframeApi().then((api) => {
        if (!active) return;
        instance = new api.Player(iframe, {
          events: {
            onReady: ({ target }) => {
              if (!active) return;
              player.current = target;
              if (pendingStart.current !== null) {
                target.seekTo(pendingStart.current, true);
                target.playVideo();
                pendingStart.current = null;
              } else {
                reportPlayback(target);
              }
              progressTimer = window.setInterval(() => reportPlayback(target), 500);
            },
            onError: () => {
              if (!active) return;
              unavailable = true;
              lastPlayback.current = null;
              onPlaybackChange(null);
              setMessage("Este video no se puede reproducir aquí. Usa el enlace «Abrir en YouTube».");
            },
            onAutoplayBlocked: () => {
              if (!active) return;
              if (player.current) reportPlayback(player.current);
              setMessage("Pulsa el botón de reproducción del video para continuar desde la pista seleccionada.");
            },
            onStateChange: ({ target, data }) => {
              if (!active) return;
              if (data === 1) { unavailable = false; setMessage(null); }
              reportPlayback(target, data);
            },
          },
        });
      }).catch(() => {
        if (!active) return;
        lastPlayback.current = null;
        onPlaybackChange(null);
        setMessage("No se pudo conectar el control de pistas. Puedes reproducir el video directamente o abrirlo en YouTube.");
      });

      return () => {
        active = false;
        lastPlayback.current = null;
        window.clearInterval(progressTimer);
        onPlaybackChange(null);
        player.current = null;
        instance?.destroy();
        // YouTube es el único dueño de los hijos de este contenedor.
        host.replaceChildren();
      };
    }, [videoId, title, onPlaybackChange]);

    return (
      <>
        <div className="album-youtube-player" ref={container} />
        {message ? <p className="album-youtube-message" role="status">{message}</p> : null}
      </>
    );
  },
);
