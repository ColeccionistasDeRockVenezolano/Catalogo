import { useId, useState, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { MobileCatalogTools } from "./MobileCatalogTools";
import { MOBILE_QUERY } from "./TopbarTools";
import { useMediaQuery } from "../lib/useMediaQuery";

/**
 * Abrir un panel no aplica filtros; cerrarlo conserva la selección y los resultados.
 * En móvil, el buscador sube a la cabecera y los paneles van a la hoja de filtros.
 */
export function CatalogFilters({ search, typeLabel, typeActive, genreActive, typeFilter, genreFilter, decadeActive = false, decadeFilter, sort, mobile, values }: {
  sort?: ReactNode;
  decadeActive?: boolean;
  decadeFilter?: ReactNode;
  search: ReactNode;
  typeLabel: string;
  typeActive: boolean;
  genreActive: boolean;
  typeFilter: ReactNode;
  genreFilter: ReactNode;
  mobile: { query: string; onClearQuery: () => void; total: number | undefined; noun: { one: string; many: string }; onClearAll: () => void };
  /** Lo elegido en cada panel, en palabras, para las filas de la hoja móvil. */
  values: { type: string | null; genre: string | null; decade?: string | null };
}) {
  const id = useId();
  const [open, setOpen] = useState({ type: false, genre: false, decade: false });
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const panels = [
    { key: "type" as const, label: typeLabel, active: typeActive, content: typeFilter },
    { key: "genre" as const, label: "Género", active: genreActive, content: genreFilter },
    ...(decadeFilter ? [{ key: "decade" as const, label: "Décadas", active: decadeActive, content: decadeFilter }] : []),
  ];

  if (isMobile) {
    const groups = [
      { key: "type", label: "Tipo", value: values.type, content: typeFilter },
      { key: "genre", label: "Género", value: values.genre, content: genreFilter },
      ...(decadeFilter ? [{ key: "decade", label: "Década", value: values.decade ?? null, empty: "Todas", content: decadeFilter }] : []),
    ];
    return (
      <MobileCatalogTools {...mobile} search={search} settings={sort} groups={groups}
        activeCount={panels.filter((panel) => panel.active).length} />
    );
  }

  return (
    <>
      <div className="list-toolbar">
        {search}
        <div className="catalog-toolbar-controls">
          <div className="catalog-filter-toggles" role="group" aria-label="Mostrar filtros">
            {panels.map((panel) => (
              <button key={panel.key} id={`${id}-${panel.key}-button`} type="button"
                className="gchip catalog-filter-toggle" aria-expanded={open[panel.key]}
                aria-controls={`${id}-${panel.key}-panel`}
                onClick={() => setOpen((current) => ({ ...current, [panel.key]: !current[panel.key] }))}>
                {panel.active ? <Check className="gchip__check" aria-hidden="true" weight="bold" /> : null}
                <span className="gchip__text">{panel.label}</span>
                {panel.active ? <span className="visually-hidden">: filtro aplicado</span> : null}
                <CaretDown className="catalog-filter-toggle__caret" aria-hidden="true" />
              </button>
            ))}
          </div>
          {sort}
        </div>
      </div>
      {panels.map((panel) => (
        <div key={panel.key} id={`${id}-${panel.key}-panel`} hidden={!open[panel.key]}>
          {open[panel.key] ? panel.content : null}
        </div>
      ))}
    </>
  );
}
