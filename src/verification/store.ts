import { randomUUID } from "node:crypto";
import { getEnv } from "../config/env.js";
import { badRequest } from "../api/http-errors.js";
import type { ResearchOptions } from "./research.js";
import { inventoryVerification } from "../evidence/verification-inventory.js";
import { withOperatorRun } from "../merge/operator.js";
import {queueVerificationImages} from "./image-curation.js";
import { notFound } from "../api/http-errors.js";
import { getPool } from "../db/client.js";
import { evaluateVerification, snapshotHash } from "./evaluate.js";
import { loadVerificationSnapshot } from "./snapshot.js";
import { researchStored } from "./research-state.js";
import { RULES_VERSION } from "./proof.js";
import type {ResearchState} from "./research.js";
import {preservedReportState,resetPreservedEvaluation,getVerificationVersion} from "./history.js";
import type { VerificationJob, VerificationKind, VerificationReport, VerificationProgress } from "./types.js";

export async function getIndividualVerification(kind:VerificationKind,id:number):Promise<VerificationReport> {
  const snapshot=await loadVerificationSnapshot(kind,id);
  const {rows}=await getPool().query<{report:VerificationReport}>("SELECT report FROM ingest.entity_verification_reports WHERE entity_kind=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1",[kind,id]);
  const running=await getPool().query<{checkpoint:VerificationReport|null}>("SELECT checkpoint FROM ingest.entity_verification_jobs WHERE entity_kind=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1",[kind,id]);
  const checkpoint=running.rows[0]?.checkpoint,saved=rows[0]?.report;
  const report=checkpoint&&(!saved||new Date(checkpoint.createdAt)>=new Date(saved.createdAt))?checkpoint:saved;
  if(!report)return evaluateVerification(snapshot,[]);
  if(report.snapshotHash===snapshotHash(snapshot)&&report.rulesVersion===RULES_VERSION)return report;
  return {...report,stale:true,score:null,limitations:[...report.limitations,"La ficha o las reglas de evaluación cambiaron. Vuelve a verificar para obtener un puntaje vigente."]};
}
export async function saveIndividualVerification(report:VerificationReport,operator:string,finish?:{jobId:number;owner:string;status:VerificationJob["status"]}):Promise<number> {
  const saved=await withOperatorRun({name:"verification:inventory",operator,note:"Conservar hallazgos de investigación automática sin declarar revisión editorial"},async context=>{
    let status=finish?.status;
    if(finish){
      const locked=await context.client.query<{control_signal:"continue"|"paused"|"cancelled"}>("SELECT control_signal FROM ingest.entity_verification_jobs WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now() FOR UPDATE",[finish.jobId,finish.owner]);
      if(!locked.rows[0])throw new VerificationLeaseLost("El proceso perdió la propiedad del trabajo; no se publica un informe ni candidatos.");
      if(locked.rows[0].control_signal!=="continue")status=locked.rows[0].control_signal;
    }
    await queueVerificationImages(report,operator,context);
    const {rows}=await context.client.query<{id:string}>("INSERT INTO ingest.entity_verification_reports(entity_kind,entity_id,snapshot_hash,report,requested_by) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id::text",[report.kind,report.entityId,report.snapshotHash,JSON.stringify(report),operator]);
    await inventoryVerification(context,report);
    if(finish)await context.client.query("UPDATE ingest.entity_verification_jobs SET status=$2,report_id=$3,checkpoint=NULL,lease_owner=NULL,lease_expires_at=NULL,progress=CASE WHEN progress IS NULL OR $2<>'done' THEN progress ELSE jsonb_set(progress,'{phase}','\"done\"'::jsonb) END,finished_at=now() WHERE id=$1",[finish.jobId,status,Number(rows[0]!.id)]);
    return Number(rows[0]!.id);
  });
  return saved.result;
}
interface JobRow {research_version_id:string|null;id:string;entity_kind:VerificationKind;entity_id:string;status:VerificationJob["status"];error:string|null;requested_at:string;finished_at:string|null;progress:VerificationProgress|null;control_signal:NonNullable<VerificationJob["control"]>;budget:NonNullable<VerificationJob["budget"]>;source_report_id:string|null;resume_from_job_id:string|null;report_id:string|null;preserved_only:boolean;}
const JOB_COLUMNS="research_version_id::text,id::text,entity_kind,entity_id::text,status,error,requested_at::text,finished_at::text,progress,control_signal,budget,source_report_id::text,resume_from_job_id::text,report_id::text,preserved_only";
function job(row:JobRow):VerificationJob {return {...(row.research_version_id?{researchVersionId:Number(row.research_version_id)}:{}),id:Number(row.id),kind:row.entity_kind,entityId:Number(row.entity_id),status:row.status,error:row.error,requestedAt:row.requested_at,finishedAt:row.finished_at,progress:row.progress,control:row.control_signal,budget:row.budget,preservedOnly:row.preserved_only,...(row.source_report_id?{sourceReportId:Number(row.source_report_id)}:{}),...(row.resume_from_job_id?{resumeFromJobId:Number(row.resume_from_job_id)}:{}),...(row.report_id?{reportId:Number(row.report_id)}:{})};}
export async function getIndividualJob(id:number):Promise<VerificationJob|null> {
  const {rows}=await getPool().query<JobRow>(`SELECT ${JOB_COLUMNS} FROM ingest.entity_verification_jobs WHERE id=$1`,[id]);return rows[0]?job(rows[0]):null;
}
export async function latestIndividualJob(kind:VerificationKind,id:number):Promise<VerificationJob|null> {
  const {rows}=await getPool().query<JobRow>(`SELECT ${JOB_COLUMNS} FROM ingest.entity_verification_jobs WHERE entity_kind=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1`,[kind,id]);return rows[0]?job(rows[0]):null;
}
export async function activeIndividualJob(kind:VerificationKind,id:number):Promise<VerificationJob|null> {
  const {rows}=await getPool().query<JobRow>(`SELECT ${JOB_COLUMNS} FROM ingest.entity_verification_jobs WHERE entity_kind=$1 AND entity_id=$2 AND status IN ('queued','running')`,[kind,id]);return rows[0]?job(rows[0]):null;
}
const workerId=randomUUID();
class VerificationLeaseLost extends Error {}
export async function recoverIndividualJobs():Promise<void> {
  // A different API process's healthy job remains owned by that process.
  await getPool().query("UPDATE ingest.entity_verification_jobs SET status='paused',control_signal='paused',error='La investigación fue interrumpida; sus resultados se conservan para reanudar.',finished_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE status IN ('queued','running') AND (lease_expires_at IS NULL OR lease_expires_at<now())");
}
export async function startIndividualVerification(kind:VerificationKind,id:number,operator:string,
  work:VerificationWork=defaultWork,budget:NonNullable<VerificationJob["budget"]>={},source:{sourceReportId?:number;resumeFromJobId?:number;preservedOnly?:boolean}={}):Promise<VerificationJob> {
  const table={person:"persons",artist:"artists",album:"albums"}[kind];
  const exists=await getPool().query(`SELECT id FROM public.${table} WHERE id=$1`,[id]);
  if(!exists.rows.length)throw notFound(kind,id);
  const current=await activeIndividualJob(kind,id);if(current){if(source.sourceReportId&&source.sourceReportId!==current.sourceReportId)throw badRequest("Ya hay una investigación en curso; espera o páusala antes de reprocesar otra versión.");return current;}
  let created:VerificationJob;
  try {
    const {rows}=await getPool().query<JobRow>(`INSERT INTO ingest.entity_verification_jobs(entity_kind,entity_id,requested_by,status,lease_owner,lease_expires_at,budget,source_report_id,resume_from_job_id,preserved_only)
      VALUES($1,$2,$3,'queued',$4,now()+($5::int*interval '1 second'),$6::jsonb,$7,$8,$9) RETURNING ${JOB_COLUMNS}`,
      [kind,id,operator,workerId,getEnv().CRV_RESEARCH_LEASE_SECONDS,JSON.stringify({maxCalls:getEnv().CRV_RESEARCH_MAX_CALLS,maxTokens:getEnv().CRV_RESEARCH_MAX_TOKENS,...budget}),source.sourceReportId??null,source.resumeFromJobId??null,source.preservedOnly??false]);created=job(rows[0]!);
  }catch(error){if((error as {code?:string}).code==="23505"){const active=await activeIndividualJob(kind,id);if(active)return active;}throw error;}
  void runJob(created,operator,work);
  return created;
}
export type VerificationWork=(kind:VerificationKind,id:number,notify:(progress:VerificationProgress,checkpoint?:VerificationReport)=>Promise<void>,options:ResearchOptions)=>Promise<VerificationReport>;
const defaultWork:VerificationWork=async(k,i,notify,options)=>researchStored(await loadVerificationSnapshot(k,i),undefined,undefined,notify,options);
export async function reprocessIndividualVerification(kind:VerificationKind,id:number,versionId:number,operator:string,budget:NonNullable<VerificationJob["budget"]>={},work:VerificationWork=defaultWork):Promise<VerificationJob>{
  const state=await preservedReportState(kind,id,versionId);
  if(!state.pages.length)throw badRequest("Esta versión no contiene fuentes preservadas para reprocesar.");
  return startIndividualVerification(kind,id,operator,work,budget,{sourceReportId:versionId,preservedOnly:true});
}

/** A resume starts a new execution/version using the preserved research checkpoint. */
export async function controlIndividualVerification(id:number,action:"pause"|"resume"|"cancel",operator:string,budget:NonNullable<VerificationJob["budget"]>={},work:VerificationWork=defaultWork):Promise<VerificationJob> {
  const current=await getIndividualJob(id);if(!current)throw notFound("investigación",id);
  if(action==="resume"){
    if(current.status==="queued"||current.status==="running"){
      if(current.control!=="continue")throw badRequest("La pausa o cancelación todavía está guardando el checkpoint. Espera a que termine antes de reanudar.");
      return current;
    }
    if(!["paused","partial","failed"].includes(current.status))throw badRequest("Este trabajo no tiene una ejecución pendiente que reanudar.");
    return startIndividualVerification(current.kind,current.entityId,operator,work,{...current.budget,...budget},{...(current.sourceReportId?{sourceReportId:current.sourceReportId}:{}),resumeFromJobId:current.id,preservedOnly:current.preservedOnly??false});
  }
  if(!["queued","running"].includes(current.status)){
    if(action==="cancel"&&["paused","partial","failed"].includes(current.status)){
      await getPool().query("UPDATE ingest.entity_verification_jobs SET status='cancelled',control_signal='cancelled',finished_at=now() WHERE id=$1 AND status IN ('paused','partial','failed')",[id]);
      return (await getIndividualJob(id))!;
    }
    throw badRequest("El trabajo ya no está en ejecución.");
  }
  await getPool().query("UPDATE ingest.entity_verification_jobs SET control_signal=$2 WHERE id=$1 AND status IN ('queued','running')",[id,action==="pause"?"paused":"cancelled"]);
  return (await getIndividualJob(id))!;
}
async function runJob(created:VerificationJob,operator:string,work:VerificationWork):Promise<void> {
  const leaseSeconds=getEnv().CRV_RESEARCH_LEASE_SECONDS;
  let heartbeat:ReturnType<typeof setInterval>|undefined;
  try {
    const acquired=await getPool().query("UPDATE ingest.entity_verification_jobs SET status='running',started_at=now() WHERE id=$1 AND status='queued' AND lease_owner=$2 RETURNING id",[created.id,workerId]);
    if(!acquired.rowCount)return;
    heartbeat=setInterval(()=>{
      void getPool().query("UPDATE ingest.entity_verification_jobs SET lease_expires_at=now()+($3::int*interval '1 second') WHERE id=$1 AND lease_owner=$2 AND status='running'",[created.id,workerId,leaseSeconds]).catch(()=>undefined);
    },Math.floor(leaseSeconds*1000/3));
    heartbeat.unref();
    const control=async()=>{
      const result=await getPool().query<{control_signal:"continue"|"paused"|"cancelled"}>("SELECT control_signal FROM ingest.entity_verification_jobs WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now()",[created.id,workerId]);
      if(!result.rows[0])throw new VerificationLeaseLost("El proceso ya no posee el trabajo; se conserva el checkpoint vigente.");
      return result.rows[0].control_signal;
    };
    let writes=Promise.resolve();
    const notify=(progress:VerificationProgress,checkpoint?:VerificationReport)=>{
      writes=writes.then(async()=>{
        const updated=await getPool().query("UPDATE ingest.entity_verification_jobs SET progress=$3::jsonb,checkpoint=COALESCE($4::jsonb,checkpoint) WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now() RETURNING id",
          [created.id,workerId,JSON.stringify(progress),checkpoint?JSON.stringify(checkpoint):null]);
        if(!updated.rowCount)throw new VerificationLeaseLost("Se perdió la propiedad del trabajo.");
      });
      return writes;
    };
    const options:ResearchOptions={control,preservedOnly:created.preservedOnly??false,checkpointFence:{jobId:created.id,owner:workerId},budget:{maxCalls:created.budget?.maxCalls??getEnv().CRV_RESEARCH_MAX_CALLS,maxTokens:created.budget?.maxTokens??getEnv().CRV_RESEARCH_MAX_TOKENS}};
    const previous=created.resumeFromJobId?await getIndividualJob(created.resumeFromJobId):null;
    const seed=previous?.reportId??created.sourceReportId;
    if(previous?.researchVersionId){
      const saved=(await getPool().query<{state:ResearchState;snapshot_hash:string}>("SELECT state,snapshot_hash FROM ingest.entity_verification_research_versions WHERE id=$1 AND entity_kind=$2 AND entity_id=$3",[previous.researchVersionId,created.kind,created.entityId])).rows[0];
      if(!saved)throw badRequest("No se conserva el checkpoint de esta ejecución para reanudar.");
      const snapshot=await loadVerificationSnapshot(created.kind,created.entityId);
      options.resume=saved.snapshot_hash===snapshotHash(snapshot)&&saved.state.rulesVersion===RULES_VERSION?saved.state:resetPreservedEvaluation(saved.state,snapshot,true);
      options.parentVersionId=previous.researchVersionId;
    }else if(seed){
      const state=await preservedReportState(created.kind,created.entityId,seed);
      const original=await getVerificationVersion(created.kind,created.entityId,seed);
      options.resume=previous&&!original.stale?state:resetPreservedEvaluation(state,await loadVerificationSnapshot(created.kind,created.entityId),!!previous);
      if(original.researchVersionId)options.parentVersionId=original.researchVersionId;
    }
    const report=await work(created.kind,created.entityId,notify,options);
    await writes;
    const signal=await control();
    const status=signal!=="continue"?signal:report.research?.stopReason==="cancelled"?"cancelled":report.research?.stopReason==="paused"?"paused":report.evaluation?.complete===false?"partial":"done";
    await saveIndividualVerification(report,operator,{jobId:created.id,owner:workerId,status});
  }catch(error){
    if(!(error instanceof VerificationLeaseLost))await getPool().query("UPDATE ingest.entity_verification_jobs SET status='failed',error=$3,finished_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2 AND status IN ('queued','running')",[created.id,workerId,error instanceof Error?error.message.slice(0,500):"No se pudo verificar la ficha."]).catch(()=>undefined);
  }finally{if(heartbeat)clearInterval(heartbeat);}
}
