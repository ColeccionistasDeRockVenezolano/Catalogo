import type { PoolClient } from "pg";
import { withOperatorRun, OperatorError } from "../merge/operator.js";
import { trackContextBatchSchema, type TrackContextBatch } from "./track-context-contract.js";
import { EFFECTIVE_ASSIGNMENTS } from "./track-contexts.js";

type Values = Record<string, unknown>;
// Only internal, fixed table/column names reach this helper. All values are parameters.
async function store(client: PoolClient, table: string, values: Values, immutable: string[], update = false) {
  const columns = Object.keys(values), params = Object.values(values);
  const existing = (await client.query(`SELECT *, ${immutable.map((c,i) => `${c} IS NOT DISTINCT FROM $${i+2}`).join(" AND ")} AS matches
    FROM ingest.${table} WHERE import_key=$1 FOR UPDATE`, [values["import_key"], ...immutable.map(c => values[c])])).rows[0];
  if (existing && !existing.matches) throw new OperatorError("invalid", `${values["import_key"]}: clave inmutable o identidad modificada`);
  if (existing && !update) return Number(existing.id);
  const set = columns.filter(c => c !== "import_key").map(c => `${c}=EXCLUDED.${c}`).join(",");
  const different = columns.filter(c => c !== "import_key").map(c => `${table}.${c} IS DISTINCT FROM EXCLUDED.${c}`).join(" OR ");
  const conflict = update ? `DO UPDATE SET ${set},reviewed_at=now() WHERE ${different}` : "DO NOTHING";
  const row = (await client.query(`INSERT INTO ingest.${table}(${columns.join(",")}) VALUES(${params.map((_,i)=>`$${i+1}`).join(",")})
    ON CONFLICT(import_key) ${conflict} RETURNING id`, params)).rows[0];
  return Number(row?.id ?? existing?.id);
}
async function validate(client: PoolClient, a: TrackContextBatch["decisions"][number] | TrackContextBatch["proposals"][number]) {
  const track = (await client.query("SELECT title,album_id FROM tracks WHERE id=$1 FOR UPDATE",[a.trackId])).rows[0];
  if (!track || track.title !== a.expectedTitle || Number(track.album_id) !== a.expectedAlbumId) {
    throw new OperatorError("invalid", `${a.key}: pista ausente, título o edición cambiaron`);
  }
  const label = (await client.query("SELECT id,kind FROM ingest.track_context_labels WHERE slug=$1",[a.label])).rows[0];
  if (!label) throw new OperatorError("invalid", `${a.key}: etiqueta fuera de la ontología inicial`);
  if (a.evidenceId) {
    const requireUsable = !("state" in a) || a.state === "approved";
    const evidence = (await client.query(`SELECT e.id FROM ingest.claim_evidence e JOIN ingest.claims c ON c.id=e.claim_id
      WHERE e.id=$1 AND c.track_id=$2 AND c.entity_kind='track' AND c.field=$3
        AND (NOT $4::boolean OR (c.status NOT IN ('rejected','superseded','conflict') AND length(trim(e.excerpt))>0 AND length(trim(e.url))>0))
      FOR SHARE OF e,c`,[a.evidenceId,a.trackId,`discovery_context:${a.label}`,requireUsable])).rows[0];
    if (!evidence) throw new OperatorError("invalid", `${a.key}: evidencia ausente, rechazada, de otra pista o de otro criterio`);
  }
  return Number(label.id);
}
export async function importTrackContexts(input: unknown, apply = false) {
  const batch = trackContextBatchSchema.parse(input);
  const keys = new Set<string>();
  for (const [kind, rows] of [["proposal",batch.proposals],["decision",batch.decisions],["evaluation",batch.evaluations]] as const) {
    for (const row of rows) {
      const key = `${kind}:${row.key}`;
      if (keys.has(key)) throw new OperatorError("invalid", `${key}: clave repetida`);
      keys.add(key);
    }
  }
  const run = await withOperatorRun({ name: "discovery:contexts", operator: batch.reviewer, note: batch.note }, async ctx => {
    const key = (k: string) => `${batch.batch}:${k}`;
    const common = (a: TrackContextBatch["proposals"][number] | TrackContextBatch["decisions"][number], labelId: number) => ({
      import_key: key(a.key), track_id: a.trackId, label_id: labelId, evidence_id: a.evidenceId, confidence: a.confidence,
      method_version: a.methodVersion, method_data: JSON.stringify(a.methodData ?? {}),
    });
    for (const a of batch.proposals) {
      const values = { ...common(a,await validate(ctx.client,a)), origin: a.origin, proposer: a.proposer,
        model_name: a.modelName, model_version: a.modelVersion, generated_at: a.generatedAt, rationale: a.rationale };
      await store(ctx.client,"track_context_proposals",values,Object.keys(values));
    }
    for (const a of batch.decisions) {
      const labelId = await validate(ctx.client,a);
      let proposalId: number | null = null;
      if (a.proposalKey) {
        const p = (await ctx.client.query("SELECT id,track_id,label_id FROM ingest.track_context_proposals WHERE import_key=$1 FOR SHARE",[key(a.proposalKey)])).rows[0];
        if (!p || Number(p.track_id) !== a.trackId || Number(p.label_id) !== labelId) throw new OperatorError("invalid", `${a.key}: propuesta ajena o ausente`);
        proposalId = Number(p.id);
      }
      await store(ctx.client,"track_context_assignments",{ ...common(a,labelId), proposal_id: proposalId, state: a.state,
        reviewer: batch.reviewer, reason: a.reason, valid_from: a.validFrom, valid_until: a.validUntil },["track_id","label_id"],true);
    }
    for (const e of batch.evaluations) {
      const a = (await ctx.client.query(`SELECT to_jsonb(a) AS snapshot,a.id,a.reviewer FROM ingest.track_context_assignments a
        JOIN (${EFFECTIVE_ASSIGNMENTS}) effective ON effective.id=a.id WHERE a.import_key=$1 FOR UPDATE OF a`,[key(e.assignmentKey)])).rows[0];
      if (!a) throw new OperatorError("invalid", `${e.key}: asignación no vigente, sin evidencia válida o en conflicto`);
      if (a.reviewer === batch.reviewer) throw new OperatorError("invalid", `${e.key}: la evaluación requiere un revisor independiente`);
      const values = { import_key: key(e.key), assignment_id: Number(a.id), assignment_snapshot: JSON.stringify(a.snapshot),
        verdict: e.verdict, reviewer: batch.reviewer, reason: e.reason };
      await store(ctx.client,"track_context_evaluations",values,Object.keys(values));
    }
    return { proposals: batch.proposals.length, approved: batch.decisions.filter(a => a.state === "approved").length,
      rejected: batch.decisions.filter(a => a.state === "rejected").length, withdrawn: batch.decisions.filter(a => a.state === "withdrawn").length,
      evaluations: batch.evaluations.length };
  }, { rollbackOnly: !apply, serializable: true });
  return { applied: apply, runId: apply ? run.runId : null, ...run.result };
}
