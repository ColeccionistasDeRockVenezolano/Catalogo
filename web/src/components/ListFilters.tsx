import { Check, X } from "@phosphor-icons/react";

export const formatCount = (value: number) => value.toLocaleString("es-VE");

interface FilterChipProps {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
  small?: boolean;
  revealed?: boolean;
  variant?: "none";
  icon?: React.ReactNode;
}

export function FilterChip({ label, count, pressed, onClick, small, revealed, variant, icon }: FilterChipProps) {
  const className = ["gchip", small ? "gchip--sub" : "", variant === "none" ? "gchip--none" : "", revealed ? "is-revealed" : ""]
    .filter(Boolean).join(" ");
  return (
    <button type="button" className={className} aria-pressed={pressed} onClick={onClick}
      aria-label={`${label}: ${formatCount(count)}`}>
      {pressed ? <Check className="gchip__check" aria-hidden="true" weight="bold" /> : icon ?? null}
      <span className="gchip__text">{label}</span>
      <span className="gchip__count" aria-hidden="true">{formatCount(count)}</span>
    </button>
  );
}

/**
 * Línea de resultado bajo los filtros: cuántas fichas se ven y qué filtros
 * están activos, cada uno con su «quitar» y un «Quitar filtros» general.
 */
export function ListSummary({ total, noun, query, filterLabel, onClearQuery, onClearFilter, filters, onClearAll, loading }: {
  total: number | undefined;
  noun: { one: string; many: string };
  query: string;
  filterLabel?: string | null;
  onClearQuery: () => void;
  onClearFilter?: () => void;
  filters?: Array<{ key: string; label: string; onClear: () => void }>;
  onClearAll?: () => void;
  loading: boolean;
}) {
  const activeFilters = filters ?? (filterLabel && onClearFilter ? [{ key: "category", label: filterLabel, onClear: onClearFilter }] : []);
  const filtered = Boolean(query.trim()) || activeFilters.length > 0;
  return (
    <div className="list-summary" aria-live="polite" aria-busy={loading}>
      <p className="list-summary__count">
        {total === undefined ? " " : <><strong>{formatCount(total)}</strong> {total === 1 ? noun.one : noun.many}</>}
      </p>
      {filtered ? (
        <ul className="list-summary__filters" aria-label="Filtros activos">
          {query.trim() ? (
            <li><button type="button" className="fpill" onClick={onClearQuery} aria-label={`Quitar búsqueda «${query.trim()}»`}>
              <span className="fpill__text">«{query.trim()}»</span><X aria-hidden="true" weight="bold" />
            </button></li>
          ) : null}
          {activeFilters.map((filter) => (
            <li key={filter.key}><button type="button" className="fpill" onClick={filter.onClear} aria-label={`Quitar filtro ${filter.label}`}>
              <span className="fpill__text">{filter.label}</span><X aria-hidden="true" weight="bold" />
            </button></li>
          ))}
          {Number(Boolean(query.trim())) + activeFilters.length > 1 ? (
            <li><button type="button" className="btn btn--ghost btn--sm list-summary__clear"
              onClick={onClearAll ?? (() => { onClearQuery(); activeFilters.forEach((filter) => filter.onClear()); })}>Quitar filtros</button></li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
