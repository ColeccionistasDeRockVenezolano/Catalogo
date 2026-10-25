import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, List } from "@phosphor-icons/react";
import { ENTITY_KIND_LABEL, SEVERITY_LABEL, formatCount } from "../lib/curation";
import type { CurationFinding } from "../lib/types";

interface Props {
  rows: CurationFinding[];
  activeId: number;
  offset: number;
  total: number;
  selected: ReadonlySet<number>;
  selectAll: boolean;
  loading: boolean;
  detail: ReactNode;
  actions: ReactNode;
  initiallyOpen: boolean;
  onActivate: (index: number) => void;
  onMove: (delta: number) => void;
  onToggleSelected: (id: number) => void;
  onSelectPage: (checked: boolean) => void;
}

export function CurationWorkbench({ rows, activeId, offset, total, selected, selectAll, loading, detail, actions,
  initiallyOpen, onActivate, onMove, onToggleSelected, onSelectPage }: Props) {
  const [detailOpen, setDetailOpen] = useState(initiallyOpen);
  const index = Math.max(0, rows.findIndex((finding) => finding.id === activeId));
  const pageCheckbox = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const selectable = rows.filter((finding) => finding.status === "open" && finding.actions.length > 0);
  const picked = selectable.filter((finding) => selectAll || selected.has(finding.id)).length;

  useEffect(() => {
    if (pageCheckbox.current) pageCheckbox.current.indeterminate = picked > 0 && picked < selectable.length;
  }, [picked, selectable.length]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [activeId]);

  function open(index: number) {
    onActivate(index);
    setDetailOpen(true);
    if (window.matchMedia("(max-width: 760px)").matches) {
      requestAnimationFrame(() => workbenchRef.current?.scrollIntoView({ block: "start", behavior: "instant" }));
    }
  }

  return <div ref={workbenchRef} className={`cwork${detailOpen ? " cwork--detail-open" : ""}`} aria-busy={loading}>
    <section className="cwork__queue" aria-label="Lista de casos">
      <div className="cwork__queue-head">
        {selectable.length > 0 ? <label className="cwork__pick-page">
          <input ref={pageCheckbox} type="checkbox" checked={picked === selectable.length}
            disabled={loading} onChange={(event) => onSelectPage(event.target.checked)} />
          Seleccionar página
        </label> : <span>Casos de esta página</span>}
        <span>{formatCount(rows.length)}</span>
      </div>
      <ol className="cwork__list" ref={listRef}>
        {rows.map((finding, rowIndex) => {
          const fixable = finding.status === "open" && finding.actions.length > 0;
          return <li key={finding.id} className={`cwork__row${finding.id === activeId ? " is-active" : ""}`}>
            {fixable ? <input type="checkbox" aria-label={`Seleccionar ${finding.entity.label || finding.title}`}
              checked={selectAll || selected.has(finding.id)} disabled={loading} onChange={() => onToggleSelected(finding.id)} /> : null}
            <button type="button" className="cwork__case" aria-current={finding.id === activeId ? "true" : undefined}
              aria-controls="curation-case-detail" disabled={loading} onClick={() => open(rowIndex)}>
              <span className="cwork__entity">{finding.entity.label || finding.title}</span>
              <span className="cwork__issue">{finding.title}</span>
              <span className="cwork__meta">
                <span className={`cwork__severity cwork__severity--${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
                <span>{ENTITY_KIND_LABEL[finding.entity.kind] ?? finding.entity.kind}</span>
                <span>{finding.status === "open" ? finding.signatureLabel : finding.status === "ignored" ? "Ignorado" : "Resuelto"}</span>
              </span>
            </button>
          </li>;
        })}
      </ol>
    </section>
    <section id="curation-case-detail" className="cwork__detail" aria-label="Detalle del caso">
      <div className="cwork__detail-head">
        <button type="button" className="btn btn--sm cwork__back" onClick={() => setDetailOpen(false)}>
          <List size={16} aria-hidden="true" /> Lista
        </button>
        <span role="status">Caso {formatCount(offset + index + 1)} de {formatCount(total)}</span>
        <div className="cwork__navigation">
          <button type="button" className="btn btn--sm" aria-label="Caso anterior" disabled={loading || offset + index === 0}
            onClick={() => onMove(-1)}><ArrowLeft size={16} aria-hidden="true" /></button>
          <button type="button" className="btn btn--sm" aria-label="Caso siguiente" disabled={loading || offset + index + 1 >= total}
            onClick={() => onMove(1)}><ArrowRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="cwork__body" key={activeId}>{detail}</div>
      <div className="cwork__decisions" aria-label="Decidir sobre este caso">{actions}</div>
    </section>
  </div>;
}
