import { useRef, useState } from "react";
import { claimsApi } from "../lib/api";
import { useOperator } from "../lib/OperatorContext";
import { useAsync } from "../lib/useAsync";
import { fieldLabel } from "../lib/curation";
import { claimReference } from "../lib/provenance";
import type { Claim, EntityKind } from "../lib/types";
import { Pagination } from "./Pagination";

const LIMIT = 15;
const STATUS: Record<string, string> = {
  accepted: "Aceptado", candidate: "Pendiente", rejected: "Rechazado",
  conflict: "En conflicto", superseded: "Reemplazado",
};
const ACTOR: Record<string, string> = { human: "Edición manual", ai: "IA", system: "Importación / sistema" };
const CONFIDENCE: Record<string, string> = { high: "Alta", medium: "Media", low: "Baja", api: "API" };

function ClaimValue({ claim }: { claim: Claim }) {
  const value = claim.normalizedValue ?? claim.rawValue;
  const text = value === null || value === undefined ? "Sin valor"
    : typeof value === "boolean" ? value ? "Sí" : "No"
      : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  return text.length > 240 ? (
    <details className="entity-provenance__value"><summary>Ver valor completo</summary><pre>{text}</pre></details>
  ) : <p className="entity-provenance__value">{text}</p>;
}

export function EntityProvenance(props: { entity: EntityKind; id: number; revision?: unknown }) {
  const { isAdmin } = useOperator();
  return isAdmin ? <EntityProvenanceContent key={`${props.entity}:${props.id}`} {...props} /> : null;
}

function EntityProvenanceContent({ entity, id, revision }: { entity: EntityKind; id: number; revision?: unknown }) {
  const start = useRef<HTMLElement>(null);
  const [offset, setOffset] = useState(0);
  const { data, loading, error, reload } = useAsync(
    () => claimsApi.forEntity(entity, id, { limit: LIMIT, offset }), [entity, id, offset, revision],
  );

  return (
    <section ref={start} className="section entity-provenance pagination-start" aria-label="Origen de los datos">
      <h2>Origen de los datos</h2>
      <p className="entity-provenance__intro">Fuentes y aportes registrados para cada campo. Una ficha puede reunir varias fuentes; un aporte aceptado puede haber cambiado después.</p>
      {loading ? <p role="status">Cargando fuentes…</p>
        : error ? <div role="alert"><p className="form-error-banner">{error}</p><button type="button" className="btn btn--sm" onClick={reload}>Reintentar</button></div>
          : !data?.data.length ? <p className="etabs__empty">No hay fuentes registradas para esta ficha. Su origen no puede determinarse con la evidencia disponible.</p>
            : <>
              <ul className="entity-provenance__list">
                {data.data.map((claim) => {
                  const reference = claimReference(claim);
                  const excerpts = [...new Set(claim.evidence.map((item) => item.excerpt).filter((text): text is string => Boolean(text)))];
                  return <li key={claim.id} className="entity-provenance__item">
                    <div>
                      <h3>{fieldLabel(claim.field)}</h3>
                      <ClaimValue claim={claim} />
                      <div className="entity-provenance__meta">
                        <span>{STATUS[claim.status] ?? claim.status}</span>
                        <span>Confianza: {CONFIDENCE[claim.confidence] ?? claim.confidence}</span>
                        <time dateTime={claim.createdAt}>{new Date(claim.createdAt).toLocaleString("es-VE")}</time>
                      </div>
                    </div>
                    <div className="entity-provenance__source">
                      <p>Fuente: {reference.url ? <a href={reference.url} target="_blank" rel="noopener noreferrer">{claim.sourceName}</a> : <strong>{claim.sourceName}</strong>}</p>
                      {reference.isSourceHomepage ? <p className="form-note">Enlace general de la fuente; sin página de evidencia registrada.</p> : !reference.url ? <p className="form-note">Sin enlace web registrado.</p> : null}
                      <p className="form-note">{ACTOR[claim.createdBy] ?? claim.createdBy}{claim.seedRowNumber !== null ? ` · Fila ${claim.seedRowNumber} del archivo importado` : ""}</p>
                      {reference.evidenceUrls.length > 1 || excerpts.length > 0 ? <details className="entity-provenance__evidence">
                        <summary>Ver evidencia</summary>
                        {excerpts.map((excerpt, index) => <blockquote key={index}>{excerpt}</blockquote>)}
                        {reference.evidenceUrls.slice(1).map((url, index) => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">Referencia adicional {index + 1}</a></p>)}
                      </details> : null}
                    </div>
                  </li>;
                })}
              </ul>
              {data.pagination.total > LIMIT ? <Pagination scrollTargetRef={start} limit={LIMIT} offset={offset} total={data.pagination.total} onOffsetChange={setOffset} /> : null}
            </>}
    </section>
  );
}
