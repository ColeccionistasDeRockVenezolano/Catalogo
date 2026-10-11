import { sourceDates } from "../lib/sourceDates";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { isDocumentarilyScored } from "../../../src/verification/types";
import type { VerificationFinding, VerificationReport } from "../../../src/verification/types";
import { findingInstruction } from "../../../src/verification/curation";

export const VERIFICATION_STATUS = {confirmed:"Comprobado",partial:"Respaldo parcial",contradicted:"Incoherencia",missing:"Falta en la ficha",unverified:"Sin verificar"};
const number = new Intl.NumberFormat("es-VE",{maximumFractionDigits:1});
const fold = (value:string)=>value.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
const PAGE_SIZE=20;

/** Mantiene toda la evidencia accesible sin desplegar cientos de datos a la vez. */
export function VerificationReportDetails({report,status="all",onStatusChange}:{report:VerificationReport;status?:"all"|VerificationFinding["status"];onStatusChange?:(value:"all"|VerificationFinding["status"])=>void}) {
  const [query,setQuery]=useState("");
  const [localStatus,setLocalStatus]=useState(status);
  const selected=onStatusChange?status:localStatus;
  const searchId=useId();const statusId=useId();
  const filtered=report.findings.filter(f=>(selected==="all"||selected===f.status)&&fold(`${f.label} ${f.value??""} ${f.observed??""} ${f.context.join(" ")}`).includes(fold(query.trim())));
  const pending=new Set(report.evaluation?.pendingKeys??[]);
  const cited=new Set(report.findings.flatMap(f=>f.evidence.map(e=>e.url)));
  return <div className="verification-browser">
    <div className="verification-browser__filters">
      <label className="field" htmlFor={searchId}>Buscar en los datos<input id={searchId} type="search" value={query} placeholder="Persona, disco o pista" onChange={e=>setQuery(e.target.value)}/></label>
      <label className="field" htmlFor={statusId}>Estado<select id={statusId} value={selected} onChange={e=>{const next=e.target.value as typeof selected;setLocalStatus(next);onStatusChange?.(next);}}><option value="all">Todos los datos</option>{Object.entries(VERIFICATION_STATUS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <p className="entity-verification__muted" role="status">{filtered.length} de {report.findings.length} datos. Abre un área y luego un dato para consultar sus citas.</p>
    <div className="verification-browser__areas">
      {report.areas.map(area=>{
        const items=filtered.filter(f=>f.area===area.key);
        if(!items.length)return null;
        return <Disclosure key={`${area.key}:${selected}:${query}`} label={<><strong>{area.label}</strong><span className="mono">{items.length} datos · {report.stale||!report.researched?"Pendiente":area.maximum===0?"Fuera del puntaje":`${number.format(area.points)} / ${number.format(area.maximum)}`}</span></>}>
          {area.maximum>0?<progress max={area.maximum} value={report.stale||!report.researched?0:area.points} aria-label={`Respaldo de ${area.label}`}/>:null}
          <PagedList items={items} name={area.label} render={item=><Finding item={item} pending={pending.has(item.key)} report={report}/>}/>
        </Disclosure>;
      })}
    </div>
    {!filtered.length?<p>No hay datos que coincidan con estos filtros.</p>:null}
    {report.suggestions?.length?<Disclosure label={<><strong>Propuestas por revisar</strong><span>{report.suggestions.length} hallazgos</span></>}><p>Estos hallazgos no reducen el puntaje. La IA puede preparar cada corrección para que la aceptes o rechaces.</p><PagedList items={report.suggestions} name="propuestas" render={item=><Finding item={item} suggestion report={report}/>}/></Disclosure>:null}
    <Disclosure label={<><strong>Fuentes de la investigación</strong><span>{report.sources.length} referencias · {cited.size} citadas</span></>}>
      <p>{report.sources.filter(s=>s.origin==="page").length} páginas legibles · {report.sources.filter(s=>s.origin==="search_snippet").length} resúmenes del buscador. Varias páginas pueden compartir procedencia.</p>
      <PagedList items={report.sources} name="fuentes" render={source=><div className="verification-browser__source"><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title||source.url}</a><small>{source.origin==="page"?"Página leída":"Resumen del buscador"} · {sourceDates(source)}{cited.has(source.url)?" · Citada en el informe":""}</small></div>}/>
    </Disclosure>
    <Disclosure label={<><strong>Cómo se calcula y qué quedó pendiente</strong><span>{report.evaluation?.pendingKeys.length??0} datos pendientes</span></>}>
      {report.evaluation?<p>{report.evaluation.processed} de {report.evaluation.total} datos procesados. {report.evaluation.complete?"Evaluación terminada.":"El informe es parcial. Volver a verificar retoma los datos pendientes."}</p>:null}
      <PagedList items={report.limitations} name="alcance y limitaciones" render={text=><p>{text}</p>}/>
    </Disclosure>
  </div>;
}
function Disclosure({label,children}:{label:ReactNode;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  return <details className="verification-browser__group" onToggle={e=>setOpen(e.currentTarget.open)}><summary>{label}</summary>{open?<div className="verification-browser__content">{children}</div>:null}</details>;
}
function PagedList<T>({items,name,render}:{items:T[];name:string;render:(item:T)=>ReactNode}) {
  const [page,setPage]=useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  function changePage(nextPage: number) {
    setPage(nextPage);
    listRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  const start=page*PAGE_SIZE;const end=Math.min(start+PAGE_SIZE,items.length);
  return <><ul ref={listRef} className="verification-browser__list pagination-start">{items.slice(start,end).map((item,index)=><li key={start+index}>{render(item)}</li>)}</ul>{items.length>PAGE_SIZE?<nav className="verification-browser__pagination" aria-label={`Páginas de ${name}`}><span className="mono">{start+1}–{end} de {items.length}</span><button type="button" className="btn btn--sm" disabled={page===0} onClick={()=>changePage(page-1)}>Anterior</button><button type="button" className="btn btn--sm" disabled={end>=items.length} onClick={()=>changePage(page+1)}>Siguiente</button></nav>:null}</>;
}
function Finding({item,suggestion=false,pending=false,report}:{item:VerificationFinding;suggestion?:boolean;pending?:boolean;report:VerificationReport}) {
  const instruction = findingInstruction(item);
  return <details className="verification-browser__finding" data-status={item.status}><summary><strong>{item.label}</strong><span className="verification-browser__value">{suggestion?item.observed:item.value??"No registrado"}</span><small>{suggestion?"Propuesta":pending?"Pendiente de evaluación":VERIFICATION_STATUS[item.status]}{suggestion||pending?"":isDocumentarilyScored(item)?` · ${number.format(item.coverage*100)} %`:" · Fuera del puntaje"}</small></summary><div className="verification-browser__content">
    <dl><div><dt>Dato en la ficha</dt><dd>{item.value??"No registrado"}</dd></div>{item.observed?<div><dt>{suggestion?"Propuesta encontrada":"Dato respaldado o en discrepancia"}</dt><dd>{item.observed}</dd></div>:null}</dl><p>{item.explanation}</p>{item.context.length?<p className="entity-verification__muted">Contexto: {item.context.join(" · ")}</p>:null}
    {item.evidence.length?<ul className="entity-verification__evidence">{item.evidence.map((e,i)=><li key={`${e.url}:${i}`}><blockquote>«{e.quote}»</blockquote><a href={e.url} target="_blank" rel="noopener noreferrer">{e.title||e.url}</a><small>{e.origin==="page"?"Página leída":"Resumen del buscador"}</small></li>)}</ul>:<p className="entity-verification__muted">Sin cita documental suficiente para este dato.</p>}
    {suggestion || item.status === "missing" || item.status === "contradicted" ? <Link className="btn btn--sm" to={`/curaduria/ia?kind=${report.kind}&id=${report.entityId}&prepare=1&instruction=${encodeURIComponent(instruction)}`}>{item.observed ? "Proponer este cambio con IA" : "Investigar y proponer con IA"}</Link> : null}
  </div></details>;
}
