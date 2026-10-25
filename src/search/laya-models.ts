import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { projectRoot } from "../config/project-root.js";
import { getPool } from "../db/client.js";
import { ApiError } from "../api/http-errors.js";
import { withOperatorRun } from "../merge/operator.js";

/**
 * Etapa 3 · «Laya y evaluación». Las evaluaciones son archivos inmutables en
 * docs/unified-search/stage3/results; activar un modelo solo agrega una fila
 * atribuida que cita esa evaluación por su huella. Nada de esto cambia
 * decisiones humanas ni publica en el buscador público (etapa 4).
 */
const root = projectRoot(import.meta.url);
const RESULTS = "docs/unified-search/stage3/results";
export const LAYA_TASKS = ["query_interpretation", "evidence_typed_decision", "claim_extraction"] as const;

const checkSchema = z.object({ name: z.string(), value: z.number().nullable(), threshold: z.string(), pass: z.boolean() }).passthrough();
export const evaluationSchema = z.object({
  version: z.literal("crv-stage3-evaluation-1"),
  task: z.enum(LAYA_TASKS),
  modelId: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,80}$/u),
  baseRevision: z.string().regex(/^[a-f0-9]{40}$/u),
  weightsSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  card: z.record(z.unknown()),
  criteriaVersion: z.string().min(1),
  evaluatedAt: z.string(),
  reservedTestRuns: z.number().int().min(0),
  datasets: z.record(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u), cases: z.number().int() }).passthrough()),
  checks: z.array(checkSchema).min(1),
  comparison: z.array(z.object({ system: z.string() }).passthrough()),
  passed: z.boolean(),
  notes: z.array(z.string()).default([]),
}).passthrough();
export type LayaEvaluation = z.infer<typeof evaluationSchema>;

export const activationRequestSchema = z.object({
  task: z.enum(LAYA_TASKS),
  modelId: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,80}$/u),
  action: z.enum(["activate", "deactivate"]),
  reason: z.string().trim().min(3).max(1000),
}).strict();

async function readEvaluations() {
  // Las pruebas apuntan a un directorio propio; la ruta registrada sigue siendo relativa al repositorio.
  const dir = process.env["CRV_STAGE3_RESULTS"] ?? path.join(root, RESULTS);
  let files: string[] = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const out: Array<{ path: string; sha256: string; evaluation: LayaEvaluation }> = [];
  for (const file of files) {
    const raw = await readFile(path.join(dir, file));
    const parsed = evaluationSchema.safeParse(JSON.parse(raw.toString("utf8")));
    if (!parsed.success) continue;
    out.push({ path: process.env["CRV_STAGE3_RESULTS"] ? path.join(dir, file) : `${RESULTS}/${file}`, sha256: createHash("sha256").update(raw).digest("hex"), evaluation: parsed.data });
  }
  return out;
}

/** Criterios vigentes: el archivo criteria-<versión>.json más reciente, o criteria.json (1.0.0). */
async function readCurrentCriteria(): Promise<string> {
  const dir = path.join(root, "docs/unified-search/stage3");
  const versioned = (await readdir(dir)).filter(f => /^criteria-\d+\.\d+\.\d+\.json$/u.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return readFile(path.join(dir, versioned.at(-1) ?? "criteria.json"), "utf8");
}

export async function layaAdministration() {
  const db = getPool();
  const [evaluations, criteriaRaw, history, active] = await Promise.all([
    readEvaluations(),
    readCurrentCriteria(),
    db.query(`SELECT id,task,action,model_id,weights_sha256,evaluation_path,evaluation_sha256,criteria_version,passed,actor,reason,run_id,created_at
      FROM ingest.search_model_activations ORDER BY id DESC LIMIT 100`),
    db.query("SELECT task,model_id,evaluation_path,evaluation_sha256,actor,reason,run_id,created_at FROM ingest.search_model_active ORDER BY task"),
  ]);
  const criteria = JSON.parse(criteriaRaw) as { version: string; authority: string; activation: string };
  return {
    criteria: { version: criteria.version, authority: criteria.authority, activation: criteria.activation },
    evaluations: evaluations.map(({ path: p, sha256, evaluation: e }) => ({ path: p, sha256, task: e.task, modelId: e.modelId, passed: e.passed,
      evaluatedAt: e.evaluatedAt, reservedTestRuns: e.reservedTestRuns, criteriaVersion: e.criteriaVersion, checks: e.checks, comparison: e.comparison,
      datasets: e.datasets, notes: e.notes, card: { trainedAt: e.card["trainedAt"] ?? null, bestEpoch: e.card["bestEpoch"] ?? null, train: e.card["train"] ?? null,
        unfreezeLayers: e.card["unfreezeLayers"] ?? null, baseRevision: e.baseRevision, weightsSha256: e.weightsSha256 } })),
    active: active.rows,
    history: history.rows,
    publicUse: false,
  };
}

export async function recordLayaActivation(input: z.infer<typeof activationRequestSchema>, actor: string) {
  const request = activationRequestSchema.parse(input);
  const evaluations = await readEvaluations();
  const found = evaluations.filter(e => e.evaluation.task === request.task && e.evaluation.modelId === request.modelId).at(-1);
  if (!found) throw new ApiError(404, "laya_evaluation_missing", "No hay evaluación registrada de ese modelo para esa tarea");
  if (request.action === "activate" && !found.evaluation.passed)
    throw new ApiError(409, "laya_thresholds_not_met", "La evaluación no cumple los umbrales congelados; el modelo no se activa");
  const e = found.evaluation;
  return withOperatorRun({ name: "search:laya:activation", operator: actor, note: request.reason, params: { task: request.task, modelId: request.modelId, action: request.action } }, async ctx => {
    await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('crv:search-model-activation'))");
    const last = (await ctx.client.query("SELECT action,model_id FROM ingest.search_model_activations WHERE task=$1 ORDER BY id DESC LIMIT 1", [request.task])).rows[0];
    if (request.action === "deactivate" && (!last || last.action !== "activate" || last.model_id !== request.modelId))
      throw new ApiError(409, "laya_not_active", "Ese modelo no está activo para esa tarea");
    if (request.action === "activate" && last?.action === "activate" && last.model_id === request.modelId)
      throw new ApiError(409, "laya_already_active", "Ese modelo ya está activo para esa tarea");
    const row = (await ctx.client.query(`INSERT INTO ingest.search_model_activations
      (task,action,model_id,base_revision,weights_sha256,card,evaluation_path,evaluation_sha256,criteria_version,passed,actor,reason,run_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,created_at`,
    [request.task, request.action, request.modelId, e.baseRevision, e.weightsSha256, e.card, found.path, found.sha256, e.criteriaVersion, e.passed, actor, request.reason, ctx.runId])).rows[0];
    return { id: Number(row.id), createdAt: row.created_at as string, task: request.task, modelId: request.modelId, action: request.action };
  });
}
