import { Fragment, useEffect, useRef, useState } from "react";
import type { SearchAdministration } from "../../../src/search/administration";

const fieldStates: Record<string,string> = {reused_existing:"Reutilización existente",extracted_partial:"Extracción parcial",preserved_development:"Antecedente de desarrollo",proposed:"Propuesta analítica",deferred:"Diferido",excluded:"Excluido"};
const resourceStates: Record<string,string> = {field_review_required:"Campos pendientes de revalidación",partially_extracted:"Extracción parcial; ver campos",mixed_dispositions:"Usos y diferimientos por campo",reviewed_reuse_or_proposal:"Reutilización o propuesta revisada",community_release_context_extracted:"Contexto comunitario de fichas cruzado",withdrawn:"Retirado",excluded:"Excluido",deferred:"Diferido con tarea",development_artifacts_preserved:"Antecedente conservado; revisión musical pendiente",review_extraction_and_development_annotations:"Extracción y anotación de desarrollo",track_ratings_extracted_not_assignments:"Notas por pista extraídas; sin asignación",existing_track_ids_reused:"IDs existentes reutilizados"};

export function ResourceFieldTable({resources}:{resources:SearchAdministration["resources"]}) {
  const [openResource, setOpenResource] = useState<string|null>(null);
  const tableRef = useRef<HTMLDivElement>(null), detailRef = useRef<HTMLElement>(null);
  const origin = useRef<HTMLButtonElement|null>(null);
  useEffect(() => {
    if (!openResource) return;
    tableRef.current?.scrollTo({left:0});
    detailRef.current?.focus({preventScroll:true});
    detailRef.current?.scrollIntoView({block:"nearest",inline:"nearest"});
  }, [openResource]);
  const close = () => { setOpenResource(null); origin.current?.focus(); };
  return <div className="search-admin__table" ref={tableRef}>
    <table aria-label="Recursos y campos"><thead><tr><th>Recurso</th><th>Disponibilidad</th><th>Estado</th><th>Etapa y prioridad</th><th>Tarea</th></tr></thead>
      <tbody>{resources.rows.map(row => <Fragment key={row.id}>
        <tr><td>{row.id} · {row.resource}</td><td>{row.availability === "available" ? "Disponible" : "No localizado"}</td>
          <td>{resourceStates[row.status] ?? "Inventariado; revisión pendiente"}</td><td>{row.stagePriority}</td>
          <td>{row.nextTask}{row.fields && <button className="search-admin__resource-toggle" type="button" aria-expanded={openResource===row.id}
            aria-controls={`resource-fields-${row.id}`} onClick={event=>{
              origin.current=event.currentTarget;setOpenResource(openResource===row.id?null:row.id);
            }}>Ver campos de {row.id}</button>}</td></tr>
        {row.fields && <tr id={`resource-fields-${row.id}`} hidden={openResource!==row.id} className="search-admin__resource-detail"><td colSpan={5}>
          {openResource===row.id && <section className="search-admin__resource-panel" aria-label={`Campos de ${row.id}`} tabIndex={-1} ref={detailRef}>
            <h3>{row.id} · {row.resource}</h3>
            <p>Disposiciones analíticas por campo. No autorizan nuevas publicaciones ni acreditan cobertura musical.</p>
            <ul className="search-admin__field-list">{row.fields.map(field=><li key={field.key}>
              <strong>{field.label} · {fieldStates[field.disposition]}</strong>
              <p>Alcance: {field.scope}</p><p>{field.reason}</p><p>Siguiente tarea: {field.nextTask}</p>
              {field.evidenceCount>0 && <p>{field.evidenceCount} referencias verificadas.</p>}
            </li>)}</ul>
            <button className="search-admin__resource-toggle" type="button" onClick={close}>Cerrar campos de {row.id}</button>
          </section>}
        </td></tr>}
      </Fragment>)}</tbody>
    </table>
  </div>;
}
