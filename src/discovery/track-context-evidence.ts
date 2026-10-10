import { createHash } from "node:crypto";
import { z } from "zod";
import { persistClaim } from "../claims/persistence.js";
import { withOperatorRun, OperatorError } from "../merge/operator.js";
const text = z.string().trim().min(1).max(4000);
const id = z.number().int().positive().safe();
export const contextEvidenceSchema = z.object({
  reviewer: text, note: text, sourceId: id, trackId: id, expectedTitle: text, expectedAlbumId: id,
  label: z.string().regex(/^[a-z-]+$/), observation: text,
  basis: z.enum(["authorized-listening","reviewed-description"]), rightsBasis: text,
  url: z.string().url().refine(v => /^(https?:\/\/|crv-review:\/\/)/u.test(v),"Referencia HTTP(S) o crv-review obligatoria"),
  excerpt: text, confidence: z.enum(["low","medium","high"]),
}).strict();
/** Store documentary/manual observations in the existing claim system. No audio access, no core writes. */
export async function recordContextEvidence(input: unknown, apply = false) {
  const e = contextEvidenceSchema.parse(input);
  const run = await withOperatorRun({ name:"discovery:contexts:evidence",operator:e.reviewer,note:e.note },async ctx => {
    const t=(await ctx.client.query("SELECT title,album_id FROM tracks WHERE id=$1 FOR UPDATE",[e.trackId])).rows[0];
    if (!t || t.title!==e.expectedTitle || Number(t.album_id)!==e.expectedAlbumId) throw new OperatorError("invalid","Pista ausente, título o edición cambiaron");
    if (!(await ctx.client.query("SELECT id FROM ingest.track_context_labels WHERE slug=$1",[e.label])).rowCount) throw new OperatorError("invalid","Etiqueta desconocida");
    if (!(await ctx.client.query("SELECT id FROM ingest.sources WHERE id=$1",[e.sourceId])).rowCount) throw new OperatorError("invalid","Fuente inexistente");
    const rawValue={ label:e.label,observation:e.observation,basis:e.basis,rightsBasis:e.rightsBasis };
    const evidence={ url:e.url,excerpt:e.excerpt };
    const claim=await persistClaim({
      entityKind:"track",trackId:e.trackId,sourceId:e.sourceId,runId:ctx.runId,field:`discovery_context:${e.label}`,
      identity:`discovery-context:track:${e.trackId}`,identitySecondary:`album:${e.expectedAlbumId}`,originalIdentity:e.expectedTitle,
      rawValue,normalizedValue:rawValue,rawHash:createHash("sha256").update(JSON.stringify([e.trackId,rawValue,evidence])).digest("hex"),
      extractor:"discovery-context-review",extractorVersion:"1",confidence:e.confidence,createdBy:"human",evidence,
    },ctx.client);
    const row=(await ctx.client.query("SELECT id FROM ingest.claim_evidence WHERE claim_id=$1 AND evidence_hash=$2",[
      claim.id,createHash("sha256").update(JSON.stringify(evidence)).digest("hex")])).rows[0];
    // A prior observation may have been rejected or moved by identity resolution; never revive it implicitly.
    const current=(await ctx.client.query("SELECT track_id,status FROM ingest.claims WHERE id=$1",[claim.id])).rows[0];
    if (!current || Number(current.track_id)!==e.trackId || ["rejected","superseded","conflict"].includes(current.status)) throw new OperatorError("invalid","Observación existente requiere revisión; no se reactiva automáticamente");
    return { claimId:apply ? claim.id:null,evidenceId:apply ? Number(row.id):null,inserted:claim.inserted,trackId:e.trackId,label:e.label };
  },{rollbackOnly:!apply,serializable:true});
  return { applied:apply,runId:apply ? run.runId:null,...run.result };
}
