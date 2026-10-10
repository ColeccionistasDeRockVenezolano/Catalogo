import { RULES_VERSION } from "./proof.js";
import { getPool } from "../db/client.js";
import { evaluateJoint, loadComparisonSide, normalizePair, pairKey, researchComparison } from "./comparison.js";
import type { ComparisonJob, ComparisonReport, EntityRef } from "./comparison-types.js";
export async function getComparison(left:EntityRef,right:EntityRef):Promise<ComparisonReport> {
  const refs=normalizePair(left,right);
  const [l,r]=await Promise.all(refs.map(loadComparisonSide));
  const {rows}=await getPool().query<{report:ComparisonReport}>("SELECT report FROM ingest.entity_comparison_reports WHERE pair_key=$1 ORDER BY id DESC LIMIT 1",[pairKey(left,right)]);
  const saved=rows[0]?.report;
  if(!saved)return evaluateJoint(l!,r!,[]);
  if(saved.left.hash===l!.hash&&saved.right.hash===r!.hash&&saved.left.verification.rulesVersion===RULES_VERSION&&saved.right.verification.rulesVersion===RULES_VERSION)return saved;
  return {...saved,left:{...saved.left,verification:{...saved.left.verification,stale:true,score:null}},right:{...saved.right,verification:{...saved.right.verification,stale:true,score:null}},stale:true,score:null,limitations:[...saved.limitations,"Las fichas o las reglas de evaluación cambiaron. Este informe corresponde a la versión anterior; vuelve a comparar para actualizarlo."]};
}
export async function saveComparison(report:ComparisonReport,operator:string):Promise<number> {
  const {rows}=await getPool().query<{id:string}>("INSERT INTO ingest.entity_comparison_reports(pair_key,report,requested_by) VALUES($1,$2::jsonb,$3) RETURNING id::text",[pairKey(report.left,report.right),JSON.stringify(report),operator]);return Number(rows[0]!.id);
}
interface JobRow {id:string;left_ref:EntityRef;right_ref:EntityRef;status:ComparisonJob["status"];error:string|null;requested_at:string;finished_at:string|null}
const columns="id::text,left_ref,right_ref,status,error,requested_at::text,finished_at::text";
const job=(r:JobRow):ComparisonJob=>({id:Number(r.id),left:r.left_ref,right:r.right_ref,status:r.status,error:r.error,requestedAt:r.requested_at,finishedAt:r.finished_at});
export async function getComparisonJob(id:number):Promise<ComparisonJob|null> {
 const {rows}=await getPool().query<JobRow>(`SELECT ${columns} FROM ingest.entity_comparison_jobs WHERE id=$1`,[id]);return rows[0]?job(rows[0]):null;
}
export async function activeComparisonJob(left:EntityRef,right:EntityRef):Promise<ComparisonJob|null> {
 const {rows}=await getPool().query<JobRow>(`SELECT ${columns} FROM ingest.entity_comparison_jobs WHERE pair_key=$1 AND status IN ('queued','running')`,[pairKey(left,right)]);return rows[0]?job(rows[0]):null;
}
export async function recoverComparisonJobs():Promise<void> {
 await getPool().query("UPDATE ingest.entity_comparison_jobs SET status='failed',error='Comparación interrumpida al reiniciar la API. Vuelve a investigar.',finished_at=now() WHERE status IN ('queued','running')");
}
export async function startComparison(left:EntityRef,right:EntityRef,operator:string,
 work:(left:EntityRef,right:EntityRef,operator:string)=>Promise<ComparisonReport>=async(l,r,o)=>{const sides=await Promise.all([loadComparisonSide(l),loadComparisonSide(r)]);return researchComparison(sides[0]!,sides[1]!,o);}):Promise<ComparisonJob> {
 const refs=normalizePair(left,right);
 // Valida existencia antes de aceptar un trabajo, sin esperar la investigación.
 await Promise.all(refs.map(loadComparisonSide));
 const current=await activeComparisonJob(...refs);if(current)return current;
 let created:ComparisonJob;
 try {const {rows}=await getPool().query<JobRow>(`INSERT INTO ingest.entity_comparison_jobs(pair_key,left_ref,right_ref,requested_by,status) VALUES($1,$2::jsonb,$3::jsonb,$4,'queued') RETURNING ${columns}`,[pairKey(...refs),JSON.stringify(refs[0]),JSON.stringify(refs[1]),operator]);created=job(rows[0]!);}
 catch(error){if((error as {code?:string}).code==="23505"){const active=await activeComparisonJob(...refs);if(active)return active;}throw error;}
 void (async()=>{
  try {
   await getPool().query("UPDATE ingest.entity_comparison_jobs SET status='running',started_at=now() WHERE id=$1",[created.id]);
   const reportId=await saveComparison(await work(created.left,created.right,operator),operator);
   await getPool().query("UPDATE ingest.entity_comparison_jobs SET status='done',report_id=$2,finished_at=now() WHERE id=$1",[created.id,reportId]);
  }catch(error){await getPool().query("UPDATE ingest.entity_comparison_jobs SET status='failed',error=$2,finished_at=now() WHERE id=$1",[created.id,error instanceof Error?error.message.slice(0,500):"No se pudo comparar."]).catch(()=>undefined);}
 })();
 return created;
}

export interface ComparisonHistoryItem {target:EntityRef;name:string;createdAt:string;jobId:number|null;status:ComparisonJob["status"]|null}
export async function comparisonHistory(ref:EntityRef):Promise<ComparisonHistoryItem[]> {
 const {rows}=await getPool().query<{left:EntityRef;right:EntityRef;report:ComparisonReport|null;created_at:string;job_id:string|null;status:ComparisonJob["status"]|null}>(`
 WITH reports AS (SELECT DISTINCT ON(pair_key) pair_key,report,created_at FROM ingest.entity_comparison_reports ORDER BY pair_key,id DESC),
 jobs AS (SELECT DISTINCT ON(pair_key) pair_key,left_ref,right_ref,id,status,requested_at FROM ingest.entity_comparison_jobs ORDER BY pair_key,id DESC)
 SELECT COALESCE(r.report->'left',j.left_ref) AS left,COALESCE(r.report->'right',j.right_ref) AS right,r.report,
 GREATEST(r.created_at,j.requested_at)::text AS created_at,j.id::text AS job_id,j.status
 FROM reports r FULL JOIN jobs j USING(pair_key)
 WHERE (COALESCE(r.report->'left',j.left_ref)->>'kind'=$1 AND COALESCE(r.report->'left',j.left_ref)->>'id'=$2)
 OR (COALESCE(r.report->'right',j.right_ref)->>'kind'=$1 AND COALESCE(r.report->'right',j.right_ref)->>'id'=$2)
 ORDER BY GREATEST(r.created_at,j.requested_at) DESC`,[ref.kind,String(ref.id)]);
 const result:ComparisonHistoryItem[]=[];
 for(const row of rows){
  const target=row.left.kind===ref.kind&&row.left.id===ref.id?row.right:row.left;
  const saved=[row.report?.left,row.report?.right].find(s=>s?.kind===target.kind&&s?.id===target.id);
  let name=saved?.name;
  if(!name){const table={artist:"artists",person:"persons",album:"albums"}[target.kind];const column=target.kind==="album"?"title":"name";name=(await getPool().query<{name:string}>(`SELECT ${column} AS name FROM public.${table} WHERE id=$1`,[target.id])).rows[0]?.name;}
  if(!name)continue;
  result.push({target:{kind:target.kind,id:target.id},name,createdAt:row.created_at,jobId:row.job_id?Number(row.job_id):null,status:row.status});
 }
 return result;
}
