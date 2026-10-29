import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { formatCount } from "./ListFilters";
import { TopbarToolsPortal, useTopbarTools } from "./TopbarTools";

/** Icono de filtros (Iconly «Filter»), en la misma retícula de 24 que Phosphor. */
export function FilterIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.144 17.883H4.671" />
      <path d="M15.205 17.884c0 2.041.681 2.721 2.722 2.721s2.721-.68 2.721-2.721-.68-2.722-2.721-2.722-2.722.68-2.722 2.722Z" />
      <path d="M14.177 7.394h6.471" />
      <path d="M10.115 7.393c0-2.041-.681-2.722-2.722-2.722S4.671 5.352 4.671 7.393s.681 2.722 2.722 2.722 2.722-.681 2.722-2.722Z" />
    </svg>
  );
}

/** Un grupo de filtros de la hoja: una fila con su valor actual que abre sus opciones. */
export interface FilterGroup {
  key: string;
  label: string;
  /** Lo elegido, en palabras; `null` si no filtra. */
  value: string | null;
  /** Qué se muestra sin filtro («Todos», «Todas»). */
  empty?: string;
  content: ReactNode;
}

/**
 * Listas del catálogo en móvil: la lupa de la cabecera abre el buscador de la
 * entidad y, a su lado, el botón de filtros abre una hoja en dos niveles: el
 * orden y una fila por grupo con lo elegido; tocar una fila muestra sus
 * opciones. Los filtros se aplican al tocarlos; la hoja muestra cuántas fichas quedan.
 */
export function MobileCatalogTools({ search, query, onClearQuery, settings, groups, activeCount, total, noun, onClearAll }: {
  search: ReactNode;
  query: string;
  onClearQuery: () => void;
  /** Ajustes de una sola elección (orden, «Mostrar»): selects en la primera vista. */
  settings?: ReactNode;
  groups: FilterGroup[];
  activeCount: number;
  total: number | undefined;
  noun: { one: string; many: string };
  onClearAll: () => void;
}) {
  const { setSearching } = useTopbarTools();
  // Una búsqueda en curso (URL compartida, volver atrás) abre el campo con ella.
  const [searching, setOpen] = useState(() => Boolean(query.trim()));
  const [filtering, setFiltering] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const lastView = useRef<string | null>(null);

  useEffect(() => {
    setSearching(searching);
    if (searching && focusOnOpen.current) fieldRef.current?.querySelector("input")?.focus();
    focusOnOpen.current = false;
  }, [searching, setSearching]);
  useEffect(() => () => setSearching(false), [setSearching]);

  // Un solo grupo y nada que ordenar (organizaciones): sus opciones van directo.
  const single = groups.length === 1 && !settings ? groups[0] : undefined;
  const current = single ?? groups.find((group) => group.key === view);

  // Al cambiar de vista la hoja vuelve arriba; al volver, el foco regresa a la fila abierta.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.closest(".modal-body")?.scrollTo({ top: 0 });
    if (view) (sheet.querySelector<HTMLElement>(".filter-sheet__panel [aria-pressed='true']") ?? sheet.querySelector<HTMLElement>(".filter-sheet__panel button"))?.focus({ preventScroll: true });
    else if (lastView.current) sheet.querySelector<HTMLElement>(`[data-group="${lastView.current}"]`)?.focus({ preventScroll: true });
    lastView.current = view;
  }, [view]);

  function closeSearch() {
    if (query) onClearQuery();
    setOpen(false);
  }

  function closeSheet() {
    setFiltering(false);
    setView(null);
    lastView.current = null;
  }

  const filtersLabel = activeCount ? `Filtros (${activeCount} aplicados)` : "Filtros";
  return (
    <>
      <TopbarToolsPortal>
        <div className={`topbar-tools${searching ? " is-searching" : ""}`}>
          {searching ? (
            <>
              <button type="button" className="topbar-icon-btn" onClick={closeSearch} aria-label="Cerrar búsqueda">
                <ArrowLeft size={22} aria-hidden="true" />
              </button>
              <div className="topbar-tools__field" ref={fieldRef}
                onKeyDown={(event) => { if (event.key === "Escape" && !query) closeSearch(); }}>
                {search}
              </div>
            </>
          ) : (
            <button type="button" className="topbar-icon-btn" aria-label={`Buscar ${noun.many}`}
              onClick={() => { focusOnOpen.current = true; setOpen(true); }}>
              <MagnifyingGlass size={22} aria-hidden="true" />
            </button>
          )}
          <button type="button" className={`topbar-icon-btn topbar-tools__filters${activeCount ? " is-filtering" : ""}`} aria-haspopup="dialog"
            aria-label={filtersLabel} onClick={() => setFiltering(true)}>
            <FilterIcon />
            {activeCount ? <span className="topbar-tools__badge" aria-hidden="true">{activeCount}</span> : null}
          </button>
        </div>
      </TopbarToolsPortal>
      {filtering ? (
        <Modal title={current?.label ?? "Filtros"} sheet focusPanel onClose={closeSheet}
          {...(current && !single ? { onBack: () => setView(null) } : {})}>
          <div className="filter-sheet" ref={sheetRef}>
            {current ? (
              <div className="filter-sheet__panel" key={current.key}>{current.content}</div>
            ) : (
              <div className="filter-sheet__menu">
                {settings ? <div className="filter-sheet__settings">{settings}</div> : null}
                <ul className="filter-sheet__groups">
                  {groups.map((group) => (
                    <li key={group.key}>
                      <button type="button" className="filter-sheet__group" data-group={group.key} onClick={() => setView(group.key)}>
                        <span className="filter-sheet__group-label">{group.label}</span>
                        <span className={`filter-sheet__group-value${group.value ? " is-set" : ""}`}>{group.value ?? group.empty ?? "Todos"}</span>
                        <CaretRight className="filter-sheet__group-caret" size={16} weight="bold" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="filter-sheet__actions">
              <button type="button" className="btn btn--ghost" onClick={onClearAll} disabled={!activeCount && !query.trim()}>Quitar filtros</button>
              <button type="button" className="btn btn--primary" onClick={closeSheet}>
                {total === undefined ? "Ver resultados" : `Ver ${formatCount(total)} ${total === 1 ? noun.one : noun.many}`}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
