import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { annotationSchema } from "./knowledge-contracts.js";
import { mappingReviewFileSchema } from "./genre-mapping-review.js";
import { independentReviewSchema } from "./independent-review.js";
import { hashText } from "./review-protocol.js";
import { OperatorError } from "../merge/operator.js";

type Db = Pool | PoolClient;
const ANNOTATIONS = "reports/unified-search-stage2/development-annotations.json";
// R45 (AOTY) and R46 (fanzines) stratum, added 2026-10-25; evaluated alongside the development readings.
const EXTENSION = "reports/unified-search-stage2/extension-annotations.json";
const MAPPINGS = "docs/unified-search/stage2/mapping-review.json";
const THRESHOLDS = "docs/unified-search/stage2/independent-review-claude.json";

export const blindSchema = z.object({
  object: z.enum(["album", "track", "artist", "unknown"]),
  type: z.enum(["sound", "lyrics", "taste", "comparison", "experience", "context", "fact", "attributed_intent"]),
  state: z.enum(["affirmed", "negated", "hypothetical", "conditional", "quoted", "possible_irony", "corrected", "withdrawn", "uncertain"]),
  appreciation: z.enum(["liked", "disliked", "mixed", "descriptive"]),
  coverage: z.enum(["complete", "partial", "unknown"]),
}).strict();
export const verdictSchema = z.enum(["supported", "appreciation_error", "scope_error", "unsupported_generalization", "other_error"]);
export const mappingDecisionSchema = z.object({
  decision: z.enum(["approved", "corrected", "rejected"]),
  targetSlug: z.string().trim().min(1).nullable().default(null),
  relation: z.enum(["equivalence", "specialization", "partial", "pending"]).nullable().default(null),
  note: z.string().trim().max(1000).default(""),
}).strict().refine(d => d.decision !== "corrected" || d.relation !== null, "Una corrección indica la relación")
  .refine(d => d.decision !== "corrected" || d.relation === "pending" || d.targetSlug !== null, "Una corrección resuelta indica el género CRV");

async function loadAnnotations(root: string) {
  const raw = JSON.parse(await readFile(path.join(root, ANNOTATIONS), "utf8")) as { version: string; annotations: unknown[] };
  const extension = JSON.parse(await readFile(path.join(root, EXTENSION), "utf8")) as { version: string; annotations: unknown[] };
  return { version: raw.version, extensionVersion: extension.version, annotations: [...raw.annotations, ...extension.annotations].map(a => annotationSchema.parse(a)) };
}

/** The blind view never carries the analyst's reading: object kind and work
 * name are needed to read the quote, aspect/state/appreciation are not. */
function blindItem(a: z.infer<typeof annotationSchema>) {
  return { id: a.id, study: a.study, work: a.object.name, workKind: a.object.kind, quote: a.observation.quote,
    language: a.observation.language, source: a.observation.source };
}
function revealed(a: z.infer<typeof annotationSchema>) {
  return { object: a.object.kind, type: a.assertion.type, aspect: a.assertion.aspect, value: a.assertion.value, state: a.assertion.state,
    appreciation: a.assertion.appreciation, coverage: a.assertion.coverage, listeningCondition: a.assertion.listeningCondition,
    interpretation: a.analysis.interpretation, alternative: a.analysis.alternative, analyst: a.analysis.analyst,
    dependencies: a.dependencies.map(d => d.relation) };
}

interface EvaluationRow { annotation_id: string; study_version: string; quote_sha256: string; blind: z.infer<typeof blindSchema>; verdict: z.infer<typeof verdictSchema> | null; note: string; blind_at: Date; verdict_at: Date | null }

export async function humanEvaluationState(root: string, db: Db, evaluator: string) {
  const [{ annotations, version, extensionVersion }, thresholdsFile] = await Promise.all([loadAnnotations(root), readFile(path.join(root, THRESHOLDS), "utf8")]);
  const thresholds = independentReviewSchema.parse(JSON.parse(thresholdsFile)).thresholds;
  const rows = (await db.query<EvaluationRow>("SELECT * FROM ingest.search_human_evaluations WHERE evaluator=$1", [evaluator])).rows;
  const byId = new Map(rows.map(r => [r.annotation_id, r]));
  const items = annotations.map(a => {
    const row = byId.get(a.id);
    // A changed quote or study version invalidates an earlier pass instead of carrying it over.
    const current = row && row.quote_sha256 === hashText(a.observation.quote) && row.study_version === a.study ? row : undefined;
    return { ...blindItem(a), blind: current?.blind ?? null, verdict: current?.verdict ?? null, note: current?.note ?? "",
      stale: Boolean(row && !current), annotation: current ? revealed(a) : null };
  });
  const judged = items.filter(i => i.verdict);
  const count = (v: string) => judged.filter(i => i.verdict === v).length;
  const metrics = { total: items.length, blind: items.filter(i => i.blind).length, judged: judged.length,
    scopeErrors: count("scope_error"), unsupportedGeneralizations: count("unsupported_generalization"),
    supportPrecision: judged.length ? Number((count("supported") / judged.length).toFixed(3)) : null };
  const meets = judged.length === items.length && metrics.scopeErrors <= thresholds.scopeErrorsAllowed
    && metrics.unsupportedGeneralizations <= thresholds.unsupportedGeneralizationsAllowed && (metrics.supportPrecision ?? 0) >= thresholds.supportPrecision;
  return { studyVersion: version, extensionVersion, evaluator, items, metrics,
    thresholds: { status: thresholds.status, scopeErrorsAllowed: thresholds.scopeErrorsAllowed, unsupportedGeneralizationsAllowed: thresholds.unsupportedGeneralizationsAllowed, supportPrecision: thresholds.supportPrecision },
    complete: judged.length === items.length, meetsThresholds: meets };
}

async function annotationFor(root: string, id: string) {
  const a = (await loadAnnotations(root)).annotations.find(x => x.id === id);
  if (!a) throw new OperatorError("not_found", "La anotación no existe en el estudio vigente");
  return a;
}

export async function saveBlindReading(root: string, db: Db, evaluator: string, id: string, blind: unknown) {
  const a = await annotationFor(root, id), parsed = blindSchema.parse(blind);
  // Rewriting the blind pass after seeing the annotation would erase independence.
  const existing = (await db.query<{ verdict: string | null; quote_sha256: string; study_version: string }>(
    "SELECT verdict,quote_sha256,study_version FROM ingest.search_human_evaluations WHERE annotation_id=$1 AND evaluator=$2", [id, evaluator])).rows[0];
  if (existing && existing.quote_sha256 === hashText(a.observation.quote) && existing.study_version === a.study)
    throw new OperatorError("already_exists", "La lectura ciega ya está registrada; no se reescribe tras ver la anotación");
  await db.query(`INSERT INTO ingest.search_human_evaluations(annotation_id,evaluator,study_version,quote_sha256,blind)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT(annotation_id,evaluator) DO UPDATE SET study_version=EXCLUDED.study_version,
    quote_sha256=EXCLUDED.quote_sha256, blind=EXCLUDED.blind, blind_at=now(), verdict=NULL, verdict_at=NULL, note=''`,
  [id, evaluator, a.study, hashText(a.observation.quote), JSON.stringify(parsed)]);
  return revealed(a);
}

export async function saveVerdict(root: string, db: Db, evaluator: string, id: string, verdict: unknown, note: string) {
  const a = await annotationFor(root, id), parsed = verdictSchema.parse(verdict);
  const result = await db.query(`UPDATE ingest.search_human_evaluations SET verdict=$3, note=$4, verdict_at=now()
    WHERE annotation_id=$1 AND evaluator=$2 AND quote_sha256=$5 AND study_version=$6`, [id, evaluator, parsed, note, hashText(a.observation.quote), a.study]);
  if (!result.rowCount) throw new OperatorError("needs_review", "Primero se registra la lectura ciega");
}

interface AdjudicationRow { original_term: string; review_version: string; decision: string; target_slug: string | null; relation: string | null; note: string; decided_by: string; decided_at: Date }

export async function mappingAdjudicationState(root: string, db: Db) {
  const review = mappingReviewFileSchema.parse(JSON.parse(await readFile(path.join(root, MAPPINGS), "utf8")));
  const rows = (await db.query<AdjudicationRow>("SELECT * FROM ingest.search_mapping_adjudications")).rows;
  const genres = (await db.query<{ slug: string; name: string }>("SELECT slug,name FROM ingest.genres WHERE active ORDER BY name")).rows;
  const byTerm = new Map(rows.map(r => [r.original_term, r]));
  const terms = review.terms.map(t => {
    const row = byTerm.get(t.originalTerm);
    return { originalTerm: t.originalTerm, proposal: { targetSlug: t.targetSlug, relation: t.relation, sourceConceptKind: t.sourceConceptKind, rationale: t.rationale, analyst: review.analyst },
      decision: row ? { decision: row.decision, targetSlug: row.target_slug, relation: row.relation, note: row.note, decidedBy: row.decided_by, decidedAt: row.decided_at.toISOString(), reviewVersion: row.review_version } : null };
  });
  return { reviewVersion: review.version, terms, genres, decided: terms.filter(t => t.decision).length, total: terms.length };
}

export async function adjudicateMapping(root: string, db: Db, operator: string, term: string, input: unknown) {
  const review = mappingReviewFileSchema.parse(JSON.parse(await readFile(path.join(root, MAPPINGS), "utf8")));
  const proposal = review.terms.find(t => t.originalTerm === term);
  if (!proposal) throw new OperatorError("not_found", "El término no está en la revisión de correspondencias");
  const d = mappingDecisionSchema.parse(input);
  if (d.decision === "approved" && proposal.relation === "pending")
    throw new OperatorError("invalid", "Una propuesta pendiente no se aprueba: se corrige o se rechaza");
  const target = d.decision === "corrected" ? d.targetSlug : null;
  if (target && !(await db.query("SELECT 1 FROM ingest.genres WHERE slug=$1 AND active", [target])).rowCount)
    throw new OperatorError("invalid", "El género CRV indicado no existe o no está activo");
  await db.query(`INSERT INTO ingest.search_mapping_adjudications(original_term,review_version,proposed_slug,proposed_relation,decision,target_slug,relation,note,decided_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(original_term) DO UPDATE SET review_version=EXCLUDED.review_version,
    proposed_slug=EXCLUDED.proposed_slug, proposed_relation=EXCLUDED.proposed_relation, decision=EXCLUDED.decision,
    target_slug=EXCLUDED.target_slug, relation=EXCLUDED.relation, note=EXCLUDED.note, decided_by=EXCLUDED.decided_by, decided_at=now()`,
  [term, review.version, proposal.targetSlug, proposal.relation, d.decision, target, d.decision === "corrected" ? d.relation : null, d.note, operator]);
}
