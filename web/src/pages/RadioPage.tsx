// CRV · /radio — reproductor de la emisión compartida (Fase 3).
//
// El servidor manda la pieza y el segundo; el cliente solo sigue ese reloj.
// Dos reproductores de YouTube permiten preparar la siguiente y cruzar en el
// relevo, como el cliente de Herra. La emisión se calcula con el motor del
// catálogo y se compara en sombra: esta página no sustituye a la radio pública
// hasta el go-live.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Broadcast, Pause, Play, SpeakerHigh, SpeakerSlash, UsersThree, Waveform,
} from "@phosphor-icons/react";
import { radioApi, radioSessionId, type RadioSnapshot } from "../lib/radio";
import { keyOf, loadYouTubeApi, mmss, storedVolume, VOLUME_KEY, type YTPlayerLike } from "../lib/youtube-radio";
import "../styles/radio.css";

function ramp(player: YTPlayerLike | null, to: number, durationMs: number): void {
  if (!player) return;
  const from = player.getVolume();
  const started = Date.now();
  const timer = window.setInterval(() => {
    const progress = Math.min(1, (Date.now() - started) / Math.max(1, durationMs));
    player.setVolume(Math.round(from + (to - from) * progress));
    if (progress >= 1) window.clearInterval(timer);
  }, 80);
}

export function RadioPage() {
  const [snapshot, setSnapshot] = useState<RadioSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(storedVolume);
  const [listeners, setListeners] = useState(0);
  const [starting, setStarting] = useState(false);
  const [playbackState, setPlaybackState] = useState<number | null>(null);
  const [playerError, setPlayerError] = useState<number | null>(null);

  const snapshotRef = useRef<RadioSnapshot | null>(null);
  const soundRef = useRef(false);
  const pausedRef = useRef(false);
  const volumeRef = useRef(volume);
  const soundWantedRef = useRef(false);
  const activeRef = useRef(0);
  const playersRef = useRef<[YTPlayerLike | null, YTPlayerLike | null]>([null, null]);
  const keysRef = useRef<[string | null, string | null]>([null, null]);
  const deck0 = useRef<HTMLDivElement>(null);
  const deck1 = useRef<HTMLDivElement>(null);
  const handoffRef = useRef<number | null>(null);
  const lastHandoffRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await radioApi.now();
      snapshotRef.current = next;
      setSnapshot(next);
      setListeners(next.listeners);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "La radio no está disponible.");
    }
  }, []);

  useEffect(() => {
    void loadYouTubeApi().then(() => setApiReady(true)).catch(() => setError("No se pudo cargar el reproductor de YouTube."));
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Crear los dos reproductores una sola vez, con la pieza actual y la siguiente.
  const initialSnapshotRef = useRef<RadioSnapshot | null>(null);
  if (snapshot) initialSnapshotRef.current = snapshot;
  useEffect(() => {
    const initial = initialSnapshotRef.current;
    if (!apiReady || !initial || playersRef.current[0] || !deck0.current || !deck1.current || !window.YT) return;
    const start = initial.current.startSeconds + initial.offsetSeconds;
    const first = new window.YT.Player(deck0.current, {
      videoId: initial.current.videoId,
      playerVars: {
        autoplay: 1, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0,
        mute: 1, start: Math.floor(start), origin: window.location.origin,
      },
      events: {
        onReady: (event: { target: YTPlayerLike }) => {
          event.target.mute();
          if (soundWantedRef.current) {
            event.target.unMute();
            event.target.setVolume(volumeRef.current || 70);
            setSound(true);
            soundRef.current = true;
          } else {
            event.target.setVolume(0);
          }
          if (!pausedRef.current) event.target.playVideo();
        },
        onStateChange: (event: { data: number }) => setPlaybackState(event.data),
        onError: (event: { data: number }) => setPlayerError(event.data),
      },
    });
    const second = new window.YT.Player(deck1.current, {
      videoId: initial.next.videoId,
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, mute: 1, origin: window.location.origin },
      events: {
        onReady: (event: { target: YTPlayerLike }) => event.target.cueVideoById({
          videoId: initial.next.videoId, startSeconds: initial.next.startSeconds,
        }),
        onStateChange: (event: { data: number }) => {
          if (event.data === 1) setPlaybackState(1);
        },
        onError: (event: { data: number }) => setPlayerError(event.data),
      },
    });
    playersRef.current = [first, second];
    keysRef.current = [keyOf(initial.current), keyOf(initial.next)];
  }, [apiReady, snapshot]);

  // Destruir solo al desmontar: los cambios de pieza no recrean el iframe.
  useEffect(() => () => {
    playersRef.current.forEach((player) => player?.destroy());
    playersRef.current = [null, null];
    keysRef.current = [null, null];
  }, []);

  // Mantener la pieza activa y la siguiente preparada cuando llega un snapshot.
  useEffect(() => {
    if (!snapshot || !playersRef.current[0] || !playersRef.current[1]) return;
    const active = activeRef.current;
    const activeKey = keysRef.current[active];
    const currentKey = keyOf(snapshot.current);
    if (activeKey !== currentKey) {
      const other = 1 - active;
      const nextPlayer = playersRef.current[other];
      if (keysRef.current[other] !== currentKey) {
        nextPlayer?.cueVideoById({ videoId: snapshot.current.videoId, startSeconds: snapshot.current.startSeconds + snapshot.offsetSeconds });
        keysRef.current[other] = currentKey;
      }
      playersRef.current[active]?.pauseVideo();
      activeRef.current = other;
      nextPlayer?.playVideo();
      if (soundRef.current) { nextPlayer?.unMute(); nextPlayer?.setVolume(volumeRef.current); }
    }
    const standby = 1 - activeRef.current;
    const nextKey = keyOf(snapshot.next);
    if (keysRef.current[standby] !== nextKey) {
      keysRef.current[standby] = nextKey;
      playersRef.current[standby]?.cueVideoById({ videoId: snapshot.next.videoId, startSeconds: snapshot.next.startSeconds });
    }
  }, [snapshot]);

  // Relevo al final del tramo: entra la siguiente, se cruza y se corrige el reloj.
  useEffect(() => {
    if (!snapshot) return;
    if (handoffRef.current) window.clearTimeout(handoffRef.current);
    const at = Date.parse(snapshot.endsAt);
    const delay = Math.max(0, at - Date.now() + 40);
    handoffRef.current = window.setTimeout(() => {
      const standby = 1 - activeRef.current;
      const incoming = playersRef.current[standby];
      const outgoing = playersRef.current[activeRef.current];
      if (!incoming) return;
      incoming.playVideo();
      if (soundRef.current) {
        incoming.unMute();
        incoming.setVolume(0);
        ramp(incoming, volumeRef.current, Math.max(400, snapshot.crossfadeSeconds * 1000));
      }
      if (snapshot.crossfadeSeconds > 0 && !snapshot.sweeperSlot) {
        ramp(outgoing, 0, snapshot.crossfadeSeconds * 1000);
        window.setTimeout(() => outgoing?.pauseVideo(), snapshot.crossfadeSeconds * 1000 + 120);
      } else {
        outgoing?.pauseVideo();
      }
      activeRef.current = standby;
      lastHandoffRef.current = Date.now();
      void refresh();
    }, delay);
    return () => { if (handoffRef.current) window.clearTimeout(handoffRef.current); };
  }, [snapshot, refresh]);

  // Identificador: el audio propio suena en su ventana, nunca sustituye a una canción.
  const sweeperStartedAt = snapshot?.sweeperStartedAt;
  const sweeperSrc = snapshot?.sweeper?.src;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!sweeperStartedAt || !sound) { audio.pause(); return; }
    const started = Date.parse(sweeperStartedAt);
    const offset = Math.max(0, (Date.now() - started) / 1000);
    const src = `${import.meta.env.BASE_URL}${sweeperSrc ?? "radio/sweeper-v2.wav"}`;
    if (audio.src !== new URL(src, window.location.href).href) audio.src = src;
    audio.currentTime = offset;
    void audio.play().catch(() => {});
  }, [sweeperStartedAt, sweeperSrc, sound]);

  // Corregir deriva contra el reloj del servidor.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = snapshotRef.current;
      if (!current || pausedRef.current || current.phase === "sweeper") return;
      if (Date.now() - lastHandoffRef.current < 3000) return;
      const player = playersRef.current[activeRef.current];
      if (!player) return;
      const expected = current.current.startSeconds + (Date.now() - Date.parse(current.startsAt)) / 1000;
      if (Math.abs(player.getCurrentTime() - expected) > 3) player.seekTo(expected, true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  // Presencia: el latido solo cuenta cuando hay sonido y no está en pausa.
  useEffect(() => {
    const id = radioSessionId();
    const beat = () => {
      void radioApi.listener(id, soundRef.current && !pausedRef.current)
        .then((result) => setListeners(result.listeners)).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, 30_000);
    return () => {
      window.clearInterval(timer);
      void radioApi.listener(id, false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!sound) return;
    const id = radioSessionId();
    void radioApi.listener(id, !paused).then((result) => setListeners(result.listeners)).catch(() => {});
  }, [sound, paused]);

  function enableSound(): void {
    soundWantedRef.current = true;
    const player = playersRef.current[activeRef.current];
    if (!player) return;
    setStarting(true);
    player.unMute();
    player.setVolume(volumeRef.current || 70);
    player.playVideo();
    setSound(true);
    soundRef.current = true;
    setMuted(false);
    window.setTimeout(() => setStarting(false), 700);
  }

  function toggleMute(): void {
    const player = playersRef.current[activeRef.current];
    if (!player) return;
    if (muted) {
      player.unMute();
      player.setVolume(volumeRef.current || 70);
      setMuted(false);
    } else {
      player.mute();
      setMuted(true);
    }
  }

  function togglePause(): void {
    const player = playersRef.current[activeRef.current];
    if (!player) return;
    if (paused) {
      const current = snapshotRef.current;
      if (current) player.seekTo(current.current.startSeconds + (Date.now() - Date.parse(current.startsAt)) / 1000, true);
      player.playVideo();
      setPaused(false);
    } else {
      player.pauseVideo();
      setPaused(true);
    }
  }

  function changeVolume(value: number): void {
    setVolume(value);
    volumeRef.current = value;
    try { window.localStorage.setItem(VOLUME_KEY, String(value)); } catch { /* sin almacenamiento */ }
    const player = playersRef.current[activeRef.current];
    if (!player) return;
    if (value === 0) { player.mute(); setMuted(true); return; }
    player.unMute();
    player.setVolume(value);
    setMuted(false);
    setSound(true);
    soundRef.current = true;
  }

  const current = snapshot?.current;
  const startedAt = snapshot ? Date.parse(snapshot.startsAt) : 0;
  const endsAt = snapshot ? Date.parse(snapshot.endsAt) : 0;
  const elapsed = snapshot ? Math.max(0, (now - startedAt) / 1000) : 0;
  const total = Math.max(1, (endsAt - startedAt) / 1000);
  const progress = Math.min(100, (elapsed / total) * 100);
  const stateLabel = !sound ? "Toca para activar el sonido" : paused ? "En pausa" : "En vivo";

  return (
    <div className="radio-page">
      <section className="radio-hero">
        <span className="badge badge--outline"><Broadcast size={14} aria-hidden="true" /> Radio en sombra</span>
        <h1>La radio del archivo<span className="radio-dot">.</span></h1>
        <p>La misma emisión que suena en la portada, calculada por el catálogo. Todavía no se publica desde aquí: esta pantalla sirve para verificar el motor y el reproductor.</p>
      </section>

      {error && !snapshot ? <div className="state-block">{error}</div> : null}

      {snapshot && current ? (
        <section className="radio-card" data-state={!sound ? "sound" : paused ? "paused" : "live"} data-player-state={playbackState ?? "none"} data-player-error={playerError ?? "none"}>
          <div className="radio-cover" aria-hidden="true">
            <span className="radio-cover__wave"><Waveform size={40} weight="bold" /></span>
            <strong>{current.album.slice(0, 2).toUpperCase()}</strong>
            <small>{snapshot.station}</small>
          </div>
          <div className="radio-main">
            <div className="radio-status">
              <span className={`radio-pulse${sound && !paused ? " radio-pulse--on" : ""}`} />
              <span>{stateLabel}</span>
              <span className="radio-listeners"><UsersThree size={14} aria-hidden="true" /> {listeners}</span>
            </div>
            <h2 className="radio-title">{current.title}</h2>
            <p className="radio-meta">
              {[current.artist, current.album, current.year].filter(Boolean).join(" · ")}
            </p>
            <div className="radio-timeline">
              <i style={{ width: `${progress}%` }} />
            </div>
            <div className="radio-times"><span>{mmss(elapsed)}</span><span>{mmss(total)}</span></div>
            {snapshot.phase === "sweeper" ? <p className="radio-phase">Identificador de la estación</p> : null}
            <div className="radio-controls">
              {!sound ? (
                <button type="button" className="btn btn--primary radio-sound" onClick={enableSound} disabled={starting}>
                  <Play size={16} weight="fill" aria-hidden="true" /> {starting ? "Entrando…" : "Entrar al aire"}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn--icon" onClick={togglePause} aria-label={paused ? "Reanudar" : "Pausar"}>
                    {paused ? <Play size={18} weight="fill" /> : <Pause size={18} weight="fill" />}
                  </button>
                  <button type="button" className="btn btn--icon" onClick={toggleMute} aria-label={muted ? "Activar sonido" : "Silenciar"}>
                    {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
                  </button>
                  <label className="radio-volume">
                    <span className="visually-hidden">Volumen</span>
                    <input type="range" min={0} max={100} value={volume} onChange={(event) => changeVolume(Number(event.target.value))} />
                  </label>
                </>
              )}
              <span className="radio-badge-sweeper">{snapshot.sweeperSlot ? "Cuña al cierre" : `Cruce ${snapshot.crossfadeSeconds}s`}</span>
            </div>
            <p className="radio-next"><span>A continuación</span> {snapshot.next.title}{snapshot.next.artist ? ` · ${snapshot.next.artist}` : ""}</p>
            {playerError !== null ? <p className="radio-error">YouTube no permite reproducir esta pieza en este navegador ({playerError}).</p> : null}
          </div>
          <div className="radio-decks" aria-hidden="true">
            <div id="crv-radio-deck-0" ref={deck0} />
            <div id="crv-radio-deck-1" ref={deck1} />
          </div>
          <audio ref={audioRef} preload="none" />
        </section>
      ) : null}

      {!snapshot && !error ? <div className="state-block">Buscando la emisión…</div> : null}

      <section className="radio-footer">
        <p>Motor propio del catálogo: {snapshot ? `${snapshot.total} piezas en el ciclo, posición ${snapshot.position}` : "cargando"}.</p>
        <Link to="/roadmap" className="radio-link">Ver el roadmap <ArrowRight size={15} aria-hidden="true" /></Link>
      </section>
    </div>
  );
}
