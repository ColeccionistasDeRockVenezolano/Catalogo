import { useState } from "react";
import { Link } from "react-router-dom";
import { searchApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { ErrorState } from "./StateViews";

const aspects: Record<string,string> = { instruments_roles:"Instrumentos y roles",timbre:"Timbre",rhythm:"Ritmo",form:"Forma",voice:"Voz",production:"Producción" };
const frequencies: Record<string,string> = {defining:"Definitorio",frequent:"Frecuente",variable:"Variable"};
const categoryKinds: Record<string,string> = {genre_style:"Género o estilo",stylistic_umbrella:"Familia de estilos",regional_tradition:"Tradición regional",regional_umbrella:"Familia regional",functional_category:"Categoría funcional",thematic_category:"Categoría temática",ensemble_format:"Formación musical",musical_feature:"Característica musical",performance_practice:"Práctica interpretativa"};
const inputChanges: Record<string,string> = {new_source:"Fuente nueva",changed_capture:"Captura cambiada",reprocessed_capture:"Nueva extracción de la misma captura"};
const relations: Record<string,string> = {equivalence:"Equivalencia propuesta",specialization:"Especialización propuesta",partial:"Relación parcial",pending:"Pendiente"};
const scopes: Record<string,string> = {listener:"oyente y condiciones",artist:"artista",album:"álbum",track:"pista",recording:"grabación",edition:"edición"};
const names: Record<string,string> = { pending:"Pendiente", running:"Procesando", review:"En revisión", failed:"Fallido", open:"Abierto", in_progress:"En curso", reuse_candidate:"Reutilización propuesta", defer:"Diferido", review_required:"Requiere revisión", reuse:"Reutilizar", refine:"Precisar", propose_attribute:"Proponer atributo", propose_relation:"Proponer relación", reject:"Rechazar" };
export function SearchKnowledgePanel({ feeding = false }: { feeding?: boolean }) {
  const { data, loading, error, reload } = useAsync(signal => searchApi.knowledge(signal), []);
  const [filter, setFilter] = useState("");
  const [genrePage, setGenrePage] = useState(0);
  if (loading) return <p role="status">Cargando conocimiento y lotes…</p>;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  if (feeding) return <>
    <h3>Lotes de conocimiento</h3>
    <p>Se procesan capturas nuevas o cambiadas. Cada afirmación conserva su caso en la cola de revisión.</p>
    {!data.feed.available && <p>La alimentación requiere aplicar la migración 0086. No hay un proceso nuevo activo.</p>}
    {data.feed.available && !data.feed.jobs.length && <p>Aún no hay lotes recibidos. El inventario de capturas no crea asignaciones.</p>}
    {!!data.feed.jobs.length && <div className="search-admin__table" role="region" aria-label="Lotes de conocimiento" tabIndex={0}><table><thead><tr><th>Lote y fuente</th><th>Estado</th><th>Extraídas / entradas</th><th>Interpretadas</th><th>Pendientes</th><th>Aprobadas</th><th>Rechazadas / retiradas</th><th>Publicadas</th><th>Reintentos</th><th>Último cambio</th></tr></thead><tbody>{data.feed.jobs.map(job => <tr key={job.id}><td>#{job.id} · {job.resourceId}{job.inputChange && <><br />{inputChanges[job.inputChange]}</>}</td><td>{names[job.state] ?? job.state}{job.errorCode && " · requiere reintento"}</td><td>{job.cursor} / {job.total}</td><td>{job.interpreted??0}</td><td>{job.pending??0}</td><td>{job.approved??0}</td><td>{job.rejected??0} / {job.withdrawn??0}</td><td>{job.published??0}</td><td>{job.attempts}</td><td>{new Date(job.updatedAt).toLocaleString("es")}</td></tr>)}</tbody></table></div>}
    {!!data.feed.cases.length && <><h3>Afirmaciones pendientes</h3><ul>{data.feed.cases.map(row => <li key={row.id}><Link to={`/administrar/buscador?seccion=Conocimiento&revision=${row.sourceReviewId??row.id}`}>Revisar {row.annotationId}</Link> · {row.aspect} · {names[row.status] ?? row.status}{row.caseType==="search_knowledge_model_conflict"&&<> · <Link to={`/curaduria/revision/${row.id}`}>Contradicción del modelo</Link></>}</li>)}</ul></>}
    <p>Resolver un caso conserva la revisión. Las asignaciones se aprueban mediante los controles editoriales existentes.</p>
  </>;
  if (!data.available) return <p>Falta generar el inventario de conocimiento. Las propuestas anteriores conservan su estado.</p>;
  const genres = data.genres!, vocabulary = data.vocabulary!;
  const needle = filter.toLocaleLowerCase("es");
  const filteredGenres = genres.rows.filter(g=>`${g.name} ${g.slug}`.toLocaleLowerCase("es").includes(needle));
  return <>
    <p>Género, actividad, emoción, energía, ambiente y temática mantienen sus propios criterios. La evidencia se conserva en el objeto que describe.</p>
    <h3>Mapa de géneros y estilos</h3>
    <p>{genres.existingDescriptions} descripciones del catálogo y {genres.documentedProposals} propuestas documentadas. {genres.excluded ? <>{genres.excluded} quedan fuera del mapa por decisión editorial, por falta de fuente. </> : null}{genres.total - genres.described - (genres.excluded ?? 0)} de {genres.total} categorías siguen sin descripción. Los rasgos de una categoría no se asignan a sus canciones.</p>
    {genres.sourceStatus !== "available" && <p>La base no estuvo disponible al generar el inventario. Esta lectura es histórica.</p>}
    <label htmlFor="knowledge-filter">Filtrar géneros y conceptos</label>
    <input id="knowledge-filter" className="search-admin__filter" type="search" value={filter} onChange={e=>{setFilter(e.target.value);setGenrePage(0);}} />
    <div className="search-admin__table search-admin__table--genres" role="region" aria-label="Cobertura de géneros" tabIndex={0}><table><thead><tr><th>Género</th><th>Descripción y documentación</th></tr></thead><tbody>{filteredGenres.slice(genrePage * 20, genrePage * 20 + 20).map(g=><tr key={g.id}><td>{g.name}</td><td>{g.status === "documented_proposal" && <strong>Propuesta · </strong>}{g.exclusion ? <><strong>Fuera del mapa</strong> · decisión de {g.exclusion.decidedBy}: {g.exclusion.reason}</> : g.description ?? "Pendiente de documentación"}{!!g.sources?.length && <details><summary>Ver rasgos, alcance y fuentes</summary>{g.proposedDefinition !== g.description && <p>Definición propuesta: {g.proposedDefinition}</p>}{g.categoryKind && <p><strong>Tipo de categoría:</strong> {categoryKinds[g.categoryKind]??g.categoryKind}.</p>}{g.profileLimits && <p>{g.profileLimits}</p>}{g.scope && <p>{g.scope.historical} {g.scope.geographical}</p>}<ul>{g.characteristics.map((trait,index)=><li key={index}><strong>{aspects[trait.aspect]} · {frequencies[trait.frequency]}:</strong> {trait.description}{!!trait.exceptions.length && <> Excepciones: {trait.exceptions.join("; ")}</>} Fuentes: {trait.sources.map(id=><a key={id} href={g.sources.find(s=>s.id===id)?.url} target="_blank" rel="noreferrer">Fuente {g.sources.findIndex(s=>s.id===id)+1} </a>)}</li>)}</ul>{!!g.missingAspects.length && <p>Sin documentar: {g.missingAspects.map(a=>aspects[a]).join(", ")}.</p>}<ul>{g.sources.map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.attribution}</a> · {source.locator}</li>)}</ul></details>}</td></tr>)}</tbody></table></div>
    <div className="search-admin__pagination"><button className="btn" disabled={genrePage === 0} onClick={()=>setGenrePage(p=>p-1)}>Anterior</button><span role="status">{filteredGenres.length ? genrePage * 20 + 1 : 0}–{Math.min(genrePage * 20 + 20, filteredGenres.length)} de {filteredGenres.length}</span><button className="btn" disabled={(genrePage + 1) * 20 >= filteredGenres.length} onClick={()=>setGenrePage(p=>p+1)}>Siguiente</button></div>
    {data.mappings && <section aria-label="Correspondencias RYM"><h3>Correspondencias RYM–CRV</h3><p>{data.mappings.coverage.uniqueTerms} términos revisados en {data.mappings.coverage.observations} apariciones. Son propuestas analíticas; conservan las asignaciones humanas y no amplían consultas.</p>{data.mappings.rows.filter(m=>`${m.originalTerm} ${m.targetSlug??""}`.toLocaleLowerCase("es").includes(needle)).map((m,index)=><details key={`${m.source}-${m.originalLevel}-${index}`}><summary>{m.originalTerm} → {m.targetSlug ?? "Sin destino"} · {relations[m.relation]}</summary><p>{m.rationale}</p><p>Nivel de origen: {m.originalLevel === "primary" ? "principal" : "secundario"}. <a href={m.source} target="_blank" rel="noreferrer">Publicación RYM</a></p>{m.aliasWarning && <p>{m.aliasWarning}</p>}{!!m.definitionReferences.length && <p>Contraste terminológico: {m.definitionReferences.map((url,i)=><a key={url} href={url} target="_blank" rel="noreferrer">Fuente {i+1} </a>)}</p>}</details>)}</section>}
    <h3>Diccionario y facetas</h3>
    <p>{vocabulary.concepts.length} conceptos y {vocabulary.facets.length} familias conservan definición y sinónimos. {vocabulary.coverage ? `Hay ${vocabulary.coverage.analyticalDispositions} disposiciones analíticas revisadas; siguen pendientes la validación musical independiente y las decisiones editoriales.` : "Las propuestas siguen pendientes de validación musical."}</p>
    {[...vocabulary.concepts.map(c=>({id:c.id,title:c.label,aliases:c.aliases,definition:c.definition,reason:c.reason,disposition:c.disposition,semanticReview:c.semanticReview})),...vocabulary.facets.map(f=>({...f,title:f.aliases[0]??f.id}))].filter(c=>`${c.title} ${c.aliases.join(" ")}`.toLocaleLowerCase("es").includes(needle)).map(c=><details key={c.id}><summary>{c.title} · {names[c.disposition] ?? c.disposition}</summary><p>{c.definition}</p><p>Expresiones: {c.aliases.join("; ")}. {c.reason}</p>{c.semanticReview && <>
      <p><strong>Criterio de uso:</strong> {c.semanticReview.assignmentCriterion}</p>
      <p><strong>Ámbito:</strong> {c.semanticReview.scope.map(scope=>scopes[scope]??scope).join("; ")}.</p>
      <p><strong>No confundir con:</strong> {c.semanticReview.falseFriends.join("; ")}.</p>
      {!!c.semanticReview.aliasRules.filter(a=>a.usage==="context_required").length && <p><strong>Expresiones que necesitan contexto:</strong> {c.semanticReview.aliasRules.filter(a=>a.usage==="context_required").map(a=>a.term).join("; ")}.</p>}
      <p>Revisión analítica de {c.semanticReview.reviewer}. Motivación: {c.semanticReview.motivation.map(m=>m.id).join(", ")}.{!!c.semanticReview.annotationRefs.length && <> Contrastes: {c.semanticReview.annotationRefs.join(", ")}.</>} Sin aprobación editorial ni asignaciones automáticas.</p>
    </>}</details>)}
    {data.study && <><h3>Reseñas y evaluación</h3><p>{data.study.pages} páginas capturadas, {data.study.releases} publicaciones; {data.study.multiPageEligible} con al menos dos páginas útiles. {data.study.reserved} publicaciones reservadas para contraste posterior.</p><p>Evaluación independiente: pendiente. El muestreo de extremos no permite estimar mayorías. Las identidades CRV y ediciones pendientes requieren revisión.</p></>}
    <Link to="/administrar/buscador?seccion=Emociones">Abrir decisiones de etiquetas existentes</Link>
  </>;
}
