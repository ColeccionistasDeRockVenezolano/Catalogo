// CRV · Tarjeta de radio del hero del roadmap.
//
// Versión compacta del reproductor de /radio: una sola toma, sonido bajo
// gesto, volumen y deriva. El reproductor completo con dos decks y cruce vive
// en /radio; aquí se reproduce el mismo snapshot del servidor.
import { useEffect, useRef, useState } from "react";
import { ArrowsIn, ArrowsOut, Pause, Play, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { radioApi, radioSessionId, type RadioSnapshot } from "../lib/radio";
import { loadYouTubeApi, mmss, storedVolume, VOLUME_KEY, type YTPlayerLike } from "../lib/youtube-radio";

export interface RadioMiniCopy {
  live: string; nowPlaying: string; upNext: string; join: string; press: string;
  paused: string; onAir: string; listening: (count: number) => string;
  cinema: string; exitCinema: string; unavailable: string; loading: string;
}

export function RadioMiniPlayer({ copy }: { copy: RadioMiniCopy }) {
  const [snapshot, setSnapshot] = useState<RadioSnapshot | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(() => storedVolume() === 0);
  const [volume, setVolume] = useState(storedVolume);
  const [listeners, setListeners] = useState(0);
  const [cinema, setCinema] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<number | null>(null);

  const snapshotRef = useRef<RadioSnapshot | null>(null);
  const soundRef = useRef(false);
  const pausedRef = useRef(false);
  const volumeRef = useRef(volume);
  const soundWantedRef = useRef(false);
  const playerRef = useRef<YTPlayerLike | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const handoffRef = useRef<number | null>(null);

  const current = snapshot?.current;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const value = await radioApi.now();
        if (!alive) return;
        setSnapshot(value);
        snapshotRef.current = value;
        setListeners(value.listeners);
        setError(null);
      } catch {
        if (alive) setError(copy.unavailable);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [copy.unavailable]);

  useEffect(() => {
    void loadYouTubeApi().then(() => setApiReady(true)).catch(() => setError(copy.unavailable));
  }, [copy.unavailable]);

  useEffect(() => {
    if (!apiReady || !snapshot || !targetRef.current || playerRef.current || !window.YT) return;
    const start = snapshot.current.startSeconds + snapshot.offsetSeconds;
    playerRef.current = new window.YT.Player(targetRef.current, {
      videoId: snapshot.current.videoId,
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
        onStateChange: (event: { data: number }) => {
          if (event.data === 0) void radioApi.now().then((value) => { setSnapshot(value); snapshotRef.current = value; }).catch(() => {});
        },
        onError: (event: { data: number }) => setPlayerError(event.data),
      },
    });
    loadedKeyRef.current = `${snapshot.current.videoId}:${snapshot.current.startSeconds}`;
  }, [apiReady, snapshot]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !snapshot || !current) return;
    const key = `${current.videoId}:${current.startSeconds}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    setPlayerError(null);
    player.loadVideoById({ videoId: current.videoId, startSeconds: current.startSeconds + snapshot.offsetSeconds });
    if (soundRef.current) { player.unMute(); player.setVolume(volumeRef.current || 70); }
    if (!pausedRef.current) player.playVideo();
  }, [snapshot, current]);

  useEffect(() => {
    if (!snapshot) return;
    const at = Date.parse(snapshot.endsAt);
    const delay = Math.max(0, at - Date.now()) + 400;
    if (handoffRef.current) window.clearTimeout(handoffRef.current);
    handoffRef.current = window.setTimeout(() => {
      void radioApi.now().then((value) => { setSnapshot(value); snapshotRef.current = value; }).catch(() => {});
    }, delay);
    return () => { if (handoffRef.current) window.clearTimeout(handoffRef.current); };
  }, [snapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      const currentSnapshot = snapshotRef.current;
      const player = playerRef.current;
      if (!currentSnapshot || !player || pausedRef.current) return;
      const expected = currentSnapshot.current.startSeconds + (Date.now() - Date.parse(currentSnapshot.startsAt)) / 1000;
      if (Math.abs(player.getCurrentTime() - expected) > 3) player.seekTo(expected, true);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const beat = () => {
      void radioApi.listener(radioSessionId(), soundRef.current && !pausedRef.current)
        .then((value) => setListeners(value.listeners)).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, 30_000);
    return () => clearInterval(timer);
  }, []);

  function enableSound(): void {
    soundWantedRef.current = true;
    const player = playerRef.current;
    if (!player) return;
    player.unMute();
    player.setVolume(volumeRef.current || 70);
    player.playVideo();
    setSound(true);
    setMuted(false);
    soundRef.current = true;
  }

  function toggleMute(): void {
    const player = playerRef.current;
    if (!player) return;
    if (muted) {
      player.unMute();
      player.setVolume(volume || 70);
      setMuted(false);
    } else {
      player.mute();
      setMuted(true);
    }
  }

  function togglePause(): void {
    const player = playerRef.current;
    if (!player) return;
    if (paused) {
      const value = snapshotRef.current;
      if (value) player.seekTo(value.current.startSeconds + (Date.now() - Date.parse(value.startsAt)) / 1000, true);
      player.playVideo();
      setPaused(false);
    } else {
      player.pauseVideo();
      setPaused(true);
    }
  }

  const total = snapshot ? Math.max(1, (Date.parse(snapshot.endsAt) - Date.parse(snapshot.startsAt)) / 1000) : 1;
  const elapsed = snapshot ? Math.max(0, (now - Date.parse(snapshot.startsAt)) / 1000) : 0;
  const progress = Math.max(0, Math.min(1, elapsed / total));
  const state = !sound ? "sound" : paused ? "paused" : "live";

  return (
    <aside className={`landing-radio${cinema ? " is-cinema" : ""}`} data-radio-state={state} aria-label="Radio CRV">
      <header className="landing-radio__head">
        <span className="landing-radio__live"><i aria-hidden="true" />Radio CRV</span>
        <div className="landing-radio__actions">
          <span className="landing-radio__listeners">{listeners > 0 ? copy.listening(listeners) : copy.live}</span>
          <button type="button" className="landing-radio__cinema" aria-pressed={cinema} onClick={() => setCinema((value) => !value)}>
            {cinema ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
            <span>{cinema ? copy.exitCinema : copy.cinema}</span>
          </button>
        </div>
      </header>
      <div className="landing-radio__screen">
        <div ref={targetRef} className="landing-radio__player" />
        {!snapshot ? <div className="landing-radio__empty">{copy.loading}</div> : null}
        {playerError !== null ? <div className="landing-radio__empty">{copy.unavailable} ({playerError})</div> : null}
      </div>
      {snapshot ? (
        <div className="landing-radio__content">
          <p className="landing-radio__label">{copy.nowPlaying}</p>
          <h2>{current?.title}</h2>
          <p className="landing-radio__artist">{[current?.artist, current?.album, current?.year].filter(Boolean).join(" · ")}</p>
          <div className="landing-radio__timeline" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>
          <div className="landing-radio__times"><span>{mmss(elapsed)}</span><span>{mmss(total)}</span></div>
          <div className="landing-radio__status-row">
            <p className="landing-radio__status">{!sound ? copy.press : paused ? copy.paused : copy.onAir}</p>
            <button type="button" className="landing-radio__join" onClick={enableSound}>{copy.join}</button>
          </div>
          <div className="landing-radio__volume">
            <button type="button" onClick={toggleMute} aria-label={muted ? "Activar sonido" : "Silenciar"}>
              {muted ? <SpeakerSlash size={15} /> : <SpeakerHigh size={15} />}
            </button>
            <input
              type="range" min={0} max={100} value={volume} aria-label="Volumen de la radio"
              onChange={(event) => {
                const value = Number(event.target.value);
                setVolume(value);
                volumeRef.current = value;
                try { window.localStorage.setItem(VOLUME_KEY, String(value)); } catch { /* sin almacenamiento */ }
                const player = playerRef.current;
                if (player) {
                  if (value === 0) { player.mute(); setMuted(true); }
                  else { player.unMute(); player.setVolume(value); setMuted(false); setSound(true); soundRef.current = true; }
                }
              }}
            />
            <button type="button" onClick={togglePause} aria-label={paused ? "Reanudar" : "Pausar"}>
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
          </div>
          <div className="landing-radio__next"><span>{copy.upNext}</span><strong>{snapshot.next.title}{snapshot.next.artist ? ` — ${snapshot.next.artist}` : ""}</strong></div>
        </div>
      ) : <div className="landing-radio__content"><p className="landing-radio__label">{error ?? copy.loading}</p></div>}
    </aside>
  );
}
