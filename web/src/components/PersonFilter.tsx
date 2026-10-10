import { useEffect, useId, useRef } from "react";
import type { PersonFacets } from "../lib/types";
import { personRoleLabel } from "../lib/labels";
import { FilterChip } from "./ListFilters";

export const WITHOUT_CREDITS = "__without_credits";

export function PersonFilter({ facets, error, onRetry, selection, onSelect }: {
  facets: PersonFacets | undefined;
  error: string | undefined;
  onRetry: () => void;
  selection: string | null;
  onSelect: (value: string | null) => void;
}) {
  const labelId = useId();
  const railRef = useRef<HTMLDivElement>(null);

  // Como en los géneros, la participación elegida queda a la vista en la fila móvil.
  useEffect(() => {
    const rail = railRef.current;
    const pressed = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !pressed || rail.scrollWidth <= rail.clientWidth) return;
    const left = pressed.offsetLeft - rail.offsetLeft - rail.clientWidth / 2 + pressed.offsetWidth / 2;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: Math.max(0, left), behavior: calm ? "auto" : "smooth" });
  }, [selection, facets]);

  if (error && !facets) {
    return (
      <div className="gfilter gfilter--error" role="alert">
        <span>No se pudieron cargar las participaciones.</span>
        <button type="button" className="btn btn--sm" onClick={onRetry}>Reintentar</button>
      </div>
    );
  }

  if (!facets) {
    return (
      <div className="gfilter" aria-busy="true" aria-label="Cargando participaciones">
        <div className="gfilter__rail">
          {Array.from({ length: 6 }, (_, index) => <span key={index} className="gchip gchip--skeleton" style={{ width: 70 + (index % 3) * 22 }} />)}
        </div>
      </div>
    );
  }

  const roles = [...facets.roles];
  // Una URL compartida puede elegir una participación que aún no tenga fichas.
  if (selection && selection !== WITHOUT_CREDITS && !roles.some((entry) => entry.role === selection)) {
    roles.push({ role: selection, count: 0 });
  }

  return (
    <section className="gfilter" aria-labelledby={labelId}>
      <div className="gfilter__head">
        <h2 id={labelId} className="gfilter__label">Filtrar por participación</h2>
      </div>
      <div className="gfilter__rail" ref={railRef} role="group" aria-label="Participaciones">
        <FilterChip label="Todos" count={facets.total} pressed={selection === null} onClick={() => onSelect(null)} />
        {roles.map((entry) => (
          <FilterChip key={entry.role} label={personRoleLabel(entry.role)} count={entry.count}
            pressed={selection === entry.role}
            onClick={() => onSelect(selection === entry.role ? null : entry.role)} />
        ))}
        <span className="gfilter__divider" aria-hidden="true" />
        <FilterChip label="Sin créditos" count={facets.withoutCredits} pressed={selection === WITHOUT_CREDITS}
          variant="none" onClick={() => onSelect(selection === WITHOUT_CREDITS ? null : WITHOUT_CREDITS)} />
      </div>
    </section>
  );
}
