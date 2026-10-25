import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { searchApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { ErrorState } from "./StateViews";

const objectNames: Record<string,string> = {artist:"Artista",album:"Disco",track:"Pista",recording:"Grabación",edition:"Edición",audiovisual:"Audiovisual",genre:"Género"};
const stateNames: Record<string,string> = {affirmed:"Afirmado",negated:"Negado",hypothetical:"Hipotético",conditional:"Condicional",quoted:"Citado",possible_irony:"Posible ironía",corrected:"Corregido",withdrawn:"Retirado",uncertain:"Incierto",approved:"Aprobada",rejected:"Rechazada"};
const blockerNames: Record<string,string> = { editorial_decision_required: "Falta decisión editorial", identity_unresolved: "Identidad pendiente", assertion_requires_review: "Enunciado incierto o atribuido a otra voz", absence_without_scope_coverage: "No hay cobertura para acreditar ausencia", activity_without_specific_evidence: "Falta evidencia específica de actividad", energy_method_required: "Requiere perceived-energy-v1", evaluation_only_no_attribute: "Valoración sin atributo musical", catalog_identity_changed:"La identidad cambió; volver a resolver el vínculo",source_identity_withdrawn:"El vínculo documental o la verificación de fuente se retiró",comparison_aspect_required:"Precisar el aspecto de parecido",comparison_reference_unresolved:"La referencia de parecido necesita resolver su identidad",existing_energy_controls_required:"Aprobar energía en los controles de contextos existentes" };
export function SearchKnowledgeReview({ id, onClose }: { id:number; onClose:()=>void }) {
  const {data,loading,error,reload} = useAsync(signal=>searchApi.knowledgeReview(id,signal),[id]);
  const [status,setStatus] = useState<""|"approved"|"rejected"|"withdrawn">("");
  const [reason,setReason]=useState(""),[version,setVersion]=useState(""),[justification,setJustification]=useState(""),[quote,setQuote]=useState("");
  const [basis,setBasis]=useState<"attributed_description"|"documented_fact"|"authorized_listening">("attributed_description");
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState<string|null>(null),[saved,setSaved]=useState<string|null>(null);
  if(loading)return <p role="status">Cargando afirmación…</p>;
  if(error)return <ErrorState message={error} onRetry={reload}/>;
  if(!data)return null;
  const blocked=data.blockers.some(b=>b!=="editorial_decision_required");
  async function submit(event:FormEvent) {
    event.preventDefault();if(!data||!status||saving)return;
    setSaving(true);setSaveError(null);setSaved(null);
    try {
      const result=await searchApi.decideKnowledge(id,{unitKey:data.unitKey,expectedRevision:data.revision,status,reason,
        publicQuote:status==="approved"?quote:null,criterion:status==="approved"?{version,basis,justification}:null});
      setSaved(`Decisión guardada. Revisión ${result.result.revision}.`);setStatus("");reload();
    }catch(e){setSaveError(e instanceof Error?e.message:"No se pudo guardar la decisión");}
    finally{setSaving(false);}
  }
  return <section className="search-admin__review" aria-labelledby="knowledge-review-title">
    <button className="btn" onClick={onClose}>Volver al conocimiento</button>
    <h2 id="knowledge-review-title">Revisar afirmación #{id}</h2>
    <p>{data.object.name} · {objectNames[data.object.kind]??data.object.kind} · revisión {data.revision}. Versión: {data.object.version??"desconocida"}.</p>
    <dl><dt>Afirmación y estado</dt><dd>{data.assertion.aspect}: {data.assertion.value} · {stateNames[data.assertion.state]??data.assertion.state}</dd><dt>Observación de la fuente</dt><dd><blockquote>{data.observation.quote}</blockquote>{data.observation.source&&<a href={data.observation.source} target="_blank" rel="noreferrer">Consultar fuente</a>}</dd><dt>Interpretación</dt><dd>{data.analysis.interpretation}</dd><dt>Alternativa</dt><dd>{data.analysis.alternative}</dd><dt>Incertidumbre</dt><dd>{data.analysis.uncertainty}</dd></dl>
    <ul>{data.blockers.map(b=><li key={b}>{blockerNames[b]??b}</li>)}</ul>
    {data.decision&&<p>Decisión vigente: {stateNames[data.decision.status]??data.decision.status} · {data.decision.actor}. {data.decision.reason}</p>}
    {!!data.interpretations?.length&&<details><summary>Propuestas Laya ({data.interpretations.length})</summary>{data.interpretations.map((item,index)=><div key={`${item.modelRevision}:${index}`}><p>{item.model} · preguntas {item.questionVersion}. Probabilidades sin calibración musical.</p><ul>{Object.entries(item.decisions).map(([question,answer])=><li key={question}>{question}: {answer.choice}</li>)}</ul></div>)}</details>}
    <form onSubmit={submit}>
      <label htmlFor="knowledge-decision">Decisión</label>
      <select id="knowledge-decision" value={status} onChange={e=>setStatus(e.target.value as typeof status)} required disabled={saving}>
        <option value="">Seleccionar decisión</option><option value="approved" disabled={blocked}>Aprobar publicación atribuida</option><option value="rejected">Rechazar propuesta</option><option value="withdrawn">Retirar publicación</option>
      </select>
      <label htmlFor="knowledge-reason">Motivo</label><textarea id="knowledge-reason" value={reason} onChange={e=>setReason(e.target.value)} required maxLength={1500} disabled={saving}/>
      {status==="approved"&&<>
        <label htmlFor="knowledge-criterion">Versión del criterio</label><input id="knowledge-criterion" value={version} onChange={e=>setVersion(e.target.value)} required maxLength={1500} disabled={saving}/>
        <label htmlFor="knowledge-basis">Base de la revisión</label><select id="knowledge-basis" value={basis} onChange={e=>setBasis(e.target.value as typeof basis)} disabled={saving}><option value="attributed_description">Descripción atribuida</option><option value="documented_fact">Hecho documentado</option><option value="authorized_listening">Escucha específica autorizada</option></select>
        <label htmlFor="knowledge-justification">Soporte del criterio en este objeto</label><textarea id="knowledge-justification" value={justification} onChange={e=>setJustification(e.target.value)} required maxLength={1500} disabled={saving}/>
        <label htmlFor="knowledge-quote">Fragmento exacto para publicar</label><textarea id="knowledge-quote" value={quote} onChange={e=>setQuote(e.target.value)} required maxLength={500} disabled={saving}/>
        <p>La cita debe estar contenida en la observación y conservar las condiciones de escucha. La aprobación conserva este alcance.</p>
      </>}
      <button className="btn" type="submit" disabled={saving||!status||!reason.trim()}>{saving?"Guardando…":"Guardar decisión"}</button>
      {saveError&&<><p role="alert">{saveError}</p><button className="btn" type="button" onClick={reload}>Actualizar afirmación</button></>}{saved&&<p role="status">{saved}</p>}
    </form>
    <p><Link to="/historial">Abrir historial y deshacer</Link></p>
  </section>;
}
