import { z } from "zod";
import { dimensions } from "./contracts.js";

export const KNOWLEDGE_VERSION = "crv-musical-knowledge-v1";
const text = z.string().trim().min(1).max(8000);
export const resourceId = z.string().regex(/^R(?:0[1-9]|[1-3][0-9]|4[0-6])$/).refine(id => id !== "R16", "Shoutbox retirado");
const objectSchema = z.object({
  kind: z.enum(["artist", "album", "track", "recording", "edition", "audiovisual", "genre"]),
  id: z.number().int().positive().nullable(), name: text,
  resolution: z.enum(["resolved", "external", "ambiguous", "pending"]),
  identityEvidence: z.array(text), version: text.nullable(), segment: text.nullable(),
}).strict().superRefine((o, ctx) => {
  if (o.resolution === "resolved" && (!o.id || !o.identityEvidence.length)) ctx.addIssue({ code: "custom", message: "Identidad resuelta requiere ID y vínculo documentado" });
  if (o.resolution === "external" && (o.id !== null || !o.identityEvidence.length)) ctx.addIssue({ code: "custom", message: "Referencia externa documentada sin alta ficticia" });
});
const rating = z.object({ value: z.number(), minimum: z.number(), maximum: z.number(), object: text }).strict()
  .refine(r => r.minimum < r.maximum && r.value >= r.minimum && r.value <= r.maximum, "Escala inválida");
export const annotationSchema = z.object({
  version: z.literal(KNOWLEDGE_VERSION), study: text, id: text, object: objectSchema,
  observation: z.object({
    resourceId, source: z.string().url().refine(s => !/shouts?|shoutbox/iu.test(s)),
    reviewId: text.nullable(), account: text.nullable(), page: z.number().int().positive().nullable(),
    captureHash: z.string().regex(/^[a-f0-9]{64}$/), capturedAt: z.string().datetime().nullable(),
    capturedAtOriginal: text.nullable().default(null), captureTimeZone: text.nullable().default(null),
    locator: text, quote: text.max(1500), language: text, visibleDate: text.nullable(),
    textRevision: text.nullable(), extractorVersion: text, paraphrase: text.nullable(),
  }).strict().refine(o => o.capturedAt !== null || o.capturedAtOriginal !== null, "Conservar fecha de captura original si su huso no está documentado"),
  assertion: z.object({
    type: z.enum(["sound", "lyrics", "taste", "comparison", "experience", "context", "fact", "attributed_intent"]),
    aspect: text, value: text,
    state: z.enum(["affirmed", "negated", "hypothetical", "conditional", "quoted", "possible_irony", "corrected", "withdrawn", "uncertain"]),
    appreciation: z.enum(["liked", "disliked", "mixed", "descriptive"]),
    listeningCondition: text.nullable(), coverage: z.enum(["complete", "partial", "unknown"]),
    activityBasis: z.enum(["declared_use", "explicit_recommendation", "imagined_scene", "represented_activity", "irony", "style_inference"]).nullable(),
  }).strict(),
  layers: z.object({
    community: z.array(z.object({ term: text, source: z.string().url(), level: z.enum(["primary", "secondary", "descriptor", "tag"]), measure: text.nullable(), capturedAt: z.string().datetime().nullable(),
      capturedAtOriginal:text.nullable().optional(),captureTimeZone:text.nullable().optional(),
      resourceId:resourceId.optional(),captureHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),locator:text.optional(),
      object:z.object({kind:z.enum(["artist","album","track"]),id:z.number().int().positive()}).strict().optional(),
    }).strict().refine(c=>c.capturedAt!==null||!!c.capturedAtOriginal,"Conservar fecha original de la capa comunitaria")),
    genreKnowledge: z.array(z.object({ reference: text, relation: z.enum(["supports", "refines", "disagrees", "unresolved"]) }).strict()),
    individualRating: rating.nullable(), trackRatings: z.array(rating),
    communityRating: z.object({ rating, votes: z.number().int().nonnegative().nullable(), capturedAt: z.string().datetime().nullable(),
      capturedAtOriginal:text.nullable().optional(),captureTimeZone:text.nullable().optional(),source:z.string().url().optional(),
      captureHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),locator:text.optional(),
    }).strict().refine(c=>c.capturedAt!==null||!!c.capturedAtOriginal,"Conservar fecha original de la nota comunitaria").nullable(),
  }).strict(),
  dependencies: z.array(z.object({ reference: text, relation: z.enum(["supports", "refines", "contradicts", "quotes", "duplicate", "revision", "joint_review", "third_party", "unverified"]) }).strict()),
  evidenceChain: text,
  analysis: z.object({ interpretation: text, alternative: text, uncertainty: text, analyst: text, methodVersion: text }).strict(),
  proposal: z.object({ axis: z.enum(dimensions).nullable(), facet: text.nullable(), value: text, query: text, criterion: text, status: z.literal("proposed") }).strict()
    .refine(p => (p.axis === null) !== (p.facet === null), "Precisar eje o faceta").nullable(),
  comparison: z.object({ reference: objectSchema, aspect: z.enum(["voice", "guitars", "production", "composition", "atmosphere", "other"]), direction: z.enum(["resembles", "differs", "more", "less"]), polarity: z.enum(["affirmed", "negated"]), period: text.nullable() }).strict().nullable(),
}).strict();
export type KnowledgeAnnotation = z.infer<typeof annotationSchema>;

/** Analytical sufficiency never authorizes catalog writes. Silence is not negation;
 * ratings and genre definitions never count as independent reviewers. */
export function analyzePattern(input: KnowledgeAnnotation[]) {
  const rows = input.map(a => annotationSchema.parse(a));
  const objects = new Set(rows.map(a => JSON.stringify([a.object.kind, a.object.id, a.object.name, a.object.version, a.object.segment, a.assertion.aspect, a.assertion.value, a.assertion.listeningCondition])));
  if (objects.size > 1) throw new Error("Comparar el mismo objeto, versión, segmento, aspecto y condición");
  const valid = rows.filter(a => ["resolved", "external"].includes(a.object.resolution)
    && !["hypothetical", "quoted", "possible_irony", "corrected", "withdrawn", "uncertain"].includes(a.assertion.state));
  const accounts = new Set(valid.map(a => a.observation.account).filter(Boolean));
  const chains = new Set(valid.map(a => a.evidenceChain));
  const witnesses = valid.filter(a => a.assertion.state === "affirmed");
  const counterwitnesses = valid.filter(a => a.assertion.state === "negated");
  const states: string[] = [];
  if (!valid.length || rows.some(a => !["resolved", "external"].includes(a.object.resolution))) states.push("not_evaluable");
  if (witnesses.length) states.push("isolated_indication");
  const dependentRelations = new Set(["quotes", "duplicate", "revision", "joint_review", "third_party", "unverified"]);
  const eligible = witnesses.filter(a => !a.dependencies.some(d => dependentRelations.has(d.relation)));
  const supportingAccounts = new Set(eligible.map(a => a.observation.account).filter(Boolean));
  if (supportingAccounts.size >= 3 && new Set(eligible.map(a => a.evidenceChain)).size >= 3) states.push("provisional_recurrence");
  if ((witnesses.length && counterwitnesses.length) || new Set(valid.filter(a => ["liked", "disliked"].includes(a.assertion.appreciation)).map(a => a.assertion.appreciation)).size > 1) states.push("relevant_disagreement");
  if (counterwitnesses.some(a => a.assertion.coverage === "complete")) states.push("scoped_explicit_absence");
  if (valid.some(a => a.assertion.type === "attributed_intent")) states.push("attributed_interpretation");
  return { states, examinedReviews: new Set(rows.map(a => a.observation.reviewId).filter(Boolean)).size,
    distinctAccounts: accounts.size, evidenceChains: chains.size, independence: "undetermined" as const,
    recurrenceEligibleAccounts: supportingAccounts.size, recurrenceEligibleWitnesses: eligible.map(a => a.id),
    dependentWitnesses: witnesses.filter(a => !eligible.includes(a)).map(a => a.id),
    witnesses: witnesses.map(a => a.id), counterwitnesses: counterwitnesses.map(a => a.id),
    publicationAuthorized: false as const };
}

export function assignmentBlockers(a: KnowledgeAnnotation): string[] {
  const reasons: string[] = [];
  if (a.comparison && !["resolved","external"].includes(a.comparison.reference.resolution)) reasons.push("comparison_reference_unresolved");
  if (!a.proposal) reasons.push("evaluation_only_no_attribute");
  if (a.object.resolution !== "resolved") reasons.push("identity_unresolved");
  if (!["affirmed", "negated"].includes(a.assertion.state)) reasons.push("assertion_requires_review");
  if (a.proposal?.axis === "activity" && !["declared_use", "explicit_recommendation"].includes(a.assertion.activityBasis ?? "")) reasons.push("activity_without_specific_evidence");
  if (a.assertion.state === "negated" && a.assertion.coverage !== "complete") reasons.push("absence_without_scope_coverage");
  if (a.proposal?.axis === "energy" && a.analysis.methodVersion !== "perceived-energy-v1") reasons.push("energy_method_required");
  reasons.push("editorial_decision_required");
  return reasons;
}
