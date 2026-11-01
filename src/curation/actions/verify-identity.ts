// CRV · Acción de Curaduría «verificar identidad con la IA» (etapa 3).
//
// Nivel 0 y solo lectura del catálogo: pide el veredicto a DeepSeek con el
// dosier de las dos fichas y lo guarda en `ingest.curation_ai_verdicts`. La
// caché por par + versión de prompt evita repetir la llamada. No fusiona ni
// descarta; esas acciones leen este veredicto.
import { z } from "zod";
import { createDeepSeekGateway } from "../../ai/gateway.js";
import { getEnv } from "../../config/env.js";
import { OperatorError } from "../../merge/operator.js";
import type { ArtistCandidate } from "../../review/artist-candidates.js";
import {
  buildDossier, classifyArtistPair, loadArtistProfiles,
} from "../../review/artist-merge.js";
import type { ArtistFeature } from "../../review/artist-candidates.js";
import {
  AI_VERDICT_PROMPT_VERSION, latestVerdict, recordVerdict,
} from "../ai-verdicts.js";
import { loadFeedbackForPairs } from "../feedback.js";
import { searchLocalEvidence } from "../../research/local-evidence.js";
import type { ActionFinding, ActionPreview, FixActionDefinition, Precondition } from "./types.js";

const verifyParamsSchema = z.object({
  kind: z.literal("artist"),
  aId: z.number().int().positive(),
  bId: z.number().int().positive(),
}).strict();

export type VerifyIdentityParams = z.infer<typeof verifyParamsSchema>;

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

function featuresOf(finding: ActionFinding): ArtistFeature[] {
  const raw = finding.evidence["features"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return typeof record["key"] === "string" && typeof record["value"] === "number" && typeof record["evidence"] === "string"
      ? [{ key: record["key"], value: record["value"], evidence: record["evidence"] }]
      : [];
  });
}

function candidateOf(finding: ActionFinding, pair: [number, number]): ArtistCandidate {
  const labels = new Map<number, string>([[pair[0], finding.entity.label], [pair[1], finding.related[0]?.label ?? ""]]);
  if (finding.entity.id !== null) labels.set(finding.entity.id, finding.entity.label);
  for (const item of finding.related) if (item.id !== null) labels.set(item.id, item.label);
  const signals = Number(finding.evidence["signals"] ?? 0);
  return {
    a: { id: pair[0], name: labels.get(pair[0]) ?? String(pair[0]) },
    b: { id: pair[1], name: labels.get(pair[1]) ?? String(pair[1]) },
    score: Number(finding.evidence["score"] ?? 0),
    deterministic: finding.evidence["deterministic"] === true,
    signals: Number.isFinite(signals) ? signals : 0,
    features: featuresOf(finding),
    priority: signals > 0 ? 8 : 6,
  };
}

const verdictView = (verdict: Awaited<ReturnType<typeof latestVerdict>>) => verdict === null ? null : ({
  decision: verdict.decision, confidence: verdict.confidence,
  evidenceCount: verdict.evidence.length,
  facts: verdict.evidence.filter((item) => item.supports === "match").map((item) => item.fact_id),
  identityDoubts: verdict.identityDoubts.length,
  model: verdict.model, promptVersion: verdict.promptVersion,
});

export const verifyIdentityAction: FixActionDefinition<VerifyIdentityParams> = {
  key: "verificar_identidad_ia",
  label: "Verificar identidad con IA",
  description: "Pide a la IA del catálogo que interprete el par con el dosier de las dos fichas. Guarda el veredicto y sus hechos citados; no fusiona ni descarta.",
  level: 0,
  paramsSchema: verifyParamsSchema,

  appliesTo(finding) {
    return finding.entity.kind === "artist" && pairOf(finding) !== null;
  },

  acceptsExplicit(finding, params) {
    return finding.entity.kind === "artist" && params.aId !== params.bId;
  },

  levelFor() { return 0; },

  async defaultParams(finding) {
    const pair = pairOf(finding);
    return pair ? { kind: "artist", aId: pair[0], bId: pair[1] } : null;
  },

  async preconditions(_finding, params, ctx) {
    const checks: Precondition[] = [];
    if (params.aId === params.bId) {
      checks.push({ key: "par", ok: false, code: "invalid", message: "no se puede verificar una ficha consigo misma" });
      return checks;
    }
    const { rowCount } = await ctx.client.query("SELECT 1 FROM public.artists WHERE id = ANY($1::bigint[])", [[params.aId, params.bId]]);
    checks.push(rowCount === 2
      ? { key: "fichas", ok: true }
      : { key: "fichas", ok: false, code: "stale", message: "una de las fichas ya no existe" });
    return checks;
  },

  async preview(_finding, params, ctx) {
    const verdict = await latestVerdict(ctx.client, params.kind, params.aId, params.bId, {
      promptVersion: AI_VERDICT_PROMPT_VERSION, model: getEnv().DEEPSEEK_MODEL_FAST,
    });
    return {
      touched: [{ kind: "artist", id: params.aId }, { kind: "artist", id: params.bId }],
      before: {}, after: { ai: verdictView(verdict), cached: verdict !== null },
      blocked: null, collisions: [], warnings: [], proposal: null,
      hashMaterial: `${params.aId}:${params.bId}:${AI_VERDICT_PROMPT_VERSION}`,
    } satisfies ActionPreview;
  },

  async apply(context, finding, params) {
    const cached = await latestVerdict(context.client, params.kind, params.aId, params.bId, {
      promptVersion: AI_VERDICT_PROMPT_VERSION, model: getEnv().DEEPSEEK_MODEL_FAST,
    });
    if (cached) return { after: { ai: verdictView(cached), cached: true, verdictId: cached.id } };
    if (!getEnv().DEEPSEEK_API_KEY) throw new OperatorError("invalid", "falta DEEPSEEK_API_KEY para verificar con IA");
    const profiles = await loadArtistProfiles(context.client, [params.aId, params.bId]);
    const left = profiles.get(params.aId);
    const right = profiles.get(params.bId);
    if (!left || !right) throw new OperatorError("not_found", "no se pudieron cargar las dos fichas");
    const candidate = candidateOf(finding, [params.aId, params.bId]);
    const precedents = (await loadFeedbackForPairs(context.client, [[left.id, right.id]])).get(`${Math.min(left.id, right.id)}:${Math.max(left.id, right.id)}`) ?? [];
    const localEvidence = getEnv().CRV_CURATION_LOCAL_EVIDENCE
      ? await searchLocalEvidence(context.client, [left.name, right.name], 5)
      : [];
    const dossier = buildDossier(left, right, candidate, precedents, localEvidence);
    const { verdict, model } = await classifyArtistPair(createDeepSeekGateway(), candidate, dossier);
    const id = await recordVerdict(context, params.kind, params.aId, params.bId, verdict, model);
    return {
      after: {
        ai: {
          decision: verdict.decision, confidence: verdict.confidence,
          evidenceCount: verdict.evidence.filter((item) => item.supports === "match").length,
          facts: verdict.evidence.filter((item) => item.supports === "match").map((item) => item.fact_id),
          identityDoubts: verdict.identity_doubts.length, model,
          promptVersion: AI_VERDICT_PROMPT_VERSION,
        },
        cached: false, verdictId: id,
      },
    };
  },
};
