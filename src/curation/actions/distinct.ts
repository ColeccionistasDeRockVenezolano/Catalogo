// CRV · Acción «son distintas» y su inversa (etapa 3).
//
// Declara un par como identidades distintas en `curation_distinct_pairs`, la
// memoria única que consultan el detector y la fusión. Cierra la tarea de
// revisión si existe. `undoDistinct` borra la declaración y reabre la tarea.
import { z } from "zod";
import type { OperatorContext } from "../../merge/operator.js";
import { recordMergeFeedback, type FeedbackSource } from "../feedback.js";
import type { ActionFinding, ActionPreview, FixActionDefinition, Precondition } from "./types.js";

export const distinctParamsSchema = z.object({
  kind: z.enum(["artist", "person", "organization"]),
  aId: z.number().int().positive(),
  bId: z.number().int().positive(),
}).strict();

export type DistinctParams = z.infer<typeof distinctParamsSchema>;

function pairOf(finding: ActionFinding): [number, number] | null {
  const raw = finding.evidence["pair"];
  if (Array.isArray(raw) && raw.length === 2) {
    const a = Number(raw[0]);
    const b = Number(raw[1]);
    if (Number.isInteger(a) && Number.isInteger(b) && a > 0 && b > 0 && a !== b) return [Math.min(a, b), Math.max(a, b)];
  }
  const related = finding.related.find((item) => item.kind === finding.entity.kind && item.id !== null && item.id !== finding.entity.id);
  if (finding.entity.id !== null && related?.id != null) {
    const a = Math.min(finding.entity.id, related.id);
    const b = Math.max(finding.entity.id, related.id);
    return a === b ? null : [a, b];
  }
  return null;
}

const supported = (finding: ActionFinding): boolean =>
  finding.entity.kind === "artist" || finding.entity.kind === "person" || finding.entity.kind === "organization";

export const distinctAction: FixActionDefinition<DistinctParams> = {
  key: "descartar_duplicado",
  label: "Son distintas",
  description: "Declara que las dos fichas son identidades distintas y cierra la tarea. El detector no vuelve a proponer el par; se puede deshacer.",
  level: 1,
  inverse: "distinct_delete",
  paramsSchema: distinctParamsSchema,

  appliesTo(finding) {
    return supported(finding) && pairOf(finding) !== null;
  },

  acceptsExplicit(finding, params) {
    const pair = pairOf(finding);
    return supported(finding) && pair !== null && pair[0] === Math.min(params.aId, params.bId) && pair[1] === Math.max(params.aId, params.bId);
  },

  levelFor() { return 1; },

  async defaultParams(finding) {
    const pair = pairOf(finding);
    if (!pair || !supported(finding)) return null;
    return {
      kind: finding.entity.kind as DistinctParams["kind"], aId: pair[0], bId: pair[1],
    };
  },

  async preconditions(finding, params, ctx) {
    const checks: Precondition[] = [];
    const pair = pairOf(finding);
    checks.push(pair && pair[0] === Math.min(params.aId, params.bId) && pair[1] === Math.max(params.aId, params.bId)
      ? { key: "par", ok: true }
      : { key: "par", ok: false, code: "invalid", message: "las fichas no son las del hallazgo" });
    if (params.kind !== finding.entity.kind) {
      checks.push({ key: "tipo", ok: false, code: "invalid", message: `el hallazgo es de ${finding.entity.kind}, no de ${params.kind}` });
    }
    const { rowCount } = await ctx.client.query(
      "SELECT 1 FROM ingest.curation_distinct_pairs WHERE kind=$1 AND a_id=$2 AND b_id=$3",
      [params.kind, Math.min(params.aId, params.bId), Math.max(params.aId, params.bId)]);
    checks.push(rowCount
      ? { key: "no_declaradas", ok: false, code: "not_applicable", message: "ya estaban declaradas distintas" }
      : { key: "no_declaradas", ok: true });
    return checks;
  },

  async preview(finding, params) {
    const a = Math.min(params.aId, params.bId);
    const b = Math.max(params.aId, params.bId);
    return {
      touched: [{ kind: params.kind, id: a }, { kind: params.kind, id: b }],
      before: { distinct: false }, after: { distinct: true, kind: params.kind, aId: a, bId: b, note: "la nota del lote queda como motivo" },
      blocked: null, collisions: [], warnings: [], proposal: null,
      hashMaterial: `distinct:${params.kind}:${a}:${b}`,
    } satisfies ActionPreview;
  },

  async apply(context, finding, params) {
    return declareDistinct(context, finding, params, context.note, "human");
  },
};

/** Declara el par distinto y cierra la tarea; lo comparten la acción manual y la automática. */
export async function declareDistinct(
  context: OperatorContext, finding: ActionFinding, params: DistinctParams, reason: string, source: FeedbackSource = "human",
): Promise<{ after: Record<string, unknown> }> {
  const a = Math.min(params.aId, params.bId);
  const b = Math.max(params.aId, params.bId);
  // La nota la escribe la persona en el diálogo del lote (campo «Motivo *»).
  const note = (reason.trim() || `Revisado en Curaduría: «${finding.title}» — son fichas distintas.`).slice(0, 500);
  const review = await context.client.query<{ id: string }>(`
    SELECT id::text FROM ingest.review_queue
     WHERE kind='possible_duplicate' AND status IN ('open','in_progress')
       AND LEAST(artist_a_id,artist_b_id)=$1 AND GREATEST(artist_a_id,artist_b_id)=$2
     ORDER BY id LIMIT 1`, [a, b]);
  const reviewId = review.rows[0] ? Number(review.rows[0].id) : null;
  await context.client.query(`
    INSERT INTO ingest.curation_distinct_pairs(kind,a_id,b_id,decided_by,note,review_id,run_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (kind,a_id,b_id) DO NOTHING`,
  [params.kind, a, b, context.operator || finding.detector, note, reviewId, context.runId]);
  if (reviewId !== null) {
    await context.client.query(`
      UPDATE ingest.review_queue
         SET status='dismissed', resolved_by='human', resolved_at=now(), updated_at=now(), resolution_note=$2
       WHERE id=$1`, [reviewId, note.slice(0, 1500)]);
  }
  await recordMergeFeedback(context, {
    kind: params.kind, aId: a, bId: b, outcome: "distinct", source, note,
  });
  return { after: { distinct: true, kind: params.kind, aId: a, bId: b, reviewId } };
}

/** Inversa de `descartar_duplicado`: borra la declaración del run y reabre su tarea. */
export async function undoDistinct(context: OperatorContext, runId: number): Promise<number> {
  const { rows } = await context.client.query<{ kind: string; a_id: string; b_id: string; review_id: string | null }>(`
    DELETE FROM ingest.curation_distinct_pairs WHERE run_id=$1
    RETURNING kind,a_id::text,b_id::text,review_id::text`, [runId]);
  let reopened = 0;
  for (const row of rows) {
    if (row.review_id === null) continue;
    const updated = await context.client.query(`
      UPDATE ingest.review_queue
         SET status='open', resolved_by=NULL, resolved_at=NULL, resolution_note=NULL, updated_at=now()
       WHERE id=$1 AND status='dismissed'`, [Number(row.review_id)]);
    reopened += updated.rowCount ?? 0;
  }
  return rows.length + reopened;
}
