import { createHash } from "node:crypto";
import { z } from "zod";
import { persistClaim } from "../claims/persistence.js";
import { withOperatorRun, OperatorError } from "../merge/operator.js";
const text = z.string().trim().min(1).max(4000);
const id = z.number().int().positive().safe();
export const artistEvidenceSchema = z.object({
  reviewer: text, note: text, sourceId: id,
  artists: z.array(z.object({
    artistId: id, expectedName: text, criterion: z.string().regex(/^[a-z0-9-]+$/), observation: text,
    url: z.string().url().refine(v => /^https?:\/\//u.test(v), "Referencia HTTP(S) obligatoria"), excerpt: text,
  }).strict()).min(1),
}).strict();
/** Documentary evidence for discovery decisions, stored as claims outside the catalog merge (no core writes). */
export async function recordArtistEvidence(input: unknown, apply = false) {
  const e = artistEvidenceSchema.parse(input);
  const run = await withOperatorRun({ name:"discovery:evidence",operator:e.reviewer,note:e.note },async ctx => {
    if (!(await ctx.client.query("SELECT id FROM ingest.sources WHERE id=$1",[e.sourceId])).rowCount) throw new OperatorError("invalid","Fuente inexistente");
    const out = [];
    for (const a of e.artists) {
      const row=(await ctx.client.query("SELECT name FROM artists WHERE id=$1 FOR UPDATE",[a.artistId])).rows[0];
      if (!row || row.name!==a.expectedName) throw new OperatorError("invalid",`${a.artistId}: identidad ausente o nombre canónico cambió`);
      const rawValue={ criterion:a.criterion,observation:a.observation };
      const evidence={ url:a.url,excerpt:a.excerpt };
      const claim=await persistClaim({
        entityKind:"artist",artistId:a.artistId,sourceId:e.sourceId,runId:ctx.runId,field:`discovery_link:${a.criterion}`,
        identity:`discovery-link:artist:${a.artistId}`,identitySecondary:"",originalIdentity:a.expectedName,
        rawValue,normalizedValue:rawValue,rawHash:createHash("sha256").update(JSON.stringify([a.artistId,rawValue,evidence])).digest("hex"),
        extractor:"discovery-artist-review",extractorVersion:"1",confidence:"high",createdBy:"human",evidence,
      },ctx.client);
      // A prior observation may have been rejected or moved by identity resolution; never revive it implicitly.
      const current=(await ctx.client.query("SELECT artist_id,status FROM ingest.claims WHERE id=$1",[claim.id])).rows[0];
      if (!current || Number(current.artist_id)!==a.artistId || ["rejected","superseded","conflict"].includes(current.status)) throw new OperatorError("invalid",`${a.artistId}: observación existente requiere revisión; no se reactiva automáticamente`);
      const ev=(await ctx.client.query("SELECT id FROM ingest.claim_evidence WHERE claim_id=$1 AND evidence_hash=$2",[
        claim.id,createHash("sha256").update(JSON.stringify(evidence)).digest("hex")])).rows[0];
      out.push({ artistId:a.artistId,claimId:apply ? claim.id:null,evidenceId:apply && ev ? Number(ev.id):null,inserted:claim.inserted });
    }
    return out;
  },{rollbackOnly:!apply,serializable:true});
  return { applied:apply,runId:apply ? run.runId:null,artists:run.result };
}
