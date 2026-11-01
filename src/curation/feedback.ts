// CRV · Precedentes de identidad para el clasificador (etapa 6).
//
// Un undo, un descarte humano o una fusión confirmada dejan un precedente
// recuperable. El dosier pide los precedentes del mismo par antes de clasificar
// de nuevo, para que la IA no repita un error ya corregido.
import type { PoolClient } from "pg";
import type { OperatorContext } from "../merge/operator.js";

export type FeedbackKind = "artist" | "person" | "organization" | "album" | "track";
export type FeedbackOutcome = "same_identity" | "related" | "distinct";
export type FeedbackSource = "undo" | "human" | "auto" | "merge";

export interface FeedbackPrecedent {
  aId: number; bId: number; outcome: FeedbackOutcome; source: FeedbackSource; note: string | null; createdAt: string;
}

export async function recordMergeFeedback(
  context: OperatorContext,
  input: { kind: FeedbackKind; aId: number; bId: number; outcome: FeedbackOutcome; source: FeedbackSource; note?: string | null },
): Promise<void> {
  const a = Math.min(input.aId, input.bId);
  const b = Math.max(input.aId, input.bId);
  if (a === b) return;
  await context.client.query(`
    INSERT INTO ingest.curation_merge_feedback(kind,a_id,b_id,outcome,source,note,run_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (kind,a_id,b_id,run_id,outcome,source) WHERE run_id IS NOT NULL DO NOTHING`,
  [input.kind, a, b, input.outcome, input.source, input.note?.slice(0, 1500) ?? null, context.runId]);
}

/** Guarda un undo de fusión como precedente «no fusionar» para ese par. */
export async function recordUndoFeedback(context: OperatorContext, mergeRunId: number): Promise<void> {
  const kinds = new Set<FeedbackKind>(["artist", "person", "organization", "album", "track"]);
  const { rows } = await context.client.query<{
    entity_kind: string; old_value: { id?: string | number } | null; new_value: { keptId?: number } | null;
  }>(`
    SELECT entity_kind::text, old_value, new_value
      FROM ingest.merge_audit
     WHERE run_id=$1 AND field='merged_duplicate'`, [mergeRunId]);
  for (const row of rows) {
    const kind = row.entity_kind as FeedbackKind;
    if (!kinds.has(kind)) continue;
    const dropped = Number(row.old_value?.id ?? 0);
    const kept = Number(row.new_value?.keptId ?? 0);
    if (!dropped || !kept || dropped === kept) continue;
    await recordMergeFeedback(context, {
      kind, aId: kept, bId: dropped, outcome: "related", source: "undo",
      note: `Fusión #${mergeRunId} deshecha: no repetir sin evidencia nueva`,
    });
  }
}

/** Precedentes del mismo par, del más reciente al más antiguo. */
export async function loadFeedbackForPairs(
  queryable: Pick<PoolClient, "query">, pairs: Array<[number, number]>, limit = 5,
): Promise<Map<string, FeedbackPrecedent[]>> {
  const byKey = new Map<string, FeedbackPrecedent[]>();
  if (!pairs.length) return byKey;
  const ids = [...new Set(pairs.flatMap(([a, b]) => [a, b]))];
  const { rows } = await queryable.query<{
    a_id: string; b_id: string; outcome: FeedbackOutcome; source: FeedbackSource; note: string | null; created_at: string;
  }>(`
    SELECT a_id::text,b_id::text,outcome,source,note,created_at::text
      FROM ingest.curation_merge_feedback
     WHERE kind='artist' AND a_id = ANY($1::bigint[]) AND b_id = ANY($1::bigint[])
     ORDER BY created_at DESC`, [ids]);
  const wanted = new Set(pairs.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
  for (const row of rows) {
    const a = Number(row.a_id);
    const b = Number(row.b_id);
    const key = `${a}:${b}`;
    if (!wanted.has(key)) continue;
    const list = byKey.get(key) ?? [];
    if (list.length >= limit) continue;
    list.push({ aId: a, bId: b, outcome: row.outcome, source: row.source, note: row.note, createdAt: row.created_at });
    byKey.set(key, list);
  }
  return byKey;
}
