// Plan 20/20 · E3-05: ciclo completo de propuestas IA en una copia desechable de la base (staging).
// Cuatro artistas: acepta cambio por cambio (Jeremías, Caramelos, Apache) o el conjunto (Banana), deshace
// todo y comprueba que el catálogo (public + media) vuelve fila por fila al estado inicial. Además:
// una edición posterior bloquea el deshacer hasta deshacerla primero, una ficha cambiada invalida la
// propuesta hasta actualizarla, y dos decisiones simultáneas no se pisan.
// Uso: CRV_STAGING=1 DATABASE_URL=postgresql://…:55433/crv npx tsx scripts/stage3-e305-cycle.ts
// Nunca contra la base de desarrollo: se niega si el puerto es 5433 o si falta CRV_STAGING=1.
import { mkdir, writeFile } from "node:fs/promises";
import { closeDb, getPool } from "../src/db/client.js";
import { addStats, coherentSummary, consolidateDraft, finalizeDoubts, settleRegisteredRelations } from "../src/curation/ai/plan-coherence.js";
import { applyPlan, decidePlan, getPlan, refreshPlan, savePlan } from "../src/curation/ai/store.js";
import { executePlan } from "../src/curation/ai/executor.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { previewRunUndo, undoRun } from "../src/merge/run-undo.js";
import { waitForCurationScans } from "../src/curation/scan.js";
const R = process.cwd();
const url = process.env["DATABASE_URL"] ?? "";
if (process.env["CRV_STAGING"] !== "1" || /:5433\//.test(url)) throw new Error("Solo contra staging: CRV_STAGING=1 y un DATABASE_URL distinto del de desarrollo.");
const db = getPool();
const OPERATOR = "plan20-e305";
const log: string[] = [];
const say = (line: string) => { log.push(line); console.log(line); };
const message = (error: unknown) => error instanceof Error ? `${(error as { code?: string }).code ?? "error"}: ${error.message}` : String(error);

async function snapshot(): Promise<Record<string, string>> {
  const tables = (await db.query<{ t: string }>("SELECT format('%I.%I',n.nspname,c.relname) t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','media') AND c.relkind='r' ORDER BY 1")).rows.map(r => r.t);
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = (await db.query<{ h: string }>(`SELECT count(*)||':'||coalesce(md5(string_agg(x::text,E'\\n' ORDER BY x::text)),'') h FROM ${t} x`)).rows[0]!.h;
  return out;
}
const differences = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter(t => a[t] !== b[t]);

/** The same closing pass the planner runs now, without the model's doubt grouping (no spend in staging). */
async function closeAndSave(id: number) {
  const plan = await getPlan(id);
  const root = { kind: plan.entityKind, id: plan.entityId };
  const first = consolidateDraft(plan.draft!);
  const second = consolidateDraft(await settleRegisteredRelations(db, first.draft, first.stats, root));
  const stats = addStats(first.stats, second.stats);
  const final = finalizeDoubts(second.draft, stats);
  return savePlan(id, plan.revision, { ...final, summary: coherentSummary(final, stats, 0) }, plan.reviewedKeys, OPERATOR);
}
const readyKeys = (plan: Awaited<ReturnType<typeof getPlan>>) => {
  const items = new Map((plan.preview?.items ?? []).map(item => [item.key, item]));
  return plan.draft!.operations.filter(op => op.enabled && !plan.decisions?.[op.key] && items.has(op.key) && !items.get(op.key)!.error).map(op => op.key);
};
/** Accepts every currently valid change, one click each, re-reading the plan between clicks. */
async function acceptAll(id: number) {
  const accepted: Array<{ key: string; runId: number }> = [], failed: Array<{ key: string; error: string }> = [];
  for (;;) {
    const plan = await getPlan(id);
    const key = readyKeys(plan).find(k => !failed.some(f => f.key === k));
    if (!key) break;
    try {
      const next = await decidePlan(id, plan.revision, key, "accepted", OPERATOR);
      accepted.push({ key, runId: next.decisions![key]!.runId! });
    } catch (error) { failed.push({ key, error: message(error) }); }
  }
  return { accepted, failed };
}
async function undoAll(runs: number[]) {
  const results: Array<{ runId: number; ok: boolean; error?: string }> = [];
  for (const runId of [...runs].reverse()) {
    try { await withOperatorRun({ name: "plan20:e305-undo", operator: OPERATOR, note: `E3-05: deshacer #${runId}` }, ctx => undoRun(ctx, runId)); results.push({ runId, ok: true }); }
    catch (error) { results.push({ runId, ok: false, error: message(error) }); }
  }
  return results;
}
/** Another administrator's later edit, through the same editorial path (journaled, own run). */
async function laterEdit(target: { kind: "artist" | "album" | "person"; id: number }, values: Record<string, string | number | null>, label: string) {
  const draft = { summary: "", unresolved: [], operations: [{ key: "later", label, reason: "Edición posterior de otro administrador (E3-05)", evidenceIds: [], enabled: true, op: "replace_fields" as const, target, values }] };
  const { runId } = await withOperatorRun({ name: "plan20:e305-later", operator: "otro-admin", note: label }, ctx => executePlan(ctx, target, draft as never, [], ["later"], { preview: false }));
  return runId;
}

const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), database: url.replace(/:[^:@/]*@/, ":***@") };
const s0 = await snapshot();
say(`instantánea inicial: ${Object.keys(s0).length} tablas de public y media`);

// 1. Banana (1212): la propuesta 5 se implementó como conjunto en desarrollo (run 18942). Se deshace,
//    se copia como propuesta nueva, se implementa entera de nuevo y se deshace otra vez.
{
  const banana: Record<string, unknown> = {};
  const old = await getPlan(5);
  banana["previewUndoOld"] = await (async () => { const c = await db.connect(); try { const p = await previewRunUndo(c, old.runId!); return { undoable: p.undoable, reason: p.reason }; } finally { c.release(); } })();
  banana["undoOld"] = await undoAll([old.runId!]);
  const sBase = await snapshot();
  const copy = (await db.query<{ id: number }>(`INSERT INTO ingest.ai_curation_plans(entity_kind,entity_id,instruction,status,phase,draft,evidence,reviewed_keys,usage,requested_by,revision)
    SELECT entity_kind,entity_id,instruction,'ready','ready',draft,evidence,'{}',usage,$1,1 FROM ingest.ai_curation_plans WHERE id=5 RETURNING id::int`, [OPERATOR])).rows[0]!.id;
  let plan = await savePlan(copy, 1, old.draft!, [], OPERATOR);
  banana["copy"] = copy;
  banana["preview"] = { ready: plan.preview?.ready, errors: plan.preview?.items.filter(i => i.error).map(i => `${i.label}: ${i.error}`) };
  try {
    plan = await applyPlan(copy, plan.revision, plan.preview!.hash, true, OPERATOR);
    banana["applied"] = { status: plan.status, runId: plan.runId };
    banana["afterApplyDiffers"] = differences(sBase, await snapshot());
    banana["undo"] = await undoAll([plan.runId!]);
    banana["undoneFlag"] = (await getPlan(copy)).status;
  } catch (error) { banana["applyError"] = message(error); }
  banana["backToBase"] = differences(sBase, await snapshot());
  report["banana"] = banana;
  say(`Banana: ${JSON.stringify(banana).slice(0, 600)}`);
}
const sAfterBanana = await snapshot();

// 2. Jeremías (6912, propuesta 58): dos decisiones simultáneas, luego todo lo válido cambio por cambio.
// 3. Caramelos (58, propuestas 64 y 63) y Apache (1681, propuesta 3): cambio por cambio.
const perPlan: Record<string, unknown> = {};
const allRuns: number[] = [];
for (const id of [58, 64, 63, 3]) {
  const row: Record<string, unknown> = {};
  let plan = await closeAndSave(id);
  row["entity"] = `${plan.entityKind} ${plan.entityId}`;
  row["operations"] = plan.draft!.operations.length;
  row["readyBefore"] = readyKeys(plan).length;
  if (id === 58) {
    const [a, b] = readyKeys(plan);
    if (a && b) {
      const both = await Promise.allSettled([decidePlan(id, plan.revision, a, "accepted", OPERATOR), decidePlan(id, plan.revision, b, "accepted", OPERATOR)]);
      row["simultaneousDifferent"] = both.map(r => r.status === "fulfilled" ? "aplicada" : message(r.reason));
      for (const key of [a, b]) { const d = (await getPlan(id)).decisions?.[key]; if (d?.runId) allRuns.push(d.runId); }
      plan = await getPlan(id);
      const [c] = readyKeys(plan);
      if (c) {
        const same = await Promise.allSettled([decidePlan(id, plan.revision, c, "accepted", OPERATOR), decidePlan(id, plan.revision, c, "accepted", OPERATOR)]);
        const runs = (await db.query<{ n: number }>("SELECT count(*)::int n FROM ingest.scrape_runs WHERE params->>'action'='ai-curation:accept' AND params->>'proposalId'=$1 AND params->>'operationKey'=$2 AND status='ok'", [String(id), c])).rows[0]!.n;
        row["simultaneousSame"] = { results: same.map(r => r.status === "fulfilled" ? "aplicada" : message(r.reason)), committedRuns: runs };
        const d = (await getPlan(id)).decisions?.[c]; if (d?.runId) allRuns.push(d.runId);
        plan = await getPlan(id);
        const [e] = readyKeys(plan);
        if (e) {
          const mixed = await Promise.allSettled([decidePlan(id, plan.revision, e, "accepted", OPERATOR), decidePlan(id, plan.revision, e, "rejected", OPERATOR)]);
          const final = (await getPlan(id)).decisions?.[e];
          row["simultaneousAcceptReject"] = { results: mixed.map(r => r.status === "fulfilled" ? "ok" : message(r.reason)), final: final?.decision ?? null };
          if (final?.runId) allRuns.push(final.runId);
        }
      }
    }
  }
  if (id === 3) {
    // Ficha cambiada después de preparar: aceptar debe pedir actualizar; tras actualizar, se acepta.
    const [key] = readyKeys(plan);
    if (key) {
      const laterRun = await laterEdit({ kind: "artist", id: plan.entityId }, { notes: `Nota posterior de prueba E3-05 ${Date.now()}` }, "E3-05: otro administrador edita la ficha");
      let stale: string;
      try { await decidePlan(id, plan.revision, key, "accepted", OPERATOR); stale = "aceptada sin pedir actualizar"; } catch (error) { stale = message(error); }
      plan = await refreshPlan(id, (await getPlan(id)).revision, OPERATOR);
      row["staleAfterLaterEdit"] = { laterRun, decide: stale, readyAfterRefresh: readyKeys(plan).length };
      allRuns.push(laterRun);
    }
  }
  const { accepted, failed } = await acceptAll(id);
  allRuns.push(...accepted.map(a => a.runId));
  plan = await getPlan(id);
  row["accepted"] = accepted.length;
  row["failed"] = failed;
  row["statusAfter"] = `${plan.status}/${plan.phase}`;
  row["undecided"] = plan.draft!.operations.filter(op => !plan.decisions?.[op.key]).length;
  perPlan[id] = row;
  say(`propuesta ${id}: ${JSON.stringify(row).slice(0, 700)}`);
}
report["plans"] = perPlan;
const sWritten = await snapshot();
report["writtenTables"] = differences(sAfterBanana, sWritten);

// 4. Conflicto posterior: otra edición sobre una fila que tocó un cambio aceptado bloquea su deshacer;
//    deshaciendo antes la edición posterior, el cambio aceptado se deshace.
{
  const conflict: Record<string, unknown> = {};
  const plans = await Promise.all([58, 64, 63, 3].map(id => getPlan(id)));
  const target = plans.flatMap(p => p.draft!.operations.filter(op => op.op === "replace_fields" && p.decisions?.[op.key]?.decision === "accepted" && p.decisions[op.key]!.runId).map(op => ({ p, op })))[0];
  if (target && target.op.op === "replace_fields") {
    const runId = target.p.decisions![target.op.key]!.runId!;
    const ref = target.op.target as { kind: "artist" | "album" | "person"; id?: number; key?: string };
    const id = ref.id ?? target.p.result?.created?.[ref.key!]?.id;
    const field = Object.keys(target.op.values)[0]!;
    const value = typeof target.op.values[field] === "number" ? (target.op.values[field] as number) + 1 : `${String(target.op.values[field] ?? "")} (editado después)`.slice(0, 200);
    const laterRun = await laterEdit({ kind: ref.kind, id: id! }, { [field]: value }, `E3-05: edición posterior de ${field}`);
    conflict["acceptedRun"] = runId; conflict["laterRun"] = laterRun; conflict["field"] = `${ref.kind} ${id} ${field}`;
    const blocked = await undoAll([runId]);
    conflict["undoBeforeLater"] = blocked[0];
    conflict["undoInOrder"] = await undoAll([runId, laterRun]);
    allRuns.splice(allRuns.indexOf(runId), 1);
  } else conflict["skipped"] = "ningún replace_fields aceptado";
  report["conflict"] = conflict;
  say(`conflicto: ${JSON.stringify(conflict).slice(0, 700)}`);
}

// 5. Deshacer todo lo demás en orden inverso y comparar con el estado anterior a las aceptaciones.
const undone = await undoAll(allRuns);
report["undo"] = { runs: undone.length, failed: undone.filter(u => !u.ok) };
const decisionsUndone = await Promise.all([58, 64, 63, 3].map(async id => { const p = await getPlan(id); return [id, Object.values(p.decisions ?? {}).filter(d => d.decision === "accepted").map(d => d.undone)] as const; }));
report["decisionsMarkedUndone"] = Object.fromEntries(decisionsUndone.map(([id, flags]) => [id, `${flags.filter(Boolean).length}/${flags.length}`]));
const sFinal = await snapshot();
report["backToStart"] = differences(sAfterBanana, sFinal);
say(`deshacer: ${undone.filter(u => u.ok).length}/${undone.length}; tablas distintas del estado previo: ${JSON.stringify(report["backToStart"])}`);
await waitForCurationScans();
report["log"] = log;
await mkdir(R + "/reports/plan-20-de-20/etapa-3/e305", { recursive: true });
await writeFile(R + "/reports/plan-20-de-20/etapa-3/e305/cycle.json", JSON.stringify(report, null, 1));
await closeDb();
