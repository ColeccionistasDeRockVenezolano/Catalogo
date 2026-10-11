import { sourceDates } from "../lib/sourceDates";
import { VerificationReportDetails } from "./VerificationReportDetails";
import { useCallback, useEffect, useId, useState } from "react";
import { ArrowsLeftRight, CaretDown, CaretUp, MagnifyingGlass } from "@phosphor-icons/react";
import { useEntityToolDraft } from "../lib/entityToolDraft";
import { Link } from "react-router-dom";
import { entityComparisonApi, searchApi } from "../lib/api";
import type { SearchHit } from "../lib/types";
import type { ComparisonReport, ComparisonSide, EntityRef } from "../../../src/verification/comparison-types";
import type { ComparisonHistoryItem } from "../../../src/verification/comparison-store";
import type { VerificationReport } from "../../../src/verification/types";

const KIND={artist:"Artista",person:"Persona",album:"Álbum"};
const PATH={artist:"artistas",person:"personas",album:"discos"};
const CONCLUSION={same_identity:"Evidencia de una misma identidad",related:"Fichas relacionadas",distinct:"Separación documentada",inconclusive:"Evidencia insuficiente"};
const STATUS={match:"Coincide",partial:"Coincidencia parcial",different:"Valores diferentes",missing:"Faltan datos"};
const number=new Intl.NumberFormat("es-VE",{maximumFractionDigits:1});
const same=(a:EntityRef,b:EntityRef)=>a.kind===b.kind&&a.id===b.id;

export function EntityComparison({source,revision,onUpdated}:{source:EntityRef;revision:unknown;onUpdated:()=>void}) {
  type Draft={open:boolean;kind:EntityRef["kind"];query:string;selected:{ref:EntityRef;name:string}|null};
  const [draft,setDraft]=useEntityToolDraft<Draft>(`compare.${source.kind}.${source.id}`,{open:false,kind:source.kind==="album"?"album":source.kind==="artist"?"person":"artist",query:"",selected:null},(value):value is Draft=>{
    if(!value||typeof value!=="object")return false;
    const v=value as Draft;
    return typeof v.open==="boolean"&&typeof v.query==="string"&&v.query.length<=250&&(source.kind==="album"?v.kind==="album":v.kind==="person"||v.kind==="artist")&&(v.selected===null||Boolean(v.selected&&typeof v.selected.name==="string"&&v.selected.ref?.kind===v.kind&&Number.isSafeInteger(v.selected.ref.id)&&v.selected.ref.id>0&&!same(source,v.selected.ref)));
  });
  const {open,kind,query,selected}=draft;
  const [hits,setHits]=useState<SearchHit[]>([]);
  const [searching,setSearching]=useState(false);const [error,setError]=useState<string|null>(null);
  const [history,setHistory]=useState<ComparisonHistoryItem[]>([]);const [refresh,setRefresh]=useState(0);
  const sourceKind=source.kind,sourceId=source.id;
  const refreshHistory=useCallback(()=>{setRefresh(v=>v+1);},[]);
  const researchSaved=useCallback(()=>{refreshHistory();onUpdated();},[refreshHistory,onUpdated]);
  const panelId=useId(),inputId=useId(),typeId=useId();
  useEffect(()=>{
    if(!open)return;let active=true;
    void entityComparisonApi.history({kind:sourceKind,id:sourceId}).then(items=>{if(active)setHistory(items);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>{active=false;};
  },[open,sourceKind,sourceId,refresh]);
  useEffect(()=>{
    setHits([]);setError(null);setSearching(false);
    if(!open||query.trim().length<2)return;
    setSearching(true);
    let active=true;const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      void searchApi.search(query.trim(),[kind],20,controller.signal).then(result=>{
        if(active)setHits(result[kind].filter(hit=>!same({kind:sourceKind,id:sourceId},{kind,id:hit.id})));
      }).catch(cause=>{if(active&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(active)setSearching(false);});
    },250);
    return()=>{active=false;controller.abort();window.clearTimeout(timer);};
  },[query,kind,open,sourceKind,sourceId]);
  return <div className="entity-comparison">
    <button type="button" className="btn btn--sm" aria-expanded={open} aria-controls={panelId} onClick={()=>setDraft({...draft,open:!open})}><ArrowsLeftRight size={14} aria-hidden="true"/>{open?"Ocultar comparación":"Comparar con otra ficha"}</button>
    <div id={panelId} hidden={!open}>
      <h3>Comparar esta ficha</h3>
      <p>{source.kind==="album"?"Busca otro álbum para contrastar el lanzamiento, la edición, los créditos y las pistas.":"Busca una persona o un artista para contrastar identidad y trayectoria. Una membresía establece un vínculo; un solista puede corresponder a una persona."}</p>
      <div className="entity-comparison__search">
        {source.kind!=="album"?<label className="field" htmlFor={typeId}>Tipo de ficha<select id={typeId} value={kind} onChange={event=>{setDraft({...draft,kind:event.target.value as EntityRef["kind"],query:"",selected:null});}}><option value="person">Personas</option><option value="artist">Artistas</option></select></label>:null}
        <label className="field" htmlFor={inputId}>Buscar {KIND[kind].toLowerCase()}<input id={inputId} type="search" value={query} placeholder={kind==="album"?"Título o alias del álbum":"Nombre o alias"} onChange={event=>setDraft({...draft,query:event.target.value.slice(0,250)})}/></label>
      </div>
      {error?<p role="alert">{error}</p>:null}
      {searching?<p role="status">Buscando fichas…</p>:null}
      {!searching&&query.trim().length>=2&&!hits.length&&!error?<p role="status">No se encontraron otras fichas. Prueba otro nombre o alias.</p>:null}
      {hits.length?<ul className="entity-comparison__choices" aria-label="Resultados para comparar">{hits.map(hit=><li key={`${hit.type}:${hit.id}`}><button type="button" aria-pressed={selected?.ref.id===hit.id&&selected.ref.kind===kind} onClick={()=>{setDraft({...draft,selected:{ref:{kind,id:hit.id},name:hit.label}});}}><strong>{hit.label}</strong><span>{KIND[kind]} · #{hit.id}{hit.context?` · ${hit.context}`:""}</span></button></li>)}</ul>:null}
      {history.length?<details className="entity-comparison__history"><summary>Comparaciones guardadas ({history.length})</summary><ul className="entity-comparison__choices">{history.map(item=><li key={`${item.target.kind}:${item.target.id}`}><button type="button" onClick={()=>{setDraft({...draft,kind:item.target.kind,selected:{ref:item.target,name:item.name},query:""});}}><strong>{item.name}</strong><span>{KIND[item.target.kind]} · #{item.target.id} · {item.status==="running"||item.status==="queued"?"Investigando…":item.status==="failed"?"Investigación interrumpida; puedes retomarla":"Informe guardado"}</span></button></li>)}</ul></details>:null}
      {selected?<ComparisonResult key={`${source.kind}:${source.id}:${selected.ref.kind}:${selected.ref.id}`} source={source} target={selected} revision={revision} onSaved={researchSaved}/>:null}
    </div>
  </div>;
}
function ComparisonResult({source,target,revision,onSaved}:{source:EntityRef;target:{ref:EntityRef;name:string};revision:unknown;onSaved:()=>void}) {
  const sourceKind=source.kind,sourceId=source.id,targetKind=target.ref.kind,targetId=target.ref.id;
  const [report,setReport]=useState<ComparisonReport|null>(null);const [jobId,setJobId]=useState<number|null>(null);
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [details,setDetails]=useState(false);
  const [error,setError]=useState<string|null>(null);const detailId=useId();
  useEffect(()=>{
    let active=true;setLoading(true);setReport(null);setJobId(null);setBusy(false);setError(null);
    void Promise.all([entityComparisonApi.get({kind:sourceKind,id:sourceId},{kind:targetKind,id:targetId}),entityComparisonApi.active({kind:sourceKind,id:sourceId},{kind:targetKind,id:targetId})]).then(([saved,job])=>{
      if(active){setReport(saved);setJobId(job?.id??null);setBusy(Boolean(job));}
    }).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[sourceKind,sourceId,targetKind,targetId,revision]);
  useEffect(()=>{
    if(jobId===null)return;let active=true,polling=false;
    const poll=async()=>{
      if(polling)return;polling=true;
      try {
        const job=await entityComparisonApi.job(jobId);
        if(!active||job.status==="queued"||job.status==="running")return;
        if(job.status==="failed"){setBusy(false);setJobId(null);setError(job.error??"No se pudo investigar. Vuelve a intentarlo.");return;}
        const saved=await entityComparisonApi.get({kind:sourceKind,id:sourceId},{kind:targetKind,id:targetId});
        if(active){setReport(saved);setJobId(null);setBusy(false);setError(null);onSaved();}
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:String(cause));}finally{polling=false;}
    };
    void poll();const timer=window.setInterval(()=>void poll(),2500);return()=>{active=false;window.clearInterval(timer);};
  },[jobId,sourceKind,sourceId,targetKind,targetId,onSaved]);
  async function investigate(){
    setBusy(true);setError(null);
    try {const job=await entityComparisonApi.start(source,target.ref);setJobId(job.id);onSaved();}
    catch(cause){setBusy(false);setError(cause instanceof Error?cause.message:String(cause));}
  }
  const reversed=report&&!same(report.left,source);
  const left=report?(reversed?report.right:report.left):null;
  const right=report?(reversed?report.left:report.right):null;
  return <section className="entity-comparison__result" aria-label="Resultado de comparación">
    <h4>Esta ficha ↔ <Link to={`/${PATH[target.ref.kind]}/${target.ref.id}`}>{target.name}</Link></h4>
    <button type="button" className="btn btn--sm" disabled={busy||loading} onClick={()=>void investigate()}><MagnifyingGlass size={14} aria-hidden="true"/>{busy?"Investigando ambas fichas…":report?.researched?"Volver a investigar y comparar":"Investigar ambas fichas y comparar"}</button>
    {error?<p role="alert">{error} Puedes volver a intentarlo.</p>:null}
    {busy?<p role="status">La comparación continúa en segundo plano. El informe de ambas fichas y sus evidencias quedará guardado; puedes recuperarlo desde cualquiera de las dos.</p>:null}
    {loading?<p role="status">Cargando comparación…</p>:null}
    {report&&left&&right?<>
      {report.stale?<p className="alert-block">Las fichas o las reglas de evaluación cambiaron. Se muestra la comparación anterior, sin puntaje vigente. Vuelve a investigar ambas fichas.</p>:null}
      <div className="entity-comparison__verdict" role="status"><strong>{report.stale?"Informe desactualizado":CONCLUSION[report.conclusion]}</strong><span className="mono">{report.score===null?"Sin puntaje de correspondencia":`${number.format(report.score)}/100 de correspondencia`}</span></div>
      <p>{report.explanation}</p>
      {!report.researched?<p>El contraste inicial muestra los datos registrados. Investiga ambas fichas para comprobar las fuentes y obtener una conclusión documental.</p>:<p>Guardado el {new Date(report.createdAt).toLocaleString("es-VE")}. Datos cruzados: {number.format(report.catalogPoints)}/40 · Evidencia conjunta de identidad: {number.format(report.webPoints)}/60.</p>}
      <p>{report.rows.filter(r=>r.status==="match").length} coincidencias · {report.rows.filter(r=>r.status==="partial").length} parciales · {report.rows.filter(r=>r.status==="different").length} diferencias · {report.rows.filter(r=>r.status==="missing").length} campos con datos faltantes.</p>
      {report.evidence.length?<details className="verification-browser__group"><summary>Evidencia conjunta · {report.evidence.length} citas</summary><EvidenceList evidence={report.evidence}/></details>:null}
      <button type="button" className="btn btn--sm" aria-expanded={details} aria-controls={detailId} onClick={()=>setDetails(v=>!v)}>{details?<CaretUp size={14} aria-hidden="true"/>:<CaretDown size={14} aria-hidden="true"/>}{details?"Ocultar datos comparados":"Ver datos comparados e investigaciones de ambas fichas"}</button>
      <div id={detailId} hidden={!details} className="entity-comparison__details">
        <div className="entity-comparison__rows">{report.rows.map(row=><details className="verification-browser__group" key={row.key}><summary><strong>{row.label}</strong><span>{STATUS[row.status]} · {number.format(row.points)}/{row.maximum}</span></summary><div className="entity-comparison__sides"><div><strong>{left.name} · {KIND[left.kind]}</strong><ValueList values={reversed?row.right:row.left}/></div><div><strong>{right.name} · {KIND[right.kind]}</strong><ValueList values={reversed?row.left:row.right}/></div></div><p>{row.explanation}</p></details>)}</div>
        <div className="entity-comparison__sides"><SideResearch side={left}/><SideResearch side={right}/></div>
        <details className="verification-browser__group"><summary>Cómo interpretar el resultado</summary><ul>{report.limitations.map(item=><li key={item}>{item}</li>)}</ul></details>
      </div>
    </>:null}
  </section>;
}
function ValueList({values}:{values:string[]}) {return values.length?<ul>{values.map((v,i)=><li key={`${i}:${v}`}>{v}</li>)}</ul>:<p>Sin dato registrado</p>;}
function EvidenceList({evidence}:{evidence:ComparisonReport["evidence"]}) {return <ul className="entity-comparison__evidence">{evidence.map((e,i)=><li key={`${e.url}:${i}`}><a href={e.url} target="_blank" rel="noreferrer">{e.title}</a><blockquote>{e.quote}</blockquote><small>{e.origin==="page"?"Página leída":"Resumen del buscador"} · {sourceDates(e)}</small></li>)}</ul>;}
function SideResearch({side}:{side:ComparisonSide}) {
  const report:VerificationReport=side.verification;
  return <details className="entity-comparison__research verification-browser__group" aria-label={`Investigación de ${side.name}`}><summary><strong>Investigación de {side.name}</strong><span>{KIND[side.kind]} · {report.score===null?"sin puntaje":`${number.format(report.score)} % de respaldo`}{report.evaluation?.complete===false||report.inProgress?" · Informe parcial":""}</span></summary><VerificationReportDetails report={report}/></details>;
}
