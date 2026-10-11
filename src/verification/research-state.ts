import { rememberEvidenceDocument } from "../evidence/inventory.js";
import {sourceMatchesIdentity} from "./source-identity.js";
import { getPool } from "../db/client.js";
import { evaluateVerification, snapshotHash } from "./evaluate.js";
import { fold, RULES_VERSION } from "./proof.js";
import { fullSourceChunks, researchVerification, type ResearchState, type VerificationBroker } from "./research.js";
import type { DeepSeekGateway } from "../ai/gateway.js";
import type { VerificationSnapshot, VerificationProgress, VerificationReport } from "./types.js";
export async function researchStored(snapshot:VerificationSnapshot,broker?:VerificationBroker,gateway?:DeepSeekGateway,onProgress?:(p:VerificationProgress,r?:VerificationReport)=>Promise<void>):Promise<VerificationReport> {
 const hash=snapshotHash(snapshot);
 const {rows}=await getPool().query<{state:ResearchState}>("SELECT state FROM ingest.entity_verification_research_state WHERE entity_kind=$1 AND entity_id=$2 AND snapshot_hash=$3",[snapshot.kind,snapshot.id,hash]);
 const old=rows[0]?.state;
 const resume=old&&researchNeedsResume(snapshot,old)?old:undefined;
 let latest:ResearchState|undefined;
 const persist=async(state:ResearchState)=>{
   latest=state;
   for(const page of state.pages) await rememberEvidenceDocument(getPool(),{...page,readAt:page.readAt??new Date().toISOString()});
   await getPool().query("INSERT INTO ingest.entity_verification_research_state(entity_kind,entity_id,snapshot_hash,state) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(entity_kind,entity_id) DO UPDATE SET snapshot_hash=EXCLUDED.snapshot_hash,state=EXCLUDED.state,updated_at=now()",[snapshot.kind,snapshot.id,hash,JSON.stringify(state)]);
 };
 const report=await researchVerification(snapshot,broker,gateway,onProgress,{...(resume?{resume}:{}),onState:persist});
 if(old&&latest&&retainVerificationEvidence(snapshot,old,latest)){
   await persist(latest);
   return {...evaluateVerification(snapshot,latest.pages,latest.proposal,true,latest.limitations),...(report.evaluation?{evaluation:report.evaluation}:{})};
 }
 return report;
}

/** Completed sources are refreshed on a new request; ambiguous sources do not force endless resumption. */
export function researchNeedsResume(snapshot:VerificationSnapshot,state:ResearchState):boolean{
 if(state.rulesVersion!==RULES_VERSION||!state.pages.length)return false;
 if(state.pendingKeys.length)return true;
 const inspected=new Set(state.inspectedChunks??[]);
 return state.pages.some(page=>sourceMatchesIdentity(snapshot,page,state.pages)&&fullSourceChunks(page).some((_chunk,index)=>!inspected.has(`${page.url}:${page.contentHash}:${index}`)));
}

/** Una nueva evaluación conserva las citas válidas de la misma ficha. */
export function retainVerificationEvidence(snapshot:VerificationSnapshot,old:ResearchState,latest:ResearchState):number {
 const previous=evaluateVerification(snapshot,old.pages,old.proposal,true);
 let retained=0;
 for(const claim of old.proposal.findings){
   const finding=previous.findings.find(f=>f.key===claim.key);
   if(!finding||finding.coverage<=0)continue;
   const evidence=claim.evidence.flatMap(e=>{
     const page=old.pages[e.source];if(!page||!finding.evidence.some(c=>c.url===page.url&&fold(c.quote)===fold(e.quote)))return [];
     let index=latest.pages.findIndex(p=>p.url===page.url);
     if(index<0){index=latest.pages.length;latest.pages.push(page);}
     if(!fold(latest.pages[index]!.content).includes(fold(e.quote)))return [];
     return [{...e,source:index}];
   });
   if(!evidence.length||latest.proposal.findings.some(f=>f.key===claim.key&&JSON.stringify(f.evidence)===JSON.stringify(evidence)))continue;
   latest.proposal.findings.push({...claim,evidence});retained++;
 }
 if(retained)latest.limitations.push("Se conservan citas válidas de investigaciones anteriores de esta misma ficha, con su fecha original; una nueva evaluación no elimina evidencia documental existente.");
 return retained;
}
