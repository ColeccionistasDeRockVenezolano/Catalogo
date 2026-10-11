import type { OperatorContext } from "../merge/operator.js";
import type { VerificationReport } from "../verification/types.js";
import { rememberEvidenceFragment, recordFact, type FactInput } from "./inventory.js";

/** A saved machine evaluation becomes a pending assertion, never a human verification. */
export async function inventoryVerification(context: OperatorContext, report: VerificationReport): Promise<number[]> {
  const ids: number[] = [];
  const documents = (await context.client.query<{ id: string; url: string; content_hash: string; content_text: string }>(
    "SELECT id::text,url,content_hash,content_text FROM ingest.evidence_documents WHERE url=ANY($1::text[]) ORDER BY id DESC",
    [report.sources.map(source => source.url)])).rows;
  for (const finding of [...report.findings, ...report.suggestions ?? []]) {
    const evidence: FactInput["evidence"] = [];
    const unresolved: Array<{url:string;quote:string;reason:string}> = [];
    for (const citation of finding.evidence) {
      const source = report.sources.find(item => item.url === citation.url);
      const document = documents.find(item => item.url === citation.url && source?.contentHash === item.content_hash && item.content_text.includes(citation.quote));
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
  return ids;
}
