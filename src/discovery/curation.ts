import { z } from "zod";
import type { PoolClient } from "pg";
import { OperatorError, withOperatorRun } from "../merge/operator.js";
const state = z.enum(["proposed", "approved", "rejected", "withdrawn"]);
export const discoveryBatchSchema = z.object({
  batch: z.string().trim().min(1), reviewer: z.string().trim().min(1), note: z.string().trim().min(1),
  labels: z.array(z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1),
    definition: z.string().min(1), criterion: z.string().min(1) })),
  artists: z.array(z.object({
    key: z.string().min(1), artistId: z.number().int().positive(), expectedName: z.string().min(1),
    state, evidenceId: z.number().int().positive().nullable(), reason: z.string().trim().min(1),
    group: z.string().min(1), priority: z.number().int().min(1).max(100).default(1),
    validFrom: z.string().datetime(), validUntil: z.string().datetime().nullable(),
    labels: z.array(z.object({ slug: z.string(), state, evidenceId: z.number().int().positive().nullable(), reason: z.string().trim().min(1) })),
  }).superRefine((a, ctx) => {
    if (a.validUntil && a.validUntil <= a.validFrom) ctx.addIssue({ code: "custom", message: "ventana temporal inválida" });
    if (a.state === "approved" && !a.evidenceId) ctx.addIssue({ code: "custom", message: "aprobación sin evidencia" });
    if (a.labels.some(l => l.state === "approved" && !l.evidenceId)) ctx.addIssue({ code: "custom", message: "etiqueta aprobada sin evidencia" });
  })),
});
export type DiscoveryBatch = z.infer<typeof discoveryBatchSchema>;
async function checkBatch(client: PoolClient, batch: DiscoveryBatch) {
  const conflicts: string[] = [];
  const keys = new Set<string>(), ids = new Set<number>();
  for (const artist of batch.artists) {
    if (keys.has(artist.key) || ids.has(artist.artistId)) conflicts.push(`${artist.key}: identidad o clave repetida`);
    keys.add(artist.key); ids.add(artist.artistId);
    const row = (await client.query("SELECT name FROM artists WHERE id=$1 FOR UPDATE", [artist.artistId])).rows[0];
    if (!row || row.name !== artist.expectedName) conflicts.push(`${artist.key}: identidad ausente o nombre canónico cambió`);
    if (/^(various artists|unknown|desconocido|varios artistas)$/iu.test(artist.expectedName)) conflicts.push(`${artist.key}: marcador no elegible`);
    for (const decision of [artist, ...artist.labels]) {
      if (decision.evidenceId) {
        const evidence = (await client.query(`SELECT e.id FROM ingest.claim_evidence e JOIN ingest.claims c ON c.id=e.claim_id
          WHERE e.id=$1 AND c.artist_id=$2 AND c.status NOT IN ('rejected','superseded') AND e.url ~ '^https?://' AND length(trim(e.excerpt))>0`, [decision.evidenceId, artist.artistId])).rows[0];
        if (!evidence) conflicts.push(`${artist.key}: evidencia ${decision.evidenceId} ausente, ajena o no utilizable`);
      }
    }
    for (const label of artist.labels) if (!batch.labels.some(l => l.slug === label.slug)) conflicts.push(`${artist.key}: etiqueta desconocida ${label.slug}`);
    // Un importador nunca reasigna una decisión a otro ID (ni resuelve aliases).
    for (const table of ["artist_search_suggestions", "artist_discovery_labels"]) {
      const mismatches = await client.query(`SELECT id FROM ingest.${table} WHERE import_key=ANY($1::text[]) AND artist_id<>$2`, [[`${batch.batch}:${artist.key}`, ...artist.labels.map(l => `${batch.batch}:${artist.key}:${l.slug}`)], artist.artistId]);
      if (mismatches.rowCount) conflicts.push(`${artist.key}: clave existente vinculada a otra identidad`);
    }
  }
  return conflicts;
}
export async function importDiscoveryBatch(input: unknown, apply = false) {
  const batch = discoveryBatchSchema.parse(input);
  return withOperatorRun({ name: "discovery:import", operator: batch.reviewer, note: batch.note }, async ctx => {
    const conflicts = await checkBatch(ctx.client, batch);
    const report = { approved: batch.artists.filter(a => a.state === "approved").map(a => a.artistId),
      pending: batch.artists.filter(a => a.state === "proposed").map(a => a.artistId),
      rejected: batch.artists.filter(a => a.state === "rejected" || a.state === "withdrawn").map(a => a.artistId), conflicts };
    if (!apply || conflicts.length) {
      if (apply && conflicts.length) throw new OperatorError("invalid", conflicts.join("; "));
      return report;
    }
    for (const l of batch.labels) await ctx.client.query(`INSERT INTO ingest.discovery_labels(slug,name,definition,criterion)
      VALUES($1,$2,$3,$4) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,definition=EXCLUDED.definition,criterion=EXCLUDED.criterion
      WHERE (discovery_labels.name,discovery_labels.definition,discovery_labels.criterion) IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.definition,EXCLUDED.criterion)`, [l.slug,l.name,l.definition,l.criterion]);
    for (const a of batch.artists) {
      await ctx.client.query(`INSERT INTO ingest.artist_search_suggestions(import_key,artist_id,evidence_id,state,exposure_group,priority,valid_from,valid_until,reviewer,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(import_key) DO UPDATE SET
        evidence_id=EXCLUDED.evidence_id,state=EXCLUDED.state,exposure_group=EXCLUDED.exposure_group,priority=EXCLUDED.priority,
        valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,reviewer=EXCLUDED.reviewer,reason=EXCLUDED.reason,reviewed_at=now()
        WHERE (artist_search_suggestions.evidence_id,artist_search_suggestions.state,artist_search_suggestions.exposure_group,artist_search_suggestions.priority,artist_search_suggestions.valid_from,artist_search_suggestions.valid_until,artist_search_suggestions.reviewer,artist_search_suggestions.reason)
          IS DISTINCT FROM (EXCLUDED.evidence_id,EXCLUDED.state,EXCLUDED.exposure_group,EXCLUDED.priority,EXCLUDED.valid_from,EXCLUDED.valid_until,EXCLUDED.reviewer,EXCLUDED.reason)`,
        [`${batch.batch}:${a.key}`,a.artistId,a.evidenceId,a.state,a.group,a.priority,a.validFrom,a.validUntil,batch.reviewer,a.reason]);
      for (const l of a.labels) await ctx.client.query(`INSERT INTO ingest.artist_discovery_labels(import_key,artist_id,label_id,evidence_id,state,reviewer,reason)
        SELECT $1,$2,id,$4,$5,$6,$7 FROM ingest.discovery_labels WHERE slug=$3 ON CONFLICT(import_key) DO UPDATE SET
        evidence_id=EXCLUDED.evidence_id,state=EXCLUDED.state,reviewer=EXCLUDED.reviewer,reason=EXCLUDED.reason,reviewed_at=now()
        WHERE (artist_discovery_labels.evidence_id,artist_discovery_labels.state,artist_discovery_labels.reviewer,artist_discovery_labels.reason)
        IS DISTINCT FROM (EXCLUDED.evidence_id,EXCLUDED.state,EXCLUDED.reviewer,EXCLUDED.reason)`,
        [`${batch.batch}:${a.key}:${l.slug}`,a.artistId,l.slug,l.evidenceId,l.state,batch.reviewer,l.reason]);
    }
    return report;
  }, { rollbackOnly: !apply, serializable: true });
}
