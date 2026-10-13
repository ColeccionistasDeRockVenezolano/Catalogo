import type { OperatorContext } from "../merge/operator.js";
import type { VerificationReport } from "../verification/types.js";
import { rememberEvidenceFragment, recordFact, type FactInput } from "./inventory.js";
import {extractionKey} from "../verification/documents/extraction-key.js";

/** A saved machine evaluation becomes a pending assertion, never a human verification. */
export async function inventoryVerification(context: OperatorContext, report: VerificationReport): Promise<number[]> {
  const ids: number[] = [];
  const documents = (await context.client.query<{ id: string; url: string; content_hash: string; content_text: string; raw_capture_id:string|null;extraction_metadata:import("../verification/documents/types.js").DocumentMetadata|null }>(
    "SELECT id::text,url,content_hash,content_text,raw_capture_id::text,extraction_metadata FROM ingest.evidence_documents WHERE url=ANY($1::text[]) ORDER BY id DESC",
    [report.sources.map(source => source.url)])).rows;
  for (const finding of [...report.findings, ...report.suggestions ?? []]) {
    const evidence: FactInput["evidence"] = [];
    const unresolved: Array<{url:string;quote:string;reason:string}> = [];
    for (const citation of finding.evidence) {
      const source = report.sources.find(item => item.url === citation.url&&(!citation.contentHash||item.contentHash===citation.contentHash));
      const document = documents.find(item => item.url === citation.url && source?.contentHash === item.content_hash && (!citation.captureId||Number(item.raw_capture_id)===citation.captureId) && (!citation.extractionHash||item.extraction_metadata&&extractionKey(item.extraction_metadata)===citation.extractionHash) && item.content_text.includes(citation.quote));
      if (!document || !citation.quote) {
        unresolved.push({ url: citation.url, quote: citation.quote, reason: "La cita no coincide literalmente con un documento conservado de esta versión." });
        continue;
      }
      evidence.push({ fragmentId: await rememberEvidenceFragment(context.client, Number(document.id), citation.quote), role: finding.status === "contradicted" ? "contradicts" : "supports" });
    }
    // Keep the complete finding and its destination hint. Later stages decide
    // the precise field/relationship writer and perform documentary review.
    const result = await recordFact(context, {
      kind: report.kind, entityId: report.entityId, relation: "verification_assertion", valueType: "relation",
      value: { key: finding.key, area: finding.area, label: finding.label, asserted: finding.value, observed: finding.observed,
        status: finding.status, explanation: finding.explanation, context: finding.context, unresolvedEvidence: unresolved },
      state: finding.status === "contradicted" ? "contradicted" : finding.status === "unverified" ? "unverifiable" : "pending",
      evidence,
    }, "ai");
    ids.push(result.factId);
  }
  for(const extraction of report.extractions??[]){
    const evidence:FactInput["evidence"]=[];
    for(const citation of extraction.evidence){
      const document=documents.find(item=>item.url===citation.url&&item.content_hash===citation.contentHash&&(!citation.captureId||Number(item.raw_capture_id)===citation.captureId)&&(!citation.extractionHash||item.extraction_metadata&&extractionKey(item.extraction_metadata)===citation.extractionHash)&&citation.quote.trim()&&item.content_text.includes(citation.quote));
      if(document)evidence.push({fragmentId:await rememberEvidenceFragment(context.client,Number(document.id),citation.quote),role:extraction.destination==="conflict"?"contradicts":citation.valid?"supports":"context"});
    }
    const result=await recordFact(context,{kind:report.kind,entityId:report.entityId,relation:"research_extraction",valueType:"relation",value:extraction,state:extraction.state==="contradicted"?"contradicted":extraction.state==="invalid"?"unverifiable":"pending",evidence},"ai");
    ids.push(result.factId);
  }
  return ids;
}
