// CRV · Descartes automáticos de la IA (etapa 6).
//
// Nivel 0, pero con candados duros: solo actúa si existe un veredicto `distinct`
// con confianza ≥0,95, sin dudas, y el par no tiene una revisión abierta. El
// interruptor maestro `CRV_CURATION_AUTOFIX` sigue apagado por defecto y hace
// falta una regla explícita del administrador para que corra.
import { getEnv } from "../../config/env.js";
import { AI_VERDICT_PROMPT_VERSION, latestVerdict } from "../ai-verdicts.js";
import { declareDistinct, distinctParamsSchema, type DistinctParams } from "./distinct.js";
import type { ActionFinding, ActionPreview, FixActionDefinition, Precondition } from "./types.js";

const autoParamsSchema = distinctParamsSchema;

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

export const autoDistinctAction: FixActionDefinition<DistinctParams> = {
  key: "descartar_duplicado_ia",
  label: "Descartar por IA",
  description: "Solo si la IA dijo distinct con confianza ≥0,95 y sin dudas. Nivel 0: lo usa la autocorrección con una regla explícita; el par no debe tener revisión abierta.",
  level: 0,
  inverse: "distinct_delete",
  paramsSchema: autoParamsSchema,

  appliesTo(finding) {
    return finding.detector === "artistas_duplicados_evidencia" && pairOf(finding) !== null;
  },

  levelFor() { return 0; },

  async defaultParams(finding) {
    const pair = pairOf(finding);
    return pair ? { kind: "artist", aId: pair[0], bId: pair[1] } : null;
  },

  async preconditions(finding, params, ctx) {
    const checks: Precondition[] = [];
    const pair = pairOf(finding);
    checks.push(pair !== null && pair[0] === Math.min(params.aId, params.bId) && pair[1] === Math.max(params.aId, params.bId)
      ? { key: "par", ok: true }
      : { key: "par", ok: false, code: "invalid", message: "las fichas no son las del hallazgo" });
    const verdict = await latestVerdict(ctx.client, "artist", params.aId, params.bId, {
      promptVersion: AI_VERDICT_PROMPT_VERSION, model: getEnv().DEEPSEEK_MODEL_FAST,
    });
    const safe = verdict !== null && verdict.decision === "distinct" && verdict.confidence >= 0.95 && verdict.identityDoubts.length === 0;
    checks.push(safe
      ? { key: "ia_segura", ok: true }
      : { key: "ia_segura", ok: false, code: "not_applicable", message: "la IA no declaró distinct con confianza ≥0,95 y sin dudas" });
    const open = await ctx.client.query(
      "SELECT 1 FROM ingest.review_queue WHERE kind='possible_duplicate' AND status IN ('open','in_progress') AND LEAST(artist_a_id,artist_b_id)=$1 AND GREATEST(artist_a_id,artist_b_id)=$2 LIMIT 1",
      [Math.min(params.aId, params.bId), Math.max(params.aId, params.bId)]);
    checks.push(open.rowCount
      ? { key: "sin_revision", ok: false, code: "not_applicable", message: "el par tiene una revisión abierta: decídelo a mano" }
      : { key: "sin_revision", ok: true });
    return checks;
  },

  async preview(finding, params, ctx) {
    const a = Math.min(params.aId, params.bId);
    const b = Math.max(params.aId, params.bId);
    const verdict = await latestVerdict(ctx.client, "artist", a, b, {
      promptVersion: AI_VERDICT_PROMPT_VERSION, model: getEnv().DEEPSEEK_MODEL_FAST,
    });
    return {
      touched: [{ kind: "artist", id: a }, { kind: "artist", id: b }],
      before: { distinct: false }, after: { distinct: true, ai: verdict ? { decision: verdict.decision, confidence: verdict.confidence } : null },
      blocked: null, collisions: [], warnings: ["Lo aplica la autocorrección con una regla explícita; no lo pulsa una persona."],
      proposal: null, hashMaterial: `auto-distinct:${a}:${b}:${verdict?.id ?? 0}`,
    } satisfies ActionPreview;
  },

  async apply(context, finding, params) {
    const a = Math.min(params.aId, params.bId);
    const b = Math.max(params.aId, params.bId);
    const verdict = await latestVerdict(context.client, "artist", a, b, {
      promptVersion: AI_VERDICT_PROMPT_VERSION, model: getEnv().DEEPSEEK_MODEL_FAST,
    });
    if (verdict?.decision !== "distinct" || verdict.confidence < 0.95 || verdict.identityDoubts.length) {
      throw new Error("el veredicto ya no permite un descarte automático");
    }
    return declareDistinct(context, finding, params, `IA (distinct, ${verdict.confidence.toFixed(2)}): ${verdict.reasoning}`.slice(0, 500), "auto");
  },
};
