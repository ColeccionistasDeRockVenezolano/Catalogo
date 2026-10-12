import { getPool } from "../../db/client.js";
import { getEnv } from "../../config/env.js";
import { withOperatorRun, OperatorError, type OperatorContext } from "../../merge/operator.js";
import { activeUndoOf } from "../../merge/run-undo.js";
import { runCurationScan, trackCurationWork } from "../scan.js";
import { entityRow, hashValue } from "./context.js";
import { draftSchema } from "./schema.js";
import { executePlan, planState } from "./executor.js";
import { remainingDecisionDraft, resolveDecisionOperation, resolveDecisionRef } from "./decisions.js";
import { planWithDeepSeek, type PlannedDraft } from "./planner.js";
import type {
  CatalogDraft,
  CatalogEvidence,
  CatalogKind,
  CatalogPlan,
  CatalogPreview,
  CatalogDecision,
} from "./types.js";

const columns = `id::int,entity_kind AS "entityKind",entity_id::int AS "entityId",instruction,status,phase,revision,draft,evidence,reviewed_keys AS "reviewedKeys",decisions,preview,result,usage,requested_by AS "requestedBy",edited_by AS "editedBy",applied_by AS "appliedBy",error,run_id::int AS "runId",created_at::text AS "createdAt",updated_at::text AS "updatedAt"`;
const pending = new Set<Promise<void>>();
async function withUndoState(plan: CatalogPlan): Promise<CatalogPlan> {
  for (const decision of Object.values(plan.decisions ?? {})) {
    if (decision.decision === "accepted" && decision.runId)
      decision.undone = await activeUndoOf(getPool(), decision.runId) !== null;
  }
  return plan;
}
export async function getPlan(id: number): Promise<CatalogPlan> {
  const row = (
    await getPool().query<CatalogPlan>(
      `SELECT ${columns} FROM ingest.ai_curation_plans WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new OperatorError("not_found", `Propuesta ${id} inexistente`);
  return withUndoState(row);
}
export async function listPlans(
  kind?: CatalogKind,
  id?: number,
): Promise<CatalogPlan[]> {
  const rows = (
    await getPool().query<CatalogPlan>(
      `SELECT ${columns} FROM ingest.ai_curation_plans WHERE ($1::text IS NULL OR entity_kind=$1) AND ($2::bigint IS NULL OR entity_id=$2) ORDER BY id DESC LIMIT 30`,
      [kind ?? null, id ?? null],
    )
  ).rows;
  return Promise.all(rows.map(withUndoState));
}
export async function recoverPlans(): Promise<void> {
  await getPool().query(
    "UPDATE ingest.ai_curation_plans SET status='failed',error='La preparación se interrumpió. El catálogo no cambió; puedes preparar otra propuesta.',updated_at=now() WHERE status IN ('queued','running')",
  );
}
export async function waitForPlans(): Promise<void> {
  await Promise.allSettled([...pending]);
}
export type PlanWork = (
  kind: CatalogKind,
  id: number,
  instruction: string,
  notify: (phase: string, usage: CatalogPlan["usage"]) => Promise<void>,
) => Promise<PlannedDraft>;
export async function startPlan(
  kind: CatalogKind,
  id: number,
  instruction: string,
  operator: string,
  work: PlanWork = planWithDeepSeek,
): Promise<CatalogPlan> {
  if (work === planWithDeepSeek && !getEnv().DEEPSEEK_API_KEY)
    throw new OperatorError(
      "invalid",
      "Configura DEEPSEEK_API_KEY para preparar propuestas.",
    );
  await entityRow(getPool(), kind, id);
  const existing = (
    await getPool().query<CatalogPlan>(
      `SELECT ${columns} FROM ingest.ai_curation_plans WHERE entity_kind=$1 AND entity_id=$2 AND status IN ('queued','running')`,
      [kind, id],
    )
  ).rows[0];
  if (existing) {
    if (existing.instruction === instruction) return existing;
    throw new OperatorError(
      "not_open",
      "Esta ficha ya tiene una propuesta en preparación.",
    );
  }
  let created: CatalogPlan;
  try {
    created = (
      await getPool().query<CatalogPlan>(
        `INSERT INTO ingest.ai_curation_plans(entity_kind,entity_id,instruction,requested_by) VALUES($1,$2,$3,$4) RETURNING ${columns}`,
        [kind, id, instruction, operator],
      )
    ).rows[0]!;
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new OperatorError(
        "not_open",
        "Esta ficha ya tiene una propuesta en preparación.",
      );
    throw error;
  }
  const task = prepare(created, work);
  pending.add(task);
  void task.finally(() => pending.delete(task));
  return created;
}
async function previewDraft(
  plan: CatalogPlan,
  draft: CatalogDraft,
  evidence: CatalogEvidence[],
  reviewedKeys: string[],
): Promise<CatalogPreview> {
  try {
    const { result } = await withOperatorRun(
      {
        name: "ai-curation:preview",
        operator: plan.requestedBy,
        note: `Vista previa de propuesta ${plan.id}`,
      },
      async (ctx) => ({ preview: await decisionPreview(ctx, plan, draft, evidence, reviewedKeys) }),
      { rollbackOnly: true, serializable: true },
    );
    return result.preview;
  } catch (error) {
    return {
      hash: "",
      ready: false,
      sensitive: false,
      affected: [],
      items: [
        {
          key: "plan",
          op: "replace_fields",
          label: "Validación de la propuesta",
          before: null,
          after: null,
          warnings: [],
          error: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
async function decisionPreview(context: OperatorContext, plan: CatalogPlan, input: CatalogDraft, evidence: CatalogEvidence[], reviewedKeys: string[]): Promise<CatalogPreview> {
  const root = resolveDecisionRef(plan, { kind: plan.entityKind, id: plan.entityId });
  const draft = remainingDecisionDraft(plan, input);
  const operationHashes: Record<string, string> = {};
  for (const op of draft.operations.filter((item) => item.enabled)) {
    try {
      const single = { ...draft, operations: [resolveDecisionOperation(plan, op)] };
      const state = await planState(context.client, root, single, true);
      operationHashes[op.key] = hashValue({ executionVersion: 1, root, draft: single, state: state.state });
    } catch { /* Pending dependencies or missing entities are validated below; other proposals retain their own snapshots. */ }
  }
  try {
    return { ...(await executePlan(context, root, draft, evidence, reviewedKeys, { preview: true })).preview, operationHashes };
  } catch (error) {
    return { hash: "", operationHashes, ready: false, sensitive: false, affected: [], items: [{ key: "plan", op: "replace_fields", label: "Cambios pendientes", before: null, after: null, warnings: [], error: error instanceof Error ? error.message : String(error) }] };
  }
}
async function prepare(plan: CatalogPlan, work: PlanWork): Promise<void> {
  try {
    await getPool().query(
      "UPDATE ingest.ai_curation_plans SET status='running',updated_at=now() WHERE id=$1",
      [plan.id],
    );
    const notify=async (phase:string, usage:CatalogPlan["usage"]) => {
      await getPool().query("UPDATE ingest.ai_curation_plans SET phase=$2,usage=$3::jsonb,updated_at=now() WHERE id=$1 AND status='running'",[plan.id,phase,JSON.stringify(usage)]);
    };
    const result = work===planWithDeepSeek
      ? await planWithDeepSeek(plan.entityKind,plan.entityId,plan.instruction,notify,undefined,{planId:plan.id})
      : await work(plan.entityKind,plan.entityId,plan.instruction,notify);
    const draft = draftSchema.parse(result.draft);
    await getPool().query(
      "UPDATE ingest.ai_curation_plans SET phase='preview',updated_at=now() WHERE id=$1",
      [plan.id],
    );
    const preview = await previewDraft(plan, draft, result.evidence, []);
    await getPool().query(
      "UPDATE ingest.ai_curation_plans SET status='ready',phase='ready',draft=$2::jsonb,evidence=$3::jsonb,preview=$4::jsonb,usage=$5::jsonb,error=NULL,updated_at=now() WHERE id=$1",
      [
        plan.id,
        JSON.stringify(draft),
        JSON.stringify(result.evidence),
        JSON.stringify(preview),
        JSON.stringify(result.usage),
      ],
    );
  } catch (error) {
    await getPool()
      .query(
        "UPDATE ingest.ai_curation_plans SET status='failed',error=$2,updated_at=now() WHERE id=$1",
        [
          plan.id,
          error instanceof Error
            ? error.message.slice(0, 600)
            : "No se pudo preparar la propuesta",
        ],
      )
      .catch(() => undefined);
  }
}
export async function savePlan(
  id: number,
  revision: number,
  input: CatalogDraft,
  reviewedKeys: string[],
  operator: string,
): Promise<CatalogPlan> {
  const plan = await getPlan(id);
  if (plan.status !== "ready" || plan.revision !== revision)
    throw new OperatorError(
      "stale_preview",
      "La propuesta cambió o ya fue implementada. Recarga antes de editar.",
    );
  const draft = draftSchema.parse(input);
  for (const op of plan.draft?.operations ?? [])
    if (plan.decisions?.[op.key] && hashValue(op) !== hashValue(draft.operations.find((next) => next.key === op.key)))
      throw new OperatorError("invalid", "Un cambio ya decidido no puede editarse. Puedes deshacerlo desde el historial.");
  const keys = new Set(draft.operations.map((o) => o.key));
  if (reviewedKeys.some((k) => !keys.has(k)))
    throw new OperatorError(
      "invalid",
      "Una decisión editorial apunta a una operación inexistente.",
    );
  const preview = await previewDraft(plan, draft, plan.evidence, reviewedKeys);
  const saved = await getPool().query(
    `UPDATE ingest.ai_curation_plans SET draft=$3::jsonb,reviewed_keys=$4,preview=$5::jsonb,edited_by=$6,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND status='ready' RETURNING id`,
    [
      id,
      revision,
      JSON.stringify(draft),
      reviewedKeys,
      JSON.stringify(preview),
      operator,
    ],
  );
  if (!saved.rowCount)
    throw new OperatorError(
      "stale_preview",
      "Otro administrador modificó la propuesta. Recarga antes de guardar.",
    );
  return getPlan(id);
}
export async function applyPlan(
  id: number,
  revision: number,
  previewHash: string,
  confirmSensitive: boolean,
  operator: string,
): Promise<CatalogPlan> {
  const first = await getPlan(id);
  if (Object.keys(first.decisions ?? {}).length)
    throw new OperatorError("invalid", "Esta propuesta se revisa cambio por cambio. Acepta o rechaza los cambios pendientes.");
  if (first.status === "applied") return first;
  if (
    first.status !== "ready" ||
    !first.preview?.ready ||
    first.revision !== revision ||
    first.preview.hash !== previewHash
  )
    throw new OperatorError(
      "stale_preview",
      "Guarda y valida la propuesta antes de implementar.",
    );
  if (first.preview.sensitive && !confirmSensitive)
    throw new OperatorError(
      "invalid",
      "Confirma que revisaste las fusiones o retiradas de esta propuesta.",
    );
  try {
    await withOperatorRun(
      {
        name: "ai-curation:implement",
        operator,
        note: `Implementación autorizada de propuesta ${id}`,
        params: {
          proposalId: id,
          revision,
          model: first.usage.model,
          instruction: first.instruction,
          draft: first.draft,
          evidence: first.evidence,
        },
      },
      async (context) => {
        const locked = (
          await context.client.query<CatalogPlan>(
            `SELECT ${columns} FROM ingest.ai_curation_plans WHERE id=$1 FOR UPDATE`,
            [id],
          )
        ).rows[0]!;
        if (locked.status === "applied")
          throw new OperatorError(
            "already_exists",
            "Esta propuesta ya se implementó.",
          );
        if (
          locked.status !== "ready" ||
          locked.revision !== revision ||
          locked.preview?.hash !== previewHash
        )
          throw new OperatorError(
            "stale_preview",
            "La propuesta cambió antes de implementar.",
          );
        const draft = draftSchema.parse(locked.draft);
        const result = await executePlan(
          context,
          { kind: locked.entityKind, id: locked.entityId },
          draft,
          locked.evidence,
          locked.reviewedKeys,
          { preview: false, expectedHash: previewHash },
        );
        await context.client.query(
          "UPDATE ingest.ai_curation_plans SET status='applied',phase='verifying',applied_by=$2,run_id=$3,result=$4::jsonb,updated_at=now() WHERE id=$1",
          [
            id,
            operator,
            context.runId,
            JSON.stringify({ runId: context.runId, created: result.created }),
          ],
        );
      },
      { serializable: true },
    );
  } catch (error) {
    if (error instanceof OperatorError && error.code === "already_exists") {
      const existing = await getPlan(id);
      if (existing.status === "applied") return existing;
    }
    if ((error as { code?: string }).code === "40001")
      throw new OperatorError(
        "stale_preview",
        "El catálogo cambió durante la operación. Valida de nuevo; no se aplicó ningún cambio.",
      );
    throw error;
  }
  const applied = await getPlan(id);
  const refs = [
    ...(applied.preview?.affected ?? []),
    ...Object.values(applied.result?.created ?? {}),
  ];
  void trackCurationWork(
    runCurationScan({
      trigger: "correccion",
      requestedBy: operator,
      detail: `Propuesta IA ${id}`,
      focus: refs.map((r) => ({ kind: r.kind, id: r.id })),
    }).then(async (verification) => {
      await getPool().query(
        "UPDATE ingest.ai_curation_plans SET result=jsonb_set(result,'{verification}',$2::jsonb),phase='done',updated_at=now() WHERE id=$1",
        [id, JSON.stringify(verification)],
      );
    }),
  ).catch(async () => {
    await getPool()
      .query(
        "UPDATE ingest.ai_curation_plans SET phase='verification_failed',updated_at=now() WHERE id=$1",
        [id],
      )
      .catch(() => undefined);
  });
  return applied;
}

/** A click accepts exactly one visible proposal. Validation and the catalog write are atomic. */
export async function decidePlan(
  id: number,
  revision: number,
  key: string,
  decision: "accepted" | "rejected",
  operator: string,
): Promise<CatalogPlan> {
  const first = await getPlan(id);
  const previous = first.decisions?.[key];
  if (previous?.decision === decision) return first;
  if (previous) throw new OperatorError("not_open", "Este cambio ya fue decidido. Puedes deshacerlo desde el historial.");
  if (first.status !== "ready" || first.revision !== revision || !first.draft)
    throw new OperatorError("stale_preview", "La propuesta cambió. Actualízala antes de decidir.");
  const operation = first.draft.operations.find((op) => op.key === key);
  if (!operation) throw new OperatorError("invalid", "El cambio no pertenece a esta propuesta.");
  if (decision === "rejected") {
    const next = { ...first, decisions: { ...first.decisions, [key]: { decision, decidedBy: operator, decidedAt: new Date().toISOString(), runId: null } } };
    const preview = await previewDraft(next, next.draft!, next.evidence, next.reviewedKeys);
    const finished = next.draft!.operations.every((op) => next.decisions[op.key]);
    const saved = await getPool().query(
      "UPDATE ingest.ai_curation_plans SET decisions=$3::jsonb,preview=$4::jsonb,edited_by=$5,revision=revision+1,status=$6,phase=$7,updated_at=now() WHERE id=$1 AND revision=$2 AND status='ready' RETURNING id",
      [id, revision, JSON.stringify(next.decisions), JSON.stringify(preview), operator, finished ? "reviewed" : "ready", finished ? "done" : "ready"],
    );
    if (!saved.rowCount) {
      const latest = await getPlan(id);
      if (latest.decisions?.[key]?.decision === decision) return latest;
      throw new OperatorError("stale_preview", "Otro administrador decidió sobre esta propuesta. Actualízala.");
    }
    return getPlan(id);
  }

  let affected: CatalogPreview["affected"] = [];
  try {
    await withOperatorRun(
      { name: "ai-curation:accept", operator, note: `Aceptar «${operation.label}» de propuesta ${id}`, params: { proposalId: id, operationKey: key, operation, evidence: first.evidence } },
      async (context: OperatorContext) => {
        const locked = (await context.client.query<CatalogPlan>(`SELECT ${columns} FROM ingest.ai_curation_plans WHERE id=$1 FOR UPDATE`, [id])).rows[0]!;
        if (locked.decisions?.[key]) throw new OperatorError("already_exists", "Este cambio ya fue decidido.");
        if (locked.status !== "ready" || locked.revision !== revision)
          throw new OperatorError("stale_preview", "La propuesta cambió antes de aplicar el cambio. Actualízala.");
        await withUndoState(locked);
        const root = resolveDecisionRef(locked, { kind: locked.entityKind, id: locked.entityId });
        const op = resolveDecisionOperation(locked, operation);
        const remaining = remainingDecisionDraft(locked);
        const specificHash = locked.preview?.operationHashes?.[key];
        const snapshotDraft = specificHash ? { ...remaining, operations: [op] } : remaining;
        const state = await planState(context.client, root, snapshotDraft, true);
        const hash = hashValue({ executionVersion: 1, root, draft: snapshotDraft, state: state.state });
        const expectedHash = specificHash ?? locked.preview?.hash;
        if (expectedHash && expectedHash !== hash)
          throw new OperatorError("stale_preview", "La ficha cambió desde esta propuesta. Actualiza los cambios para ver los datos actuales.");
        let result: Awaited<ReturnType<typeof executePlan>>;
        try {
          result = await executePlan(context, root, { summary: locked.draft!.summary, unresolved: [], operations: [op] }, locked.evidence, [key], { preview: false });
        } catch (error) {
          if (error instanceof OperatorError) throw error;
          throw new OperatorError("invalid", error instanceof Error ? error.message : "No se pudo validar este cambio.");
        }
        affected = result.preview.affected;
        const accepted: CatalogDecision = { decision, decidedBy: operator, decidedAt: new Date().toISOString(), runId: context.runId, preview: result.preview.items[0]! };
        const next: CatalogPlan = { ...locked, decisions: { ...locked.decisions, [key]: accepted }, result: { runId: context.runId, created: { ...locked.result?.created, ...result.created } } };
        // Remaining proposals are simulated in this same transaction, then rolled back to the accepted change.
        await context.client.query("SAVEPOINT remaining_preview");
        let preview: CatalogPreview;
        try {
          preview = await decisionPreview(context, next, next.draft!, next.evidence, next.reviewedKeys);
        } catch (error) {
          preview = { hash: "", ready: false, sensitive: false, affected: [], items: [{ key: "plan", op: "replace_fields", label: "Cambios pendientes", before: null, after: null, warnings: [], error: error instanceof Error ? error.message : String(error) }] };
        }
        await context.client.query("ROLLBACK TO SAVEPOINT remaining_preview");
        await context.client.query("RELEASE SAVEPOINT remaining_preview");
        const finished = next.draft!.operations.every((item) => next.decisions?.[item.key]);
        await context.client.query(
          "UPDATE ingest.ai_curation_plans SET decisions=$2::jsonb,preview=$3::jsonb,result=$4::jsonb,run_id=$5,applied_by=$6,edited_by=$6,revision=revision+1,status=$7,phase=$8,updated_at=now() WHERE id=$1",
          [id, JSON.stringify(next.decisions), JSON.stringify(preview), JSON.stringify(next.result), context.runId, operator, finished ? "reviewed" : "ready", finished ? "done" : "ready"],
        );
      },
      { serializable: true },
    );
  } catch (error) {
    if (error instanceof OperatorError && error.code === "already_exists") {
      const latest = await getPlan(id);
      if (latest.decisions?.[key]?.decision === decision) return latest;
    }
    if ((error as { code?: string }).code === "40001")
      throw new OperatorError("stale_preview", "La ficha cambió durante la aplicación. Actualízala; este cambio no se aplicó.");
    throw error;
  }
  void trackCurationWork(runCurationScan({ trigger: "correccion", requestedBy: operator, detail: `Cambio aceptado de propuesta IA ${id}: ${key}`, focus: affected.map(({ kind, id }) => ({ kind, id })) })).catch(() => undefined);
  return getPlan(id);
}

/** Refresh validation internally; this never accepts proposals or writes catalog data. */
export async function refreshPlan(id: number, revision: number, operator: string): Promise<CatalogPlan> {
  const plan = await getPlan(id);
  return savePlan(id, revision, plan.draft!, plan.reviewedKeys, operator);
}
