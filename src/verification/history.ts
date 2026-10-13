import {createHash} from "node:crypto";
import {getPool} from "../db/client.js";
import {badRequest,notFound} from "../api/http-errors.js";
import {snapshotHash} from "./evaluate.js";
import {RULES_VERSION} from "./proof.js";
import type {WebPage} from "../ambiguity/web-search.js";
import type {ResearchState} from "./research.js";
import type {VerificationHistory,VerificationKind,VerificationReport,VerificationSnapshot} from "./types.js";
import {loadVerificationSnapshot} from "./snapshot.js";
import {newResearchLedger} from "./research-ledger.js";
import type {DocumentMetadata} from "./documents/types.js";
import {normalizePreservedState} from "./preserved-state.js";

async function storedReport(kind:VerificationKind,id:number,versionId:number):Promise<VerificationReport>{
 const row=(await getPool().query<{report:VerificationReport}>("SELECT report FROM ingest.entity_verification_reports WHERE id=$1 AND entity_kind=$2 AND entity_id=$3",[versionId,kind,id])).rows[0];
 if(!row)throw notFound("versión de investigación",versionId);
 return row.report;
}
export async function getVerificationVersion(kind:VerificationKind,id:number,versionId:number):Promise<VerificationReport>{
 const report=await storedReport(kind,id,versionId),snapshot=await loadVerificationSnapshot(kind,id);
 const stale=report.snapshotHash!==snapshotHash(snapshot)||report.rulesVersion!==RULES_VERSION;
 return {...report,stale,score:stale?null:report.score};
}

/** Rebuild legacy copies by exact hash; never substitute a newer page at the same URL. */
export async function preservedReportState(kind:VerificationKind,id:number,versionId:number):Promise<ResearchState>{
 const report=await storedReport(kind,id,versionId);
 if(report.researchVersionId){
  const row=(await getPool().query<{state:ResearchState}>("SELECT state FROM ingest.entity_verification_research_versions WHERE id=$1 AND entity_kind=$2 AND entity_id=$3 AND snapshot_hash=$4",[report.researchVersionId,kind,id,report.snapshotHash])).rows[0];
  if(row)return normalizePreservedState(row.state,report);
 }
 // Before version IDs existed, the checkpoint was saved immediately before its
 // report. Never borrow a checkpoint written after the selected report.
 const candidates=(await getPool().query<{state:ResearchState}>(`SELECT state FROM (
   SELECT state,updated_at FROM ingest.entity_verification_research_versions WHERE entity_kind=$1 AND entity_id=$2 AND snapshot_hash=$3
   UNION ALL SELECT state,updated_at FROM ingest.entity_verification_research_state WHERE entity_kind=$1 AND entity_id=$2 AND snapshot_hash=$3
  ) copies WHERE updated_at<=(SELECT created_at FROM ingest.entity_verification_reports WHERE id=$4) ORDER BY updated_at DESC`,[kind,id,report.snapshotHash,versionId])).rows;
 for(const candidate of candidates){
  try{return normalizePreservedState(candidate.state,report);}catch{/* Try an earlier exact copy or the per-document archive. */}
 }
 const pages:WebPage[]=[];
 for(const source of report.sources){
  const document=(await getPool().query<{content_text:string;content_hash:string;extraction_metadata:DocumentMetadata|null}>("SELECT content_text,content_hash,extraction_metadata FROM ingest.evidence_documents WHERE url=$1 AND content_hash=$2 AND acquisition_method=$3 AND captured_at IS NOT DISTINCT FROM $4::timestamptz ORDER BY id DESC LIMIT 1",[source.url,source.contentHash,source.acquisitionMethod??(source.origin==="search_snippet"?"search_snippet":"unknown"),source.capturedAt??null])).rows[0];
  if(!document||createHash("sha256").update(document.content_text).digest("hex")!==source.contentHash)throw badRequest(`No se conserva una copia íntegra de ${source.url} para esta versión. No se sustituye por la página actual.`);
  const {document:_summary,...metadata}=source;
  pages.push({...metadata,content:document.content_text,...(document.extraction_metadata?{document:document.extraction_metadata}:{})});
 }
 if(!pages.length)throw badRequest("Esta versión no contiene fuentes preservadas para reprocesar.");
 const proposal:ResearchState["proposal"]={findings:[],discoveries:[]};
 const citations=(finding:VerificationReport["findings"][number])=>finding.evidence.map(citation=>{
  const source=pages.findIndex(page=>page.url===citation.url&&(!citation.contentHash||page.contentHash===citation.contentHash));
  if(source<0)throw badRequest(`La cita de ${citation.url} no tiene una copia preservada en esta versión.`);
  return {source,quote:citation.quote};
 });
 for(const finding of report.findings)proposal.findings.push({key:finding.key,status:finding.status==="contradicted"?"contradicted":finding.status==="confirmed"||finding.status==="partial"?"confirmed":"unverified",observed:finding.observed,reason:finding.explanation,evidence:citations(finding)});
 for(const finding of report.suggestions??[])if(finding.observed)proposal.discoveries.push({area:finding.area,value:finding.observed,context:finding.context.join(" · "),reason:finding.explanation,evidence:citations(finding)});
 return {rulesVersion:report.rulesVersion??0,pages,proposal,pendingKeys:report.evaluation?.pendingKeys??[],limitations:report.limitations,attempts:report.evaluation?.attempts??0};
}
export function resetPreservedEvaluation(state:ResearchState,snapshot:VerificationSnapshot,preserveConsumption=false):ResearchState{
 const next={...structuredClone(state),rulesVersion:RULES_VERSION,pendingKeys:snapshot.units.map(unit=>unit.key),inspectedChunks:[],attempts:0};
 delete next.ledger;
 if(preserveConsumption&&state.ledger)next.ledger={...newResearchLedger(),consumption:structuredClone(state.ledger.consumption)};
 return next;
}
export async function listVerificationVersions(kind:VerificationKind,id:number,beforeId?:number):Promise<VerificationHistory>{
 await loadVerificationSnapshot(kind,id);
 const rows=(await getPool().query<{id:string;created_at:string;requested_by:string;snapshot_hash:string;source_count:number;complete:boolean;available:boolean}>(`SELECT r.id::text,r.created_at::text,r.requested_by,r.snapshot_hash,
   jsonb_array_length(r.report->'sources') AS source_count,coalesce((r.report#>>'{evaluation,complete}')::boolean,false) AS complete,
   (coalesce((SELECT jsonb_array_length(v.state->'pages')>0 FROM ingest.entity_verification_research_versions v
     WHERE v.id=(r.report->>'researchVersionId')::bigint AND v.entity_kind=r.entity_kind AND v.entity_id=r.entity_id AND v.snapshot_hash=r.snapshot_hash),false)
   OR (jsonb_array_length(r.report->'sources')>0 AND EXISTS (
    SELECT 1 FROM (
     SELECT entity_kind,entity_id,snapshot_hash,state,updated_at FROM ingest.entity_verification_research_versions
     UNION ALL SELECT entity_kind,entity_id,snapshot_hash,state,updated_at FROM ingest.entity_verification_research_state
    ) legacy WHERE legacy.entity_kind=r.entity_kind AND legacy.entity_id=r.entity_id AND legacy.snapshot_hash=r.snapshot_hash AND legacy.updated_at<=r.created_at
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.report->'sources') s WHERE NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(legacy.state->'pages') p WHERE p->>'url'=s->>'url' AND p->>'contentHash'=s->>'contentHash'
      AND (p->>'capturedAt')::timestamptz IS NOT DISTINCT FROM (s->>'capturedAt')::timestamptz
      AND coalesce(p->>'acquisitionMethod',CASE WHEN p->>'origin'='search_snippet' THEN 'search_snippet' ELSE 'unknown' END)=coalesce(s->>'acquisitionMethod',CASE WHEN s->>'origin'='search_snippet' THEN 'search_snippet' ELSE 'unknown' END)))))
   OR (jsonb_array_length(r.report->'sources')>0 AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(r.report->'sources') s WHERE NOT EXISTS (
       SELECT 1 FROM ingest.evidence_documents d WHERE d.url=s->>'url' AND d.content_hash=s->>'contentHash'
       AND d.acquisition_method=coalesce(s->>'acquisitionMethod',CASE WHEN s->>'origin'='search_snippet' THEN 'search_snippet' ELSE 'unknown' END)
       AND d.captured_at IS NOT DISTINCT FROM (s->>'capturedAt')::timestamptz)))) AS available
   FROM ingest.entity_verification_reports r WHERE r.entity_kind=$1 AND r.entity_id=$2 AND ($3::bigint IS NULL OR r.id<$3) ORDER BY r.id DESC LIMIT 21`,[kind,id,beforeId??null])).rows;
 const versions=rows.slice(0,20).map(row=>({id:Number(row.id),createdAt:row.created_at,requestedBy:row.requested_by,sourceCount:row.source_count,snapshotHash:row.snapshot_hash,complete:row.complete,reprocessAvailable:row.available,unavailableReason:row.available?null:row.source_count?"No se conservan todas las fuentes de esta versión.":"La versión no contiene fuentes preservadas."}));
 return {versions,nextBeforeId:rows.length>20?Number(rows[19]!.id):null};
}
