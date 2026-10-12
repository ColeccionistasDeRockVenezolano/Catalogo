import {useEffect,useRef,useState,useId} from "react";
import {entityVerificationApi} from "../lib/api";
import {VerificationReportDetails} from "./VerificationReportDetails";
import type {VerificationHistory as History,VerificationJob,VerificationKind,VerificationReport} from "../../../src/verification/types";

export function VerificationHistory({kind,id,busy,revision,onStarted}:{kind:VerificationKind;id:number;busy:boolean;revision:unknown;onStarted:(job:VerificationJob)=>void}){
 const [open,setOpen]=useState(false),[history,setHistory]=useState<History|null>(null),[selected,setSelected]=useState<number|null>(null),[report,setReport]=useState<VerificationReport|null>(null),[loading,setLoading]=useState(false),[starting,setStarting]=useState(false),[error,setError]=useState<string|null>(null);
 const request=useRef(0);
 const selectId=useId();
 useEffect(()=>{
  const version=++request.current;setHistory(null);setSelected(null);setReport(null);setError(null);setStarting(false);
  if(!open){setLoading(false);return;}
  setLoading(true);
  void entityVerificationApi.versions(kind,id).then(value=>{if(version===request.current)setHistory(value);}).catch(cause=>{if(version===request.current)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(version===request.current)setLoading(false);});
  return()=>{request.current++;};
 },[kind,id,open,revision]);
 async function select(versionId:number){
  const version=++request.current;setSelected(versionId);setReport(null);setError(null);setLoading(true);
  try{const value=await entityVerificationApi.version(kind,id,versionId);if(version===request.current)setReport(value);}
  catch(cause){if(version===request.current)setError(cause instanceof Error?cause.message:String(cause));}
  finally{if(version===request.current)setLoading(false);}
 }
 async function more(){
  if(!history?.nextBeforeId||loading)return;
  const version=++request.current;setLoading(true);setError(null);
  try{const value=await entityVerificationApi.versions(kind,id,history.nextBeforeId);if(version===request.current)setHistory({versions:[...history.versions,...value.versions],nextBeforeId:value.nextBeforeId});}
  catch(cause){if(version===request.current)setError(cause instanceof Error?cause.message:String(cause));}
  finally{if(version===request.current)setLoading(false);}
 }
 async function reprocess(){
  if(selected===null||busy||starting)return;
  const version=request.current;setStarting(true);setError(null);
  try{const job=await entityVerificationApi.reprocess(kind,id,selected);if(version===request.current)onStarted(job);}
  catch(cause){if(version===request.current)setError(cause instanceof Error?cause.message:String(cause));}
  finally{if(version===request.current)setStarting(false);}
 }
 const entry=history?.versions.find(version=>version.id===selected);
 return <details className="verification-tools" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Versiones anteriores y copias preservadas</summary>
  {open?<div>
   <p>Abre un informe anterior o vuelve a evaluar sus copias contra la ficha actual. El reprocesamiento conserva el informe original y crea otra versión.</p>
   {history?.versions.length?<div className="field"><label htmlFor={selectId}>Informe anterior</label><select id={selectId} value={selected??""} onChange={event=>{if(event.target.value)void select(Number(event.target.value));else{request.current++;setSelected(null);setReport(null);setLoading(false);}}}>
    <option value="">Seleccionar una versión</option>
    {history.versions.map(version=><option key={version.id} value={version.id}>{new Date(version.createdAt).toLocaleString("es-VE")} · #{version.id} · {version.sourceCount} fuentes · {version.complete?"lectura completa":"informe parcial"}</option>)}
   </select></div>:history?<p>No hay informes guardados todavía.</p>:null}
   {history?.nextBeforeId?<button className="btn btn--sm" type="button" disabled={loading} onClick={()=>void more()}>Cargar versiones más antiguas</button>:null}
   {loading?<p role="status">Cargando la versión preservada…</p>:null}
   {error?<p role="alert">{error}</p>:null}
   {entry?<div>
    <p>Guardado por {entry.requestedBy}. {entry.unavailableReason??"Las fuentes de esta versión están preservadas."}</p>
    <button type="button" className="btn" disabled={busy||starting||!entry.reprocessAvailable} onClick={()=>void reprocess()}>{starting?"Preparando reprocesamiento…":"Reprocesar copias preservadas"}</button>
   </div>:null}
   {report?<div aria-label="Informe de la versión anterior">
    <p>Versión del {new Date(report.createdAt).toLocaleString("es-VE")}.{report.stale?" La ficha o las reglas cambiaron; su puntaje ya no está vigente.":""}</p>
    <VerificationReportDetails key={selected} report={report}/>
   </div>:null}
  </div>:null}
 </details>;
}
