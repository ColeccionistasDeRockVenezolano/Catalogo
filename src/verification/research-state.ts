import { rememberEvidenceDocument } from "../evidence/inventory.js";
import {sourceMatchesIdentity} from "./source-identity.js";
import { getPool } from "../db/client.js";
import { snapshotHash } from "./evaluate.js";
import { RULES_VERSION } from "./proof.js";
import {mergeResearchProposal} from "./research-ledger.js";
import { fullSourceChunks, researchVerification, type ResearchState, type ResearchOptions, type VerificationBroker } from "./research.js";
import type { DeepSeekGateway } from "../ai/gateway.js";
import type { VerificationSnapshot, VerificationProgress, VerificationReport } from "./types.js";
export async function researchStored(snapshot:VerificationSnapshot,broker?:VerificationBroker,gateway?:DeepSeekGateway,onProgress?:(p:VerificationProgress,r?:VerificationReport)=>Promise<void>,options:ResearchOptions={}):Promise<VerificationReport> {
 const hash=snapshotHash(snapshot);
 const {rows}=await getPool().query<{state:ResearchState;snapshot_hash:string}>("SELECT state,snapshot_hash FROM ingest.entity_verification_research_state WHERE entity_kind=$1 AND entity_id=$2",[snapshot.kind,snapshot.id]);
 const old=rows[0]?.state;
 const resume=options.resume??(old&&rows[0]?.snapshot_hash===hash&&researchNeedsResume(snapshot,old)?old:undefined);
 const parent=(await getPool().query<{id:string}>("SELECT id::text FROM ingest.entity_verification_research_versions WHERE entity_kind=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1",[snapshot.kind,snapshot.id])).rows[0]?.id;
 let versionId:string|undefined;
 const persist=async(state:ResearchState)=>{
   const client=await getPool().connect();
   let nextVersionId=versionId;
   try{
     await client.query("BEGIN");
     if(options.checkpointFence){
       const fence=await client.query("SELECT id FROM ingest.entity_verification_jobs WHERE id=$1 AND lease_owner=$2 AND status='running' AND lease_expires_at>now() FOR UPDATE",[options.checkpointFence.jobId,options.checkpointFence.owner]);
       if(!fence.rowCount)throw new Error("El proceso perdió la propiedad del trabajo; no se sobrescribe su checkpoint.");
     }
     for(const page of state.pages) await rememberEvidenceDocument(client,{...page,readAt:page.readAt??new Date().toISOString()});
     if(!nextVersionId){
       nextVersionId=(await client.query<{id:string}>("INSERT INTO ingest.entity_verification_research_versions(entity_kind,entity_id,snapshot_hash,parent_version_id,state) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id::text",[snapshot.kind,snapshot.id,hash,options.parentVersionId??parent??null,JSON.stringify(state)])).rows[0]!.id;
     }else await client.query("UPDATE ingest.entity_verification_research_versions SET state=$2::jsonb,updated_at=now() WHERE id=$1",[nextVersionId,JSON.stringify(state)]);
     if(options.checkpointFence)await client.query("UPDATE ingest.entity_verification_jobs SET research_version_id=$2 WHERE id=$1",[options.checkpointFence.jobId,nextVersionId]);
     await client.query("INSERT INTO ingest.entity_verification_research_state(entity_kind,entity_id,snapshot_hash,state) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(entity_kind,entity_id) DO UPDATE SET snapshot_hash=EXCLUDED.snapshot_hash,state=EXCLUDED.state,updated_at=now()",[snapshot.kind,snapshot.id,hash,JSON.stringify(state)]);
     await client.query("COMMIT");versionId=nextVersionId;
   }catch(error){await client.query("ROLLBACK");throw error;}
   finally{client.release();}
 };
 const report=await researchVerification(snapshot,broker,gateway,onProgress,{...options,...(resume?{resume}:old?{baseline:old}:{}),onState:persist});
 return {...report,...(versionId?{researchVersionId:Number(versionId)}:{})};
}

/** Completed sources are refreshed on a new request; ambiguous sources do not force endless resumption. */
export function researchNeedsResume(snapshot:VerificationSnapshot,state:ResearchState):boolean{
 if(state.rulesVersion!==RULES_VERSION)return false;
 if(state.ledger?.stopReason||state.ledger?.tasks.some(task=>task.status!=="completed"))return true;
 if(!state.pages.length)return false;
 if(state.pendingKeys.length)return true;
 const inspected=new Set(state.inspectedChunks??[]);
 return state.pages.some(page=>sourceMatchesIdentity(snapshot,page,state.pages)&&fullSourceChunks(page).some((_chunk,index)=>!inspected.has(`${page.url}:${page.contentHash}:${index}`)));
}

/** Una nueva evaluación conserva las citas válidas de la misma ficha. */
export function retainVerificationEvidence(_snapshot:VerificationSnapshot,old:ResearchState,latest:ResearchState):number {
 const incoming:ResearchState["proposal"]={findings:[],discoveries:[]};
 for(const type of ["findings","discoveries"] as const){
   for(const claim of old.proposal[type]){
     const evidence=claim.evidence.flatMap(e=>{
       const page=old.pages[e.source];if(!page)return [];
       let index=latest.pages.findIndex(p=>p.url===page.url&&p.contentHash===page.contentHash&&p.content===page.content&&p.document?.captureId===page.document?.captureId);
       if(index<0){index=latest.pages.length;latest.pages.push(structuredClone(page));}
       return [{...e,source:index}];
     });
     if(type==="findings")incoming.findings.push({...claim,evidence} as ResearchState["proposal"]["findings"][number]);
     else incoming.discoveries.push({...claim,evidence} as ResearchState["proposal"]["discoveries"][number]);
   }
 }
 const retained=mergeResearchProposal(latest.proposal,incoming);
 if(retained&&!latest.limitations.includes("Se conservan afirmaciones y citas de investigaciones anteriores; su respaldo se vuelve a evaluar contra la ficha vigente."))latest.limitations.push("Se conservan afirmaciones y citas de investigaciones anteriores; su respaldo se vuelve a evaluar contra la ficha vigente.");
 return retained;
}
