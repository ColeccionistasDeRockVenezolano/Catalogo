import { useId, useState, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

/** Abrir un panel no aplica filtros; cerrarlo conserva la selección y los resultados. */
export function CatalogFilters({ search, typeLabel, typeActive, genreActive, typeFilter, genreFilter, decadeActive = false, decadeFilter }: {
  decadeActive?: boolean;
  decadeFilter?: ReactNode;
  search: ReactNode;
  typeLabel: string;
  typeActive: boolean;
  genreActive: boolean;
  typeFilter: ReactNode;
  genreFilter: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState({ type: false, genre: false, decade: false });
  const panels = [
    { key: "type" as const, label: typeLabel, active: typeActive, content: typeFilter },
    { key: "genre" as const, label: "Género", active: genreActive, content: genreFilter },
    ...(decadeFilter ? [{ key: "decade" as const, label: "Década", active: decadeActive, content: decadeFilter }] : []),
  ];

  return (
    <>
      <div className="list-toolbar">
        {search}
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
      </div>
      {panels.map((panel) => (
        <div key={panel.key} id={`${id}-${panel.key}-panel`} hidden={!open[panel.key]}>
          {open[panel.key] ? panel.content : null}
        </div>
      ))}
    </>
  );
}
