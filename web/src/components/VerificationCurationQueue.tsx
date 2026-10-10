import { useId, useState } from "react";
import { curationFindings, findingInstruction } from "../../../src/verification/curation";
import { VERIFICATION_AREAS } from "../../../src/verification/types";
import type { VerificationFinding, VerificationReport } from "../../../src/verification/types";
import type { CatalogPlan } from "../../../src/curation/ai/types";

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const PAGE_SIZE = 12;

export function VerificationCurationQueue({ report, history, disabled, onPrepare, onSelect }: {
  report: VerificationReport; history: CatalogPlan[]; disabled: boolean;
  onPrepare: (finding: VerificationFinding) => void; onSelect: (plan: CatalogPlan) => void;
}) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [page, setPage] = useState(0);
  const searchId = useId(), areaId = useId();
  const findings = curationFindings(report);
  const filtered = findings.filter(f => (area === "all" || f.area === area) && fold(`${f.label} ${f.observed ?? ""} ${f.context.join(" ")}`).includes(fold(query.trim())));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const start = currentPage * PAGE_SIZE, end = Math.min(start + PAGE_SIZE, filtered.length);
  if (!findings.length) return null;
  return <section className="ai-verification-queue" aria-label="Pendientes de la ficha">
    <h2>Recomendaciones y datos faltantes ({findings.length})</h2>
    <p>Elige un dato para preparar su corrección. Después podrás aceptarla o rechazarla.</p>
    {report.stale ? <p className="hint">La ficha cambió desde este informe. La IA comprobará el dato actual antes de proponer cambios.</p> : null}
    <div className="verification-browser__filters">
      <label className="field" htmlFor={searchId}>Buscar pendiente<input id={searchId} type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <label className="field" htmlFor={areaId}>Área<select id={areaId} value={area} onChange={e => { setArea(e.target.value); setPage(0); }}><option value="all">Todas las áreas</option>{Object.entries(VERIFICATION_AREAS).filter(([key]) => findings.some(f => f.area === key)).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
    </div>
    <p className="hint" role="status">{filtered.length ? `${start + 1}–${end} de ${filtered.length} pendientes` : "No hay pendientes que coincidan con estos filtros."}</p>
    <ul className="ai-finding-list">{filtered.slice(start, end).map(finding => {
      const prepared = history.find(plan => plan.instruction === findingInstruction(finding) && plan.status !== "failed");
      return <li key={finding.key}>
        <div><strong>{finding.observed ? `${finding.label}: ${finding.observed}` : finding.label}</strong><p className="hint">{VERIFICATION_AREAS[finding.area].label} · {finding.status === "contradicted" ? "Dato en discrepancia" : finding.observed ? "Recomendación por revisar" : "Falta investigar el valor"}</p>
          <details><summary>Ver dato y fuentes</summary><p>Actual: {finding.value ?? "Sin dato"}</p><p>{finding.explanation}</p>{finding.context.length ? <p>{finding.context.join(" · ")}</p> : null}{finding.evidence.map((e, index) => <blockquote key={`${e.url}:${index}`}>{e.quote}<br /><a href={e.url} target="_blank" rel="noopener noreferrer">{e.title || e.url}</a></blockquote>)}</details>
        </div>
        <button className="btn btn--sm" type="button" disabled={disabled} onClick={() => prepared ? onSelect(prepared) : onPrepare(finding)}>{prepared ? "Ver propuesta" : finding.observed ? "Preparar corrección" : "Investigar y proponer"}</button>
      </li>;
    })}</ul>
    {filtered.length > PAGE_SIZE ? <nav className="verification-browser__pagination" aria-label="Páginas de pendientes"><button className="btn btn--sm" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="btn btn--sm" type="button" disabled={end >= filtered.length} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav> : null}
  </section>;
}
