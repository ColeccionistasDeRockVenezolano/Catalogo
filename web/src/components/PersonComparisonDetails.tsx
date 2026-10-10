import { useId, useState } from "react";
import { comparisonRows, formatIdentityPoints, type ComparedPerson, type ComparisonCitation, type PersonComparison } from "../lib/personIdentityAssessment";

function CitationList({ evidence, compact = false }: { evidence: readonly ComparisonCitation[]; compact?: boolean }) {
  return evidence.length ? <ul className="person-research__evidence">{evidence.map((item, index) => <li key={`${item.url}-${index}`}>
    <blockquote>«{compact && item.quote.length > 240 ? `${item.quote.slice(0, 240)}…` : item.quote}»</blockquote>
    <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || "Fuente"}</a>
    <span className="comparison-source-kind">{item.origin === "search_snippet" ? "Resumen del buscador; página sin lectura completa" : "Texto de página consultada"}</span>
  </li>)}</ul> : <p>Sin evidencia comprobada para esta ficha.</p>;
}
function SideSummary({ person, excludeUrl }: { person: ComparedPerson; excludeUrl?: string | undefined }) {
  const preview = person.evidence.find((cite) => cite.url !== excludeUrl) ?? person.evidence[0];
  const supported = person.projects.filter((project) => project.evidence.length).length;
  return <section className="comparison-side" aria-label={`Investigación de la ficha ${person.id}`}>
    <h4>{person.name} <span>· ficha #{person.id}</span></h4>
    <p>{supported} de {person.projects.length} registros de trayectoria con respaldo web.</p>
    <CitationList evidence={preview ? [preview] : []} compact />
    {person.missing.length ? <p className="comparison-pending">{person.missing.length} datos o registros pendientes de comprobar.</p> : null}
  </section>;
}
const STATUS = { match: "Coincide", partial: "Parcial", different: "Diferente", missing: "Falta dato", unverified: "Sin comprobar" };

export function PersonComparisonDetails({ comparison, score }: { comparison: PersonComparison; score?: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const rows = comparisonRows(comparison);
  return <div className="person-comparison">
    {comparison.stale ? <p role="status">Esta investigación corresponde a datos anteriores. Actualízala para volver a comprobar ambas fichas.</p> : null}
    <div className="comparison-sides"><SideSummary person={comparison.a} /><SideSummary person={comparison.b} excludeUrl={comparison.a.evidence[0]?.url} /></div>
    {comparison.contradictions.length ? <div className="comparison-conflicts"><strong>Contradicciones documentadas</strong>
      <ul>{comparison.contradictions.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div> : null}
    <button type="button" className="btn btn--sm btn--outline" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
      {expanded ? "Ocultar datos evaluados" : "Ver datos evaluados y todas las evidencias"}
    </button>
    <div id={detailsId} hidden={!expanded}>
      <div className="comparison-table-wrap" tabIndex={0} role="region" aria-label="Comparación de los datos de ambas fichas">
        <table className="comparison-table"><thead><tr><th>Dato evaluado</th><th>{comparison.a.name} · #{comparison.a.id}</th><th>{comparison.b.name} · #{comparison.b.id}</th><th>Resultado y aporte</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td data-label={`${comparison.a.name} · #${comparison.a.id}`}>{row.a.join(" · ") || "Ver evidencias"}</td><td data-label={`${comparison.b.name} · #${comparison.b.id}`}>{row.b.join(" · ") || "Ver evidencias"}</td>
            <td data-label="Resultado">{STATUS[row.status]} · {formatIdentityPoints(score === 0 ? 0 : row.points)}/{row.maximum}<p>{row.explanation}</p></td></tr>)}</tbody>
        </table>
      </div>
      {[comparison.a, comparison.b].map((person) => <section className="comparison-full-side" key={person.id}>
        <h4>Datos y evidencia de {person.name} · #{person.id}</h4>
        <p>Nacimiento: {person.birthDate ?? "Sin dato"} · Fallecimiento: {person.deathDate ?? "Sin dato registrado"}</p>
        {person.chronology ? <p>Cronología contrastada: nacimiento {person.chronology.birthYear ?? "sin comprobar"}; años de actividad {person.chronology.activeYears.join(", ") || "sin datos fechados"}; créditos que exigen estar vivo {person.chronology.aliveOnlyYears.join(", ") || "sin datos fechados"}.</p> : null}
        {person.aliases.length ? <p>Alias: {person.aliases.join(", ")}</p> : null}
        {person.projects.length ? <ul className="comparison-projects">{person.projects.map((project, index) => <li key={index}>
          <strong>{project.name}{project.album ? ` · ${project.album}` : ""}</strong>
          <p>{project.year ?? "Año sin dato"} · {project.role || "Función sin dato"}</p>
          <p>Comprobación web: proyecto {project.checks?.project ? "sí" : "sin comprobar"}{project.album ? `; disco ${project.checks?.album ? "sí" : "sin comprobar"}` : ""}; año {project.checks?.year ? "sí" : "sin comprobar"}; función {project.checks?.role ? "sí" : "sin comprobar"}.</p>
          <CitationList evidence={project.evidence} />
        </li>)}</ul> : <p>No hay créditos ni membresías para contrastar.</p>}
        {person.missing.length ? <><h4>Datos pendientes</h4><ul>{person.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
      </section>)}
      <section><h4>Prueba que conecta ambas trayectorias</h4><CitationList evidence={comparison.bridge} /></section>
      <p>Los datos ausentes y las diferencias de repertorio no prueban que sean personas distintas. El puntaje mide respaldo disponible; la conclusión requiere pruebas de identidad o una contradicción documentada.</p>
    </div>
  </div>;
}
