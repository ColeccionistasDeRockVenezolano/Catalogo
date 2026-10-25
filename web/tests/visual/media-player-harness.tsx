import { StrictMode, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { VideoProvider, useVideoPlayer } from "../../src/components/VideoPlayer";
import { EmbedPanel } from "../../src/components/ListenPlayer";
import { AlbumYoutubePlayer } from "../../src/components/AlbumYoutubePlayer";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";
import { embedOptions } from "../../src/lib/embeds";
import "../../src/styles/global.css";
import "../../src/styles/video-player.css";

const first = { videoId: "Q-pRpO2sYSI", title: "Artista de prueba — Disco completo" };
const second = { videoId: "bePwD424LvA", title: "Video de otro lado" };
const audio = embedOptions([{ label: null, links: [{ platform: "soundcloud", url: "https://soundcloud.com/crv-test" }] }], "artist")[0]!;
const playlist = embedOptions([{ label: null, links: [{ platform: "youtube", url: "https://www.youtube.com/playlist?list=PL12345678901234567890" }] }], "artist")[0]!;
function Controls() {
  const { play } = useVideoPlayer();
  const location = useLocation();
  const onPlayback = useCallback(() => {}, []);
  return <main style={{ padding: 24, maxWidth: 900, margin: "auto" }}>
    <h1>Prueba del reproductor</h1><p>{location.pathname}</p>
    <button className="btn" onClick={() => play(first, "qa", 0, true, [
      { video: first, title: "Primera pista", seconds: 0 }, { video: first, title: "Segunda pista", seconds: 90 },
      { video: second, title: "Otro lado", seconds: 0 },
    ])}>Reproducir video de prueba</button>
    <Link className="btn" to="/otra-pagina">Otra página</Link>
    <Link className="btn" to="/album">Disco de prueba</Link>
    <Link className="btn" to="/">Inicio</Link>
    <Routes>
      <Route path="/" element={<><h2>Audio</h2><EmbedPanel option={audio} subject="Audio de prueba" fullElsewhere={null} /><h2>Lista de videos</h2><EmbedPanel option={playlist} subject="Lista de prueba" fullElsewhere={null} /></>} />
      <Route path="/otra-pagina" element={<h2>Contenido de otra página</h2>} />
      <Route path="/album" element={<AlbumYoutubePlayer videoId={first.videoId} title="Álbum de prueba" albumId={57} tracks={[{ video: { ...first, album: { id: 57, title: "Álbum de prueba" } }, title: "Primera pista", seconds: 0 }]} onPlaybackChange={onPlayback} />} />
    </Routes>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary><MemoryRouter><VideoProvider><Controls /></VideoProvider></MemoryRouter></ErrorBoundary></StrictMode>);
