import { useEffect, useId, useRef } from "react";
import type { DecadeFacets } from "../lib/types";
import { decadeLabel, type DecadeSelection } from "../lib/useDecadeFilter";
import { FilterChip } from "./ListFilters";

export function DecadeFilter({ facets, error, onRetry, selection, onSelect, basis, countsLabel = "Conteos del catálogo completo" }: {
  countsLabel?: string;
  facets: DecadeFacets | undefined;
  error?: string | undefined;
  onRetry?: () => void;
  selection: DecadeSelection;
  onSelect: (value: DecadeSelection) => void;
  basis: "release" | "formation";
}) {
  const labelId = useId();
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rail = railRef.current;
    const pressed = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !pressed || rail.scrollWidth <= rail.clientWidth) return;
    rail.scrollTo({ left: Math.max(0, pressed.offsetLeft - rail.offsetLeft - rail.clientWidth / 2 + pressed.offsetWidth / 2), behavior: "instant" });
  }, [selection, facets]);

  if (error && !facets) return <div className="gfilter gfilter--error" role="alert">
    <span>No se pudieron cargar las décadas.</span>
    {onRetry ? <button type="button" className="btn btn--sm" onClick={onRetry}>Reintentar</button> : null}
  </div>;
  if (!facets) return <div className="gfilter" aria-busy="true" aria-label="Cargando décadas">
    <div className="gfilter__rail">{Array.from({ length: 6 }, (_, index) => <span key={index} className="gchip gchip--skeleton" style={{ width: 110 }} />)}</div>
  </div>;

  const decades = [...facets.decades];
  if (typeof selection === "number" && !decades.some(item => item.decade === selection)) {
    decades.push({ decade: selection, count: 0 });
    decades.sort((a, b) => a.decade - b.decade);
  }
  return <section className="gfilter" aria-labelledby={labelId}>
    <div className="gfilter__head"><h2 id={labelId} className="gfilter__label">
      {basis === "release" ? "Década de lanzamiento" : "Década de formación o inicio"}
    </h2><span className="status">{countsLabel}</span></div>
    <div className="gfilter__rail" ref={railRef} role="group" aria-label="Décadas">
      <FilterChip label="Todas" count={facets.total} pressed={selection === null} onClick={() => onSelect(null)} />
      {decades.map(item => <FilterChip key={item.decade} label={decadeLabel(item.decade)} count={item.count}
        pressed={selection === item.decade} onClick={() => onSelect(selection === item.decade ? null : item.decade)} />)}
      <FilterChip label="Sin año" count={facets.withoutYear} variant="none" pressed={selection === "without-year"}
        onClick={() => onSelect(selection === "without-year" ? null : "without-year")} />
    </div>
  </section>;
}
