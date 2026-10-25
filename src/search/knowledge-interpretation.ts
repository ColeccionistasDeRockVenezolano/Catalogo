import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { getPool } from "../db/client.js";
import { projectRoot } from "../config/project-root.js";
import { getEnv } from "../config/env.js";
import { annotationSchema, type KnowledgeAnnotation } from "./knowledge-contracts.js";
import { hashText } from "./review-protocol.js";
import { ApiError } from "../api/http-errors.js";

const root = projectRoot(import.meta.url);
const execFileAsync = promisify(execFile);
const metadataSchema = z.object({ model: z.literal("multilingual"), modelRevision: z.string().regex(/^[a-f0-9]{40}$/), sdkVersion: z.string().min(1),
  questionVersion: z.string().min(1), questionHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type InterpretationMetadata = z.infer<typeof metadataSchema>;
const answerSchema = z.object({ choice: z.string(), probabilities: z.record(z.number().min(0).max(1)) }).passthrough();
export const modelInterpretationSchema = metadataSchema.extend({ unitKey: z.string().regex(/^[a-f0-9]{64}$/), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  decisions: z.record(answerSchema), routing: z.record(z.unknown()) }).strict();

export function knowledgeModelState(a: KnowledgeAnnotation) {
  return { object: { kind: a.object.kind, name: a.object.name, version: a.object.version, segment: a.object.segment },
    quote: a.observation.quote, candidate: a.proposal && { axis: a.proposal.axis, facet: a.proposal.facet, value: a.proposal.value },
    comparison: a.comparison && { reference: a.comparison.reference.name, aspect: a.comparison.aspect, direction: a.comparison.direction } };
}
async function questionDocument() {
  const raw = await readFile(path.join(root, "docs/unified-search/stage2/laya-evidence-questions.json"), "utf8");
  return { hash: hashText(raw), data: JSON.parse(raw) as { version: string; questions: Record<string, { criteria: Record<string, string> }> } };
}
export async function knowledgeInterpretationTasks(input: InterpretationMetadata, limit = 10) {
  const metadata = metadataSchema.parse(input), doc = await questionDocument();
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Límite de interpretación entre 1 y 20");
  if (metadata.questionHash !== doc.hash || metadata.questionVersion !== doc.data.version) throw new Error("Preguntas cambiaron");
  // Content is immutable per unit. A new model gets a comparable proposal, never
  // another source observation or effective job. Only missing versions are read.
  const rows = (await getPool().query(`SELECT u.id,u.unit_key,u.annotation FROM ingest.search_knowledge_units u
    WHERE NOT EXISTS (SELECT 1 FROM ingest.search_knowledge_interpretations i WHERE i.unit_id=u.id
      AND i.model=$1 AND i.model_revision=$2 AND i.sdk_version=$3 AND i.question_version=$4 AND i.question_hash=$5)
    ORDER BY u.id LIMIT $6`, [metadata.model, metadata.modelRevision, metadata.sdkVersion, metadata.questionVersion, metadata.questionHash, limit])).rows;
  return rows.map(row => {
    const state = knowledgeModelState(annotationSchema.parse(row.annotation));
    return { unitKey: row.unit_key as string, inputHash: hashText(JSON.stringify(state)), state, metadata };
  });
}
export async function importKnowledgeInterpretations(input: unknown) {
  const predictions = z.array(modelInterpretationSchema).max(20).parse(input), doc = await questionDocument();
  const client = await getPool().connect();
  let inserted = 0;
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='5s'");
    for (const p of predictions.sort((a,b) => a.unitKey.localeCompare(b.unitKey))) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`knowledge-interpretation:${p.unitKey}`]);
      if (p.routing["model"] !== p.model || p.questionHash !== doc.hash || p.questionVersion !== doc.data.version || Object.keys(p.decisions).length !== Object.keys(doc.data.questions).length) throw new Error("Preguntas ajenas");
      for (const [key, question] of Object.entries(doc.data.questions)) {
        const a = p.decisions[key], options = Object.keys(question.criteria);
        if (!a || !options.includes(a.choice) || Object.keys(a.probabilities).length !== options.length
          || options.some(o => !Object.hasOwn(a.probabilities, o)) || Math.abs(Object.values(a.probabilities).reduce((s, v) => s + v, 0) - 1) > .01
          || a.probabilities[a.choice] !== Math.max(...Object.values(a.probabilities))) throw new Error("Respuesta tipada inválida");
      }
      const unit = (await client.query("SELECT id,annotation,review_id FROM ingest.search_knowledge_units WHERE unit_key=$1 FOR SHARE", [p.unitKey])).rows[0];
      if (!unit || p.inputHash !== hashText(JSON.stringify(knowledgeModelState(annotationSchema.parse(unit.annotation))))) throw new Error("Objeto o entrada cambiaron");
      const old = (await client.query(`SELECT decisions,routing FROM ingest.search_knowledge_interpretations
        WHERE unit_id=$1 AND model=$2 AND model_revision=$3 AND sdk_version=$4 AND question_version=$5 AND question_hash=$6 AND input_hash=$7`,
      [unit.id, p.model, p.modelRevision, p.sdkVersion, p.questionVersion, p.questionHash, p.inputHash])).rows[0];
      if (old) {
        // Compare JSONB, not property iteration order from Python/TypeScript.
        if (!(await client.query("SELECT $1::jsonb=$2::jsonb AS same", [old.decisions, p.decisions])).rows[0].same) throw new Error("Predicción inmutable en colisión");
        continue;
      }
      const saved = (await client.query(`INSERT INTO ingest.search_knowledge_interpretations
        (unit_id,model,model_revision,sdk_version,question_version,question_hash,input_hash,decisions,routing)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`, [unit.id, p.model, p.modelRevision, p.sdkVersion, p.questionVersion, p.questionHash, p.inputHash, p.decisions, p.routing])).rows[0];
      if (saved) {
        inserted++;
        const editorial = (await client.query("SELECT * FROM ingest.review_queue WHERE id=$1 FOR SHARE", [unit.review_id])).rows[0];
        const a = annotationSchema.parse(unit.annotation);
        if (editorial?.payload?.knowledgeDecision?.status === "approved" &&
          (p.decisions["support"]!.choice !== "supports" || p.decisions["object_scope"]!.choice !== "same_object" || p.decisions["assertion_state"]!.choice !== a.assertion.state)) {
          // Model output never edits the parent decision or its journal snapshot.
          // Keep one actionable contradiction in the existing review queue.
          await client.query(`INSERT INTO ingest.review_queue(kind,priority,artist_a_id,album_id,track_id,payload,notes)
            VALUES('manual_review',4,$1,$2,$3,$4,$5)`, [editorial.artist_a_id, editorial.album_id, editorial.track_id,
            {type:"search_knowledge_model_conflict",caseKey:`knowledge-model:${saved.id}`,sourceReviewId:Number(unit.review_id),interpretationId:Number(saved.id),
              annotationId:a.id,decisionRevision:editorial.payload.knowledgeDecision.revision,model:p.model,modelRevision:p.modelRevision,questionVersion:p.questionVersion,decisions:p.decisions},
            "Predicción divergente de una decisión editorial. La aprobación humana permanece vigente; contrastar el soporte antes de cambiarla."]);
        }
      }
    }
    await client.query("COMMIT"); return { received: predictions.length, inserted };
  } catch { await client.query("ROLLBACK"); throw new ApiError(409, "knowledge_interpretation_invalid", "La interpretación cambió o no corresponde a la evidencia y versiones; no se modificaron decisiones"); }
  finally { client.release(); }
}

export async function runKnowledgeInterpretation(limit = 10) {
  const client = await getPool().connect(); let locked = false;
  try {
    locked = Boolean((await client.query("SELECT pg_try_advisory_lock(hashtext('crv:knowledge-laya')) AS locked")).rows[0].locked);
    if (!locked) return { status: "busy", processed: 0 };
    const script = path.join(root, "scripts/unified-search-laya.py"), python = getEnv().CRV_LAYA_PYTHON;
    const metadataResult = await execFileAsync(python, [script, "--metadata"], { timeout: 10_000, maxBuffer: 32_000 });
    const tasks = await knowledgeInterpretationTasks(metadataSchema.parse(JSON.parse(metadataResult.stdout)), limit);
    if (!tasks.length) return { status: "idle", processed: 0 };
    // No transaction or row lock while the local model runs. The child has a
    // hard timeout and output cap; the process lock/CPU budget are in Python.
    const result = await new Promise<string>((resolve, reject) => {
      const child = execFile(python, [script], { timeout: 120_000, maxBuffer: 1_000_000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
      child.stdin?.end(JSON.stringify(tasks));
    });
    const imported = await importKnowledgeInterpretations(JSON.parse(result));
    return { status: "proposed", processed: imported.inserted };
  } catch { throw new ApiError(503, "knowledge_laya_unavailable", "Interpretación indisponible; las afirmaciones y decisiones se conservan para reintento"); }
  finally { try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('crv:knowledge-laya'))"); } finally { client.release(); } }
}
