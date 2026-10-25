// Plan 20/20 · E3-05 (complemento): la propuesta 5 de La Banda de la Banana Voladora se implementó como
// conjunto el 10-10 y el catálogo cambió después (el álbum 3826 ya no existe). En staging se copia, se retiran
// solo las operaciones que la vista previa bloquea, se implementa el resto como conjunto, se deshace y se
// compara el catálogo (public + media) fila por fila con el estado anterior.
// Uso: CRV_STAGING=1 DATABASE_URL=postgresql://…:55433/crv npx tsx scripts/stage3-e305-banana.ts <id de la copia>
import { mkdir, writeFile } from "node:fs/promises";
import { closeDb, getPool } from "../src/db/client.js";
import { applyPlan, getPlan, savePlan } from "../src/curation/ai/store.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { undoRun } from "../src/merge/run-undo.js";
import { waitForCurationScans } from "../src/curation/scan.js";
const R = process.cwd();
const url = process.env["DATABASE_URL"] ?? "";
if (process.env["CRV_STAGING"] !== "1" || /:5433\//.test(url)) throw new Error("Solo contra staging: CRV_STAGING=1 y un DATABASE_URL distinto del de desarrollo.");
const copy = Number(process.argv[2]);
const db = getPool();
const OPERATOR = "plan20-e305";
async function snapshot(): Promise<Record<string, string>> {
  const tables = (await db.query<{ t: string }>("SELECT format('%I.%I',n.nspname,c.relname) t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','media') AND c.relkind='r' ORDER BY 1")).rows.map(r => r.t);
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = (await db.query<{ h: string }>(`SELECT count(*)||':'||coalesce(md5(string_agg(x::text,E'\\n' ORDER BY x::text)),'') h FROM ${t} x`)).rows[0]!.h;
  return out;
}
const differences = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter(t => a[t] !== b[t]);
const result: Record<string, unknown> = { copy };
let plan = await getPlan(copy);
// The plan-level item names the missing record; every operation that references it is withdrawn with its dependents.
const missing = [...new Set((plan.preview?.items ?? []).flatMap(item => [...(item.error ?? "").matchAll(/(\p{L}+) (\d+) inexistente/gu)].map(m => Number(m[2]))))];
const refs = (op: unknown) => JSON.stringify(op).match(/"id":(\d+)/gu)?.map(m => Number(m.slice(5))) ?? [];
const withdrawn = new Set(plan.draft!.operations.filter(op => refs(op).some(id => missing.includes(id))).map(op => op.key));
for (let changed = true; changed;) { changed = false; for (const op of plan.draft!.operations) if (!withdrawn.has(op.key) && [...withdrawn].some(key => JSON.stringify(op).includes(`"key":"${key}"`))) { withdrawn.add(op.key); changed = true; } }
result["missing"] = missing; result["withdrawn"] = [...withdrawn];
plan = await savePlan(copy, plan.revision, { ...plan.draft!, operations: plan.draft!.operations.filter(op => !withdrawn.has(op.key)) }, [], OPERATOR);
// --edit: the curator edits the proposal before implementing it (the role gets a visible test suffix), so the set writes.
if (process.argv.includes("--edit")) {
  const edited = plan.draft!.operations.map(op => "values" in op && typeof op.values["role"] === "string" ? { ...op, values: { ...op.values, role: `${op.values["role"]} (prueba E3-05)` } } : op);
  plan = await savePlan(copy, plan.revision, { ...plan.draft!, operations: edited as NonNullable<typeof plan.draft>["operations"] }, plan.reviewedKeys, OPERATOR);
}
// --editorial: a curator accepts the remaining evidence gaps as editorial decisions, as the interface allows.
if (process.argv.includes("--editorial")) {
  const gaps = (plan.preview?.items ?? []).filter(item => item.error?.startsWith("Respaldo insuficiente")).map(item => item.key);
  result["editorial"] = gaps;
  plan = await savePlan(copy, plan.revision, plan.draft!, gaps, OPERATOR);
}
result["operations"] = plan.draft!.operations.map(op => op.label);
result["preview"] = { ready: plan.preview?.ready, errors: plan.preview?.items.filter(i => i.error).map(i => `${i.label}: ${i.error}`) };
const before = await snapshot();
if (plan.preview?.ready && plan.draft!.operations.length) {
  plan = await applyPlan(copy, plan.revision, plan.preview.hash, true, OPERATOR);
  result["applied"] = { status: plan.status, runId: plan.runId };
  result["changedTables"] = differences(before, await snapshot());
  try { await withOperatorRun({ name: "plan20:e305-undo", operator: OPERATOR, note: `E3-05: deshacer #${plan.runId}` }, ctx => undoRun(ctx, plan.runId!)); result["undo"] = "ok"; }
  catch (error) { result["undo"] = error instanceof Error ? error.message : String(error); }
  result["backToBase"] = differences(before, await snapshot());
}
await waitForCurationScans();
console.log(JSON.stringify(result));
await mkdir(R + "/reports/plan-20-de-20/etapa-3/e305", { recursive: true });
await writeFile(R + "/reports/plan-20-de-20/etapa-3/e305/banana.json", JSON.stringify(result, null, 1));
await closeDb();
