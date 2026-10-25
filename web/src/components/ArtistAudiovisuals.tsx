import { useRef, useState } from "react";
import type { ArtistAudiovisual } from "../lib/types";
import { formatDuration } from "../lib/labels";
import { VideoSlot, useVideoPlayer, type CatalogVideoTrack } from "./VideoPlayer";
import { TabEmpty } from "./EntityTabs";
import { ChannelVideoCard } from "./ChannelVideoCard";
import { useDailyCycle } from "../lib/DailyCycleContext";
import "../styles/audiovisuals.css";

const KINDS: Record<ArtistAudiovisual["kind"], string> = {
  documentary: "Documental", live_concert: "Concierto o sesión", music_video: "Videoclip",
  interview: "Entrevista", short: "Short", other: "Otro audiovisual",
};

export function ArtistAudiovisuals({ items, artistId, artistName }: { items: ArtistAudiovisual[]; artistId: number; artistName: string }) {
  const { cycle } = useDailyCycle();
  const [kind, setKind] = useState<ArtistAudiovisual["kind"] | "all">("all");
  const { play, session } = useVideoPlayer();
  const playerPanel = useRef<HTMLDivElement>(null);
  const owner = `artist-audiovisuals:${artistId}`;
  const selected = session?.owner === owner ? items.find(item => item.videoId === session.video.videoId) : undefined;
  const visible = kind === "all" ? items : items.filter(item => item.kind === kind);
  const categories = Object.entries(KINDS).filter(([key]) => items.some(item => item.kind === key));
  const tracks: CatalogVideoTrack[] = items.flatMap(item => item.playable && item.videoId ? [{
    video: { videoId: item.videoId, title: `${artistName} — ${item.title}` }, title: item.title, seconds: 0,
  }] : []);
  function open(item: ArtistAudiovisual, seconds = 0) {
    if (!item.videoId || !item.playable) return;
    const video = { videoId: item.videoId, title: `${artistName} — ${item.title}` };
    const chapters = item.chapters.length ? item.chapters.map(chapter => ({ video, title: chapter.title, seconds: chapter.startSeconds })) : tracks;
    play(video, owner, seconds, true, chapters);
  }
  if (!items.length) return <TabEmpty>Sin audiovisuales registrados.</TabEmpty>;
  return <section className="audiovisuals" aria-label={`Audiovisuales de ${artistName}`}>
    <p className="muted-note">Documentales, conciertos, sesiones, videoclips y otras piezas del archivo.</p>
    {categories.length > 1 ? <div className="audiovisuals__filters" role="group" aria-label="Filtrar audiovisuales">
      <button type="button" className="btn btn--sm" aria-pressed={kind === "all"} onClick={() => setKind("all")}>Todos <span>{items.length}</span></button>
      {categories.map(([key, label]) => <button key={key} type="button" className="btn btn--sm" aria-pressed={kind === key}
        onClick={() => setKind(key as ArtistAudiovisual["kind"])}>{label} <span>{items.filter(item => item.kind === key).length}</span></button>)}
    </div> : null}
    <div ref={playerPanel} className="audiovisuals__player" hidden={!session || session.owner !== owner}>
      {selected ? <h3>{selected.title}</h3> : null}
      <VideoSlot owner={owner} />
    </div>
    <ul className="audiovisuals__list">
      {visible.map(item => <li key={item.id} className="audiovisuals__item">
        <ChannelVideoCard video={{ videoId: item.videoId, title: item.title, thumbnailUrl: item.thumbnailUrl, publishedAt: item.publishedAt ?? null }}
          today={cycle?.date} url={item.url} onPlay={item.playable ? () => open(item) : undefined}
          unavailableLabel={item.playable ? undefined : !item.videoId ? "Sin video disponible" : item.publicationStatus === "copyright_blocked" ? "Video bloqueado" : item.publicationStatus === "unpublished" ? "Video no disponible" : "Disponibilidad sin verificar"}>
          <p className="audiovisuals__meta">{KINDS[item.kind]}{item.releaseYear !== null ? ` · ${item.releaseYear}` : ""}{item.durationSeconds !== null ? ` · ${formatDuration(item.durationSeconds)}` : ""}</p>
          {item.tags?.length ? <p className="muted-note">{item.tags.join(' · ')}</p> : null}
          {item.playable && item.chapters.length ? <details className="audiovisuals__details">
            <summary>Capítulos y canciones ({item.chapters.length})</summary>
            <ol className="audiovisuals__chapters">{item.chapters.map((chapter, index) => <li key={`${chapter.startSeconds}:${index}`}>
              <button type="button" onClick={() => open(item, chapter.startSeconds)} aria-label={`Reproducir ${chapter.title} en ${formatDuration(chapter.startSeconds)}`}>
                <span>{formatDuration(chapter.startSeconds)}</span>{chapter.title}
              </button>
            </li>)}</ol>
          </details> : null}
          {item.description ? <details className="audiovisuals__details"><summary>Descripción y créditos</summary><p className="audiovisuals__description">{item.description}</p></details> : null}
        </ChannelVideoCard>
      </li>)}
    </ul>
  </section>;
}
