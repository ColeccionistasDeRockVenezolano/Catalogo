import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import "../styles/entity-tabs.css";

export interface TabSpec {
  key: string;
  label: string;
  /** Cantidad que se muestra junto al nombre; 0 se ve atenuado, undefined no muestra nada. */
  count?: number | undefined;
  content: ReactNode;
}

function revealSelectedTab(node: HTMLElement) {
  const selected = node.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!selected) return;
  const offset = selected.getBoundingClientRect().left - node.getBoundingClientRect().left;
  if (offset < 0) node.scrollLeft += offset;
  else if (offset + selected.offsetWidth > node.clientWidth) node.scrollLeft += offset + selected.offsetWidth - node.clientWidth;
}

/**
 * Pestañas de una ficha. La pestaña activa vive en `?tab=` (se puede compartir
 * el enlace y el botón «atrás» no pierde el sitio) y solo se monta el panel
 * activo. Teclado: flechas, Inicio y Fin, según el patrón ARIA de tabs.
 */
export function EntityTabs({ tabs, defaultKey }: { tabs: readonly TabSpec[]; defaultKey?: string }) {
  const [params, setParams] = useSearchParams();
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const list = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const requested = params.get("tab");
  const active = tabs.find((tab) => tab.key === requested)
    ?? tabs.find((tab) => tab.key === defaultKey)
    ?? tabs[0];
  const activeKey = active?.key;
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => setOverflow({ left: node.scrollLeft > 2, right: node.scrollLeft + node.clientWidth < node.scrollWidth - 2 });
    const observer = new ResizeObserver(() => { revealSelectedTab(node); measure(); });
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    node.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { observer.disconnect(); node.removeEventListener("scroll", measure); };
  }, [tabs.length]);
  useEffect(() => {
    const node = list.current;
    if (node) revealSelectedTab(node);
  }, [activeKey]);
  if (!active) return null;

  function select(key: string) {
    const next = new URLSearchParams(params);
    if (key === (defaultKey ?? tabs[0]?.key)) next.delete("tab"); else next.set("tab", key);
    setParams(next, { replace: true });
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last : null;
    if (target === null) return;
    event.preventDefault();
    const tab = tabs[target];
    if (!tab) return;
    select(tab.key);
    refs.current[target]?.focus();
  }

  return (
    <div className="etabs">
      <label className="etabs__select"><span>Explorar perfil</span><select aria-label="Ir a una sección del perfil" value={active.key} onChange={event => select(event.target.value)}>{tabs.map(tab => <option key={tab.key} value={tab.key}>{tab.label}{tab.count !== undefined ? ` (${tab.count})` : ""}</option>)}</select></label>
      <div className="etabs__navigation">
      <button type="button" className="etabs__scroll" aria-label="Ver pestañas anteriores" disabled={!overflow.left} onClick={() => list.current?.scrollBy({ left: -Math.max(240, list.current.clientWidth * .7), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><CaretLeft size={18} /></button>
      <div ref={list} className="etabs__list" role="tablist" aria-label="Secciones del perfil">
        {tabs.map((tab, index) => {
          const selected = tab.key === active.key;
          return (
            <button
              key={tab.key}
              ref={(node) => { refs.current[index] = node; }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              className={`etabs__tab${selected ? " is-active" : ""}`}
              onClick={() => select(tab.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
              {tab.count !== undefined ? <span className={`etabs__count${tab.count === 0 ? " is-zero" : ""}`}>{tab.count}</span> : null}
            </button>
          );
        })}
      </div>
      <button type="button" className="etabs__scroll" aria-label="Ver más pestañas" disabled={!overflow.right} onClick={() => list.current?.scrollBy({ left: Math.max(240, list.current.clientWidth * .7), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><CaretRight size={18} /></button>
      </div>
      <div className="etabs__panel" role="tabpanel" tabIndex={0} id={`${baseId}-panel-${active.key}`} aria-labelledby={`${baseId}-tab-${active.key}`}>
        {active.content}
      </div>
    </div>
  );
}

/** Texto de «vacío» común a todos los paneles. */
export function TabEmpty({ children }: { children: ReactNode }) {
  return <div className="etabs__empty">{children}</div>;
}
