import { useEffect, useId, useRef } from "react";
import type { TypeFacets } from "../lib/types";
import { FilterChip } from "./ListFilters";

export function TypeFilter({ facets, error, onRetry, selectedType, onSelect, kind, typeLabel }: {
  kind: "artist" | "album";
  typeLabel: (value: string) => string;
  facets: TypeFacets | undefined;
  error: string | undefined;
  onRetry: () => void;
  selectedType: string | null;
  onSelect: (value: string | null) => void;
}) {
  const noun = kind === "artist" ? "artista" : "disco";
  const labelId = useId();
  const railRef = useRef<HTMLDivElement>(null);

  // Como en los géneros, el tipo elegido queda a la vista en la fila móvil.
  useEffect(() => {
    const rail = railRef.current;
    const pressed = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !pressed || rail.scrollWidth <= rail.clientWidth) return;
    const left = pressed.offsetLeft - rail.offsetLeft - rail.clientWidth / 2 + pressed.offsetWidth / 2;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: Math.max(0, left), behavior: calm ? "auto" : "smooth" });
  }, [selectedType, facets]);

  if (error && !facets) {
    return (
      <div className="gfilter gfilter--error" role="alert">
        <span>No se pudieron cargar los tipos de {noun}.</span>
        <button type="button" className="btn btn--sm" onClick={onRetry}>Reintentar</button>
      </div>
    );
  }

  if (!facets) {
    return (
      <div className="gfilter" aria-busy="true" aria-label={`Cargando tipos de ${noun}`}>
        <div className="gfilter__rail">
          {Array.from({ length: 6 }, (_, index) => <span key={index} className="gchip gchip--skeleton" style={{ width: 70 + (index % 3) * 22 }} />)}
        </div>
      </div>
    );
  }

  const types = [...facets.types];
  // Una URL compartida puede elegir un tipo que aún no tenga fichas.
  if (selectedType && !types.some((type) => type.value === selectedType)) {
    types.push({ value: selectedType, count: 0 });
  }

  return (
    <section className="gfilter" aria-labelledby={labelId}>
      <div className="gfilter__head">
        <h2 id={labelId} className="gfilter__label">Filtrar por tipo de {noun}</h2>
      </div>
      <div className="gfilter__rail" ref={railRef} role="group" aria-label={`Tipos de ${noun}`}>
        <FilterChip label="Todos" count={facets.total} pressed={selectedType === null} onClick={() => onSelect(null)} />
        {types.map((type) => (
          <FilterChip key={type.value} label={typeLabel(type.value)} count={type.count}
            pressed={selectedType === type.value}
            onClick={() => onSelect(selectedType === type.value ? null : type.value)} />
        ))}
      </div>
    </section>
  );
}
