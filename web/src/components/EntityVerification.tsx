import { isDocumentarilyScored } from "../../../src/verification/types";
import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { MagnifyingGlass, CaretDown, CaretUp, ArrowClockwise } from "@phosphor-icons/react";
import { VerificationReportDetails } from "./VerificationReportDetails";
import { ScoreRing } from "./ScoreRing";
import { useEntityToolDraft } from "../lib/entityToolDraft";
import { EntityComparison } from "./EntityComparison";
import { PersonArtistResolution } from "./PersonArtistResolution";
import { entityVerificationApi } from "../lib/api";
import type { VerificationFinding, VerificationKind, VerificationReport, VerificationJob } from "../../../src/verification/types";

const STATUS = {confirmed:"Comprobado",partial:"Respaldo parcial",contradicted:"Incoherencia",missing:"Falta en la ficha",unverified:"Sin verificar"};
export function EntityVerification({kind,id,revision,onChanged}:{kind:VerificationKind;id:number;revision:unknown;onChanged?:()=>void}) {
  const [comparisonRefresh,setComparisonRefresh]=useState(0);
  const reloadVerification=useCallback(()=>setComparisonRefresh(v=>v+1),[]);
  const [report,setReport]=useState<VerificationReport|null>(null);
  type Draft={open:boolean;details:boolean;filter:"all"|VerificationFinding["status"]};
  const [draft,setDraft]=useEntityToolDraft<Draft>(`verify.${kind}.${id}`,{open:false,details:false,filter:"all"},(v):v is Draft=>Boolean(v&&typeof v==="object"&&typeof (v as Draft).open==="boolean"&&typeof (v as Draft).details==="boolean"&&["all",...Object.keys(STATUS)].includes((v as Draft).filter)));
  const {open,filter}=draft;
  const [job,setJob]=useState<VerificationJob|null>(null);
  const [jobId,setJobId]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const panelId=useId();const detailId=useId();
  useEffect(()=>{
    let active=true;
    setLoading(true);setReport(null);setError(null);setJobId(null);setBusy(false);setJob(null);
    void Promise.all([entityVerificationApi.get(kind,id),entityVerificationApi.latest(kind,id)]).then(([saved,job])=>{
      if(!active)return;setReport(saved);setJob(job);
      const running=job?.status==="queued"||job?.status==="running";
      setJobId(running?job.id:null);setBusy(running);
      if(job?.status==="failed")setError(job.error??"La investigación fue interrumpida. Vuelve a intentarlo.");
    }).catch((cause:unknown)=>{if(active)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[kind,id,revision,comparisonRefresh]);
  useEffect(()=>{
    if(jobId===null)return;
    let active=true;let polling=false;let lastEvaluated=-1;
    const poll=async()=>{
      if(polling)return;polling=true;
      try {
        const job=await entityVerificationApi.job(jobId);
        if(!active)return;
        setJob(job);
        if(job.status==="queued"||job.status==="running"){
          if(job.progress?.evaluated&&job.progress.evaluated!==lastEvaluated){const saved=await entityVerificationApi.get(kind,id);if(active){setReport(saved);lastEvaluated=job.progress.evaluated;}}
          return;
        }
        if(job.status==="failed"){setJobId(null);setBusy(false);setError(job.error??"No se pudo verificar. Vuelve a intentarlo.");return;}
        const saved=await entityVerificationApi.get(kind,id);
        if(active){setReport(saved);setJobId(null);setBusy(false);setError(null);}
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:String(cause));}
      finally{polling=false;}
    };
    void poll();const timer=window.setInterval(()=>void poll(),2500);
    return()=>{active=false;window.clearInterval(timer);};
  },[jobId,kind,id]);
  async function investigate(){
    setBusy(true);setDraft({...draft,open:true});setError(null);
    try{const job=await entityVerificationApi.start(kind,id);setJob(job);setJobId(job.id);}
    catch(cause){setBusy(false);setError(cause instanceof Error?cause.message:String(cause));}
  }
  const counts={confirmed:0,partial:0,contradicted:0,missing:0,unverified:0};
  for(const item of report?.findings??[])counts[item.status]++;
  return <section className="entity-verification section" aria-label="Fiabilidad de la ficha">
    <div className="entity-verification__header">
      <div><h2>Fiabilidad de la ficha</h2><p>{loading ? 'Cargando el informe…' : !report?.researched ? 'Comprueba los datos con fuentes antes de corregirlos.' : `${counts.contradicted + counts.partial + counts.missing} datos con discrepancias, respaldo parcial o información faltante.`}</p></div>
      <ScoreRing score={report?.stale?null:report?.score??null} pending={busy} label={report?.stale?"Desactualizado":(report?.inProgress||report?.evaluation?.complete===false)?(busy?"Puntaje provisional":"Informe parcial"):report?.score!==null&&report?.score!==undefined?"Respaldo documental":report?.researched?"Sin datos contrastados":"Pendiente"}/>
    </div>
    <div className="entity-verification__actions page-actions">
      <button type="button" className={`btn${report?.researched ? ' btn--primary' : ''}`} aria-expanded={open} aria-controls={panelId} onClick={()=>setDraft({...draft,open:!open,details:true})}>{open?<CaretUp size={16} aria-hidden="true"/>:<CaretDown size={16} aria-hidden="true"/>}{open?"Ocultar informe":"Ver informe y datos pendientes"}</button>
      <Link className="btn" to={`/curaduria/ia?kind=${kind}&id=${id}&prepare=1`}>Revisar cambios sugeridos por IA</Link>
      {!report?.researched ? <button type="button" className="btn btn--primary" disabled={busy||loading} onClick={()=>void investigate()}><MagnifyingGlass size={16} aria-hidden="true"/>{busy?"Verificación en curso":"Verificar con fuentes"}</button> : null}
    </div>
    <p className="entity-verification__muted verification-action-hint">La IA convierte los hallazgos en correcciones. Acepta o rechaza cada cambio; se aplica al aceptarlo.</p>
    {kind==='person'?<PersonArtistResolution personId={id} disabled={busy||loading} onChanged={()=>{reloadVerification();onChanged?.();}}/>:null}
    <details className="verification-tools"><summary>Más herramientas: verificar y comparar</summary>
      <div className="page-actions">
        {report?.researched ? <button type="button" className="btn" disabled={busy||loading} onClick={()=>void investigate()}><MagnifyingGlass size={16} aria-hidden="true"/>{busy?"Verificación en curso":"Volver a verificar con fuentes"}</button> : null}
        <EntityComparison key={`${kind}:${id}`} source={{kind,id}} revision={revision} onUpdated={reloadVerification} />
      </div>
    </details>
    {error?<p role="alert">{error} Puedes volver a intentarlo.</p>:null}
    {busy&&job?<ResearchProgress job={job}/>:null}
    {busy||error?<button type="button" className="btn btn--sm" onClick={reloadVerification}><ArrowClockwise size={14} aria-hidden="true"/>Actualizar estado</button>:null}
    <div id={panelId} hidden={!open}>
      {!report&&!error?<p role="status">Cargando los datos de la ficha…</p>:null}
      {report?<>
        {report.stale?<p className="alert-block" role="status">La ficha o las reglas de evaluación cambiaron. El informe anterior conserva sus citas, pero su puntaje no está vigente. Vuelve a verificarla.</p>:null}
        {report.inProgress||report.evaluation?.complete===false?<p role="status">Informe parcial: incluye el respaldo de los lotes procesados. Los demás datos siguen pendientes y el puntaje puede cambiar.</p>:null}
        {!report.researched&&!busy?<p>Estos son los datos registrados y las incoherencias internas detectadas. Inicia la verificación para contrastarlos con fuentes externas y obtener un puntaje.</p>:report.researched?<p>Guardado el {new Date(report.createdAt).toLocaleString("es-VE")}. {report.evaluation?`${report.evaluation.processed} de ${report.evaluation.total} datos procesados. `:""}{report.sources.length} referencias obtenidas.</p>:null}
        <p className="entity-verification__counts" aria-label="Filtrar datos evaluados por estado">{Object.entries(counts).map(([key,count])=><button type="button" key={key} data-status={key} aria-pressed={filter===key} onClick={()=>setDraft({...draft,open:true,details:true,filter:key as VerificationFinding["status"]})}><strong className="mono">{count}</strong><span>{STATUS[key as keyof typeof STATUS]}</span></button>)}</p>
        <details className="verification-score-help"><summary>Cómo interpretar el puntaje</summary><p>El puntaje mide el respaldo de los datos contrastados. Los datos faltantes y sin verificar quedan fuera del cálculo.</p><p>{report.findings.filter(isDocumentarilyScored).length} datos considerados · {report.findings.filter(f=>!isDocumentarilyScored(f)).length} fuera del cálculo.</p></details>
        <div id={detailId} hidden={!open} className="entity-verification__details">
          <VerificationReportDetails report={report} status={filter} onStatusChange={value=>setDraft({...draft,filter:value})}/>
        </div>
      </>:null}
    </div>
  </section>;
}
function ResearchProgress({job}:{job:VerificationJob}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),10000);return()=>window.clearInterval(timer);},[]);
  const p=job.progress;
  const elapsed=Math.max(0,Math.floor((now-new Date(job.requestedAt).getTime())/60000));
  const slow=p&&now-new Date(p.updatedAt).getTime()>120000;
  const title=job.status==="queued"?"En cola":!p?"Investigación en curso":p.phase==="collecting"?"Consultando fuentes":p.phase==="evaluating"?"Contrastando los datos":p.phase==="saving"?"Guardando el informe":"Verificación completada";
  const percent=p&&p.total?Math.min(100,Math.round(p.completed/p.total*100)):null;
  return <div className="entity-verification__progress" role="status" aria-live="polite">
    <div><strong>{title}</strong><span className="mono">{percent!==null?`${percent} % de esta etapa` : "Preparando…"}</span></div>
    <progress max={p?.total||100} value={p?.total?p.completed:undefined} aria-label={title}/>
    <p>{p?`${p.sources} fuentes obtenidas · ${p.evaluated} de ${p.totalUnits} datos procesados${p.phase==="collecting"?` · ${p.completed} de ${p.total} consultas terminadas`:""}`:"Esta investigación comenzó antes de incorporar el seguimiento por etapas."}{elapsed?` · ${elapsed} min transcurridos`:""}</p>
    {slow?<p>La consulta actual está tardando. El avance guardado se conserva; puedes actualizar el estado.</p>:null}
    <p>Puedes salir de la ficha. El avance y las evidencias se guardan para administradores.</p>
  </div>;
}
