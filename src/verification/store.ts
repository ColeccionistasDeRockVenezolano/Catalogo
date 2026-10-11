import { inventoryVerification } from "../evidence/verification-inventory.js";
import { withOperatorRun } from "../merge/operator.js";
import {queueVerificationImages} from "./image-curation.js";
import { notFound } from "../api/http-errors.js";
import { getPool } from "../db/client.js";
import { evaluateVerification, snapshotHash } from "./evaluate.js";
import { loadVerificationSnapshot } from "./snapshot.js";
import { researchStored } from "./research-state.js";
import { RULES_VERSION } from "./proof.js";
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
export async function saveIndividualVerification(report:VerificationReport,operator:string):Promise<number> {
  await queueVerificationImages(report,operator);
  const saved=await withOperatorRun({name:"verification:inventory",operator,note:"Conservar hallazgos de investigación automática sin declarar revisión editorial"},async context=>{
    const {rows}=await context.client.query<{id:string}>("INSERT INTO ingest.entity_verification_reports(entity_kind,entity_id,snapshot_hash,report,requested_by) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id::text",[report.kind,report.entityId,report.snapshotHash,JSON.stringify(report),operator]);
    await inventoryVerification(context,report);
    return Number(rows[0]!.id);
  });
  return saved.result;
}
interface JobRow {id:string;entity_kind:VerificationKind;entity_id:string;status:VerificationJob["status"];error:string|null;requested_at:string;finished_at:string|null;progress:VerificationProgress|null;}
const JOB_COLUMNS="id::text,entity_kind,entity_id::text,status,error,requested_at::text,finished_at::text,progress";
function job(row:JobRow):VerificationJob {return {id:Number(row.id),kind:row.entity_kind,entityId:Number(row.entity_id),status:row.status,error:row.error,requestedAt:row.requested_at,finishedAt:row.finished_at,progress:row.progress};}
export async function getIndividualJob(id:number):Promise<VerificationJob|null> {
  const {rows}=await getPool().query<JobRow>(`SELECT ${JOB_COLUMNS} FROM ingest.entity_verification_jobs WHERE id=$1`,[id]);return rows[0]?job(rows[0]):null;
}
export async function latestIndividualJob(kind:VerificationKind,id:number):Promise<VerificationJob|null> {
  const {rows}=await getPool().query<JobRow>(`SELECT ${JOB_COLUMNS} FROM ingest.entity_verification_jobs WHERE entity_kind=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1`,[kind,id]);return rows[0]?job(rows[0]):null;
}
export async function activeIndividualJob(kind:VerificationKind,id:number):Promise<VerificationJob|null> {
  const {rows}=await getPool().query<JobRow>(`SELECT ${JOB_COLUMNS} FROM ingest.entity_verification_jobs WHERE entity_kind=$1 AND entity_id=$2 AND status IN ('queued','running')`,[kind,id]);return rows[0]?job(rows[0]):null;
}
export async function recoverIndividualJobs():Promise<void> {
  await getPool().query("UPDATE ingest.entity_verification_jobs SET status='failed',error='La investigación fue interrumpida al reiniciar la API. Vuelve a intentarlo.',finished_at=now() WHERE status IN ('queued','running')");
}
export async function startIndividualVerification(kind:VerificationKind,id:number,operator:string,
  work:VerificationWork=async(k,i,notify)=>researchStored(await loadVerificationSnapshot(k,i),undefined,undefined,notify)):Promise<VerificationJob> {
  const table={person:"persons",artist:"artists",album:"albums"}[kind];
  const exists=await getPool().query(`SELECT id FROM public.${table} WHERE id=$1`,[id]);
  if(!exists.rows.length)throw notFound(kind,id);
  const current=await activeIndividualJob(kind,id);if(current)return current;
  let created:VerificationJob;
  try {
    const {rows}=await getPool().query<JobRow>(`INSERT INTO ingest.entity_verification_jobs(entity_kind,entity_id,requested_by,status) VALUES($1,$2,$3,'queued') RETURNING ${JOB_COLUMNS}`,[kind,id,operator]);created=job(rows[0]!);
  }catch(error){if((error as {code?:string}).code==="23505"){const active=await activeIndividualJob(kind,id);if(active)return active;}throw error;}
  void runJob(created,operator,work);
  return created;
}
type VerificationWork=(kind:VerificationKind,id:number,notify:(progress:VerificationProgress,checkpoint?:VerificationReport)=>Promise<void>)=>Promise<VerificationReport>;
async function runJob(created:VerificationJob,operator:string,work:VerificationWork):Promise<void> {
  try {
    await getPool().query("UPDATE ingest.entity_verification_jobs SET status='running',started_at=now() WHERE id=$1",[created.id]);
    // Serializa persistencia: un lote anterior nunca pisa un progreso más reciente.
    let writes=Promise.resolve();
    const notify=(progress:VerificationProgress,checkpoint?:VerificationReport)=>{
      writes=writes.then(async()=>{await getPool().query("UPDATE ingest.entity_verification_jobs SET progress=$2::jsonb,checkpoint=COALESCE($3::jsonb,checkpoint) WHERE id=$1 AND status='running'",[created.id,JSON.stringify(progress),checkpoint?JSON.stringify(checkpoint):null]);});
      return writes;
    };
    const report=await work(created.kind,created.entityId,notify);
    await writes;
    const reportId=await saveIndividualVerification(report,operator);
    await getPool().query("UPDATE ingest.entity_verification_jobs SET status='done',report_id=$2,checkpoint=NULL,progress=CASE WHEN progress IS NULL THEN NULL ELSE jsonb_set(progress,'{phase}','\"done\"'::jsonb) END,finished_at=now() WHERE id=$1",[created.id,reportId]);
  }catch(error){await getPool().query("UPDATE ingest.entity_verification_jobs SET status='failed',error=$2,finished_at=now() WHERE id=$1",[created.id,error instanceof Error?error.message.slice(0,500):"No se pudo verificar la ficha."]).catch(()=>undefined);}
}
