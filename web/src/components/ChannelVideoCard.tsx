import { useState, type CSSProperties, type ReactNode } from "react";
import { ArrowSquareOut, FilmSlate, Play } from "@phosphor-icons/react";
import "../styles/channel-video-card.css";

const videoDate = new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const NEW_VIDEO_DAYS = 14;

interface ChannelVideoCardProps {
  video: { videoId: string | null; title: string | null; thumbnailUrl: string | null; publishedAt?: string | null };
  today?: string | undefined;
  index?: number;
  onPlay?: (() => void) | undefined;
  url: string | null;
  className?: string;
  unavailableLabel?: string | undefined;
  children?: ReactNode;
}

/** La misma tarjeta del canal en Home y en Audiovisuales de los artistas. */
export function ChannelVideoCard({ video, today, index = 0, onPlay, url, className = "", unavailableLabel, children }: ChannelVideoCardProps) {
  const fallback = video.videoId ? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg` : null;
  const initial = video.thumbnailUrl ?? fallback;
  const [failed, setFailed] = useState<string[]>([]);
  const src = initial && !failed.includes(initial) ? initial : fallback && !failed.includes(fallback) ? fallback : null;
  const published = video.publishedAt ? Date.parse(video.publishedAt) : Number.NaN;
  const date = Number.isFinite(published) ? videoDate.format(published) : null;
  const ageDays = today && Number.isFinite(published) ? (Date.parse(`${today}T12:00:00Z`) - published) / 86_400_000 : Infinity;
  const title = video.title ?? "Video del canal";
  const content = <>
    <span className="home-video__thumb">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(current => [...current, src])} /> : <FilmSlate size={40} aria-hidden="true" />}
      {onPlay ? <span className="home-video__play" aria-hidden="true"><Play size={22} weight="fill" /></span> : null}
      {ageDays >= 0 && ageDays <= NEW_VIDEO_DAYS ? <span className="home-video__new">Nuevo</span> : null}
    </span>
    <span className="home-video__title">{title}</span>
  </>;
  return <div className={`home-video ${className}`.trim()} style={{ "--i": index } as CSSProperties}>
    {onPlay ? <button type="button" className="home-video__open" onClick={onPlay} aria-label={`Reproducir ${title}`}>{content}</button>
      : <div className="home-video__open home-video__open--unavailable">{content}</div>}
    {date ? <span className="home-video__meta">{date}</span> : null}
    {unavailableLabel ? <span className="muted-note">{unavailableLabel}</span> : null}
    {url ? <a className="home-video__youtube" href={url} target="_blank" rel="noreferrer">Abrir desde YouTube <ArrowSquareOut size={13} aria-hidden="true" /></a> : null}
    {children}
  </div>;
}
