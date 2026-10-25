import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashText } from "./review-protocol.js";

const text = z.string().trim().min(1), sha = z.string().regex(/^[a-f0-9]{64}$/);
const ratio = z.number().min(0).max(1);
const fields = ["type", "state", "appreciation", "coverage"] as const;
const verdict = z.enum(["agree", "codex", "both_defensible", "rectification_proposed"]);

export const independentReviewSchema = z.object({
  version: z.string().regex(/^crv-independent-review-claude-\d+\.\d+\.\d+$/),
  reviewer: z.object({ name: text, kind: z.literal("ai_model_distinct_from_first_analyst"), firstAnalyst: text, independence: text }).strict(),
  method: z.array(text).min(1),
  input: z.object({ path: text, cut: text, sha256: sha, annotations: z.number().int().positive() }).strict(),
  metrics: z.object({
    blindAgreement: z.object({ type: ratio, state: ratio, appreciation: ratio, coverage: ratio, object: ratio }).strict(),
    scopeErrors: z.number().int().min(0), unsupportedGeneralizations: z.number().int().min(0), rectificationsProposed: z.number().int().min(0),
    supportPrecision: ratio, supportPrecisionBasis: text, reviewerBlindErrors: z.array(text),
  }).strict(),
  thresholds: z.object({ status: z.enum(["proposed_before_holdout_not_approved", "approved_by_brian"]), approvedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), scopeErrorsAllowed: z.number(), unsupportedGeneralizationsAllowed: z.number(), supportPrecision: ratio, outcome: text }).strict()
    .refine(t => (t.status === "approved_by_brian") === Boolean(t.approvedAt), "La aprobación requiere fecha y solo la da Brian"),
  rectifications: z.array(z.object({ id: text, field: text, from: z.string().nullable(), to: text }).strict()),
  rectificationStatus: z.enum(["proposed_not_applied", "applied_after_brian_approval"]), rectificationsAppliedIn: text.optional(),
  items: z.array(z.object({
    id: text, quoteSha256: sha,
    blind: z.object({ object: text, type: text, aspect: text, state: text, appreciation: text, coverage: text, note: text }).strict(),
    adjudication: z.object({ verdict, reason: text }).strict(),
  }).strict()),
  limits: z.array(text).min(1),
}).strict();

type Annotation = { id: string; object: { kind: string }; observation: { quote: string }; assertion: Record<(typeof fields)[number], string> };

/** A second analyst's blind reading, pinned to the exact annotation bytes it
 * reviewed. Agreement is recomputed, never trusted from the file; the review
 * is an AI check and never an editorial approval. */
export async function readIndependentReview(root: string, file = "docs/unified-search/stage2/independent-review-claude.json") {
  const review = independentReviewSchema.parse(JSON.parse(await readFile(path.join(root, file), "utf8")));
  const bytes = await readFile(path.join(root, review.input.path));
  if (hashText(bytes) !== review.input.sha256) throw new Error("Revisión independiente obsoleta: cambiaron las anotaciones");
  const annotations = (JSON.parse(bytes.toString("utf8")) as { annotations: Annotation[] }).annotations;
  const byId = new Map(review.items.map(item => [item.id, item]));
  if (byId.size !== review.items.length || annotations.length !== review.items.length || annotations.length !== review.input.annotations
    || annotations.some(a => !byId.has(a.id))) throw new Error("La revisión debe cubrir cada anotación una sola vez");
  const agreement: Record<string, number> = { object: 0, ...Object.fromEntries(fields.map(f => [f, 0])) };
  for (const a of annotations) {
    const item = byId.get(a.id)!;
    if (hashText(a.observation.quote) !== item.quoteSha256) throw new Error(`Cita distinta de la revisada: ${a.id}`);
    for (const f of fields) agreement[f]! += Number(a.assertion[f] === item.blind[f]);
    agreement["object"]! += Number(a.object.kind === item.blind.object);
  }
  for (const [key, count] of Object.entries(agreement))
    if (Math.abs(count / annotations.length - review.metrics.blindAgreement[key as keyof typeof review.metrics.blindAgreement]) > 0.0005)
      throw new Error(`Acuerdo declarado no coincide: ${key}`);
  const proposed = review.items.filter(item => item.adjudication.verdict === "rectification_proposed").map(item => item.id);
  if (proposed.length !== review.metrics.rectificationsProposed || review.rectifications.some(r => !proposed.includes(r.id))
    || proposed.some(id => !review.rectifications.some(r => r.id === id))) throw new Error("Rectificaciones sin adjudicación correspondiente");
  const t = review.thresholds, m = review.metrics;
  const meetsProposedThresholds = m.scopeErrors <= t.scopeErrorsAllowed && m.unsupportedGeneralizations <= t.unsupportedGeneralizationsAllowed && m.supportPrecision >= t.supportPrecision;
  return { review, meetsProposedThresholds, humanEvaluation: false as const, thresholdsApproved: t.status === "approved_by_brian" };
}
