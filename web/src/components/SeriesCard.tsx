import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Disc } from "@phosphor-icons/react";
import { mediaImage } from "../lib/media";
import { warmImage } from "../lib/preloadImage";
import { CrossfadeImage } from "./CrossfadeImage";
import type { SeriesListItem } from "../lib/types";

/** Rota sólo las carátulas de tarjetas visibles, con pausa y movimiento reducido; la siguiente
 *  se precarga mientras se muestra la actual y entra con un fundido. */
export function SeriesCard({ series, rotating }: { series: SeriesListItem; rotating: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const covers = series.covers.filter(url => !failed.includes(url));
  const cover = covers[index % Math.max(1, covers.length)];
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!rotating || !visible || interacting || covers.length < 2) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex(value => value + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [rotating, visible, interacting, covers.length]);
  const upcoming = covers.length > 1 ? covers[(index + 1) % covers.length] : undefined;
  useEffect(() => {
    if (rotating && visible && upcoming) warmImage(mediaImage(upcoming, 240));
  }, [rotating, visible, upcoming]);
  const years = series.firstYear === null ? null : series.firstYear === series.lastYear ? String(series.firstYear) : `${series.firstYear}–${series.lastYear}`;
  return <div ref={ref} className="entity-card series-card" onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)}
    onFocusCapture={() => setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    <Link to={`/series/${series.id}`} className="entity-card__art" aria-label={`Ver la serie ${series.title}`}>
      {cover ? <CrossfadeImage {...mediaImage(cover, 240)} alt="" loading="lazy" decoding="async" width="400" height="400"
        imageStyle={{ objectFit: "contain" }} onError={() => setFailed(value => [...value, cover])} />
        : <span className="entity-card__placeholder"><Disc size={48} aria-hidden="true" /><span>Sin carátula</span></span>}
    </Link>
    <div className="entity-card__body">
      <Link to={`/series/${series.id}`} className="entity-card__title">{series.title}</Link>
      {series.artistName && series.artistName !== "Various Artists" ? <span className="entity-card__artist">{series.artistName}</span> : null}
      <span className="entity-card__sub">{series.albumCount} {series.kind === "sessions" ? (series.albumCount === 1 ? "sesión" : "sesiones") : series.albumCount === 1 ? "compilado" : "compilados"}{years ? ` · ${years}` : ""}</span>
      {covers.length > 1 ? <span className="series-card__covers">{covers.length} carátulas</span> : null}
    </div>
  </div>;
}

export function useSeriesRotation() {
  const [rotating, setRotating] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setRotating(!preference.matches);
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);
  return { rotating, toggleRotation: () => setRotating(value => !value) };
}
