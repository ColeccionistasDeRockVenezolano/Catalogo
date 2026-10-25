import { z } from "zod";

export const INTENTION_VERSION = "crv-search-intention-v1";
export const OBSERVABILITY_VERSION = "crv-search-observability-v1";
export const dimensions = ["genre", "activity", "emotion", "energy", "atmosphere", "theme"] as const;
export const entityReference = z.object({
  role: z.enum(["target", "reference"]), kind: z.enum(["artist", "person", "album", "track", "organization", "recording", "edition"]),
  id: z.number().int().positive().nullable(), name: z.string().max(1000),
  resolution: z.enum(["resolved", "ambiguous", "absent", "external", "not_applicable"]),
}).strict();
const condition = z.object({
  id: z.string(), axis: z.enum(dimensions).nullable(), facet: z.string().nullable(),
  value: z.string(), sourceText: z.string(), scope: z.enum(["listener", "artist", "album", "track", "recording", "edition"]),
  mode: z.enum(["required", "excluded", "preferred"]), alternativeGroup: z.string().nullable(),
  status: z.enum(["recognized", "unknown", "ambiguous"]),
}).strict().refine(c => (c.axis === null) !== (c.facet === null), "Precisar un eje o una faceta");
/** Conditions outside an alternativeGroup are AND; members of the same group are OR.
 * Unknown clauses stay in the plan and block claims of complete interpretation. */
export const intentionSchema = z.object({
  version: z.literal(INTENTION_VERSION), capabilities: z.array(z.enum(["direct", "emotional", "contextual"])),
  interpretation: z.enum(["identified", "partial", "ambiguous", "unrecognized", "out_of_scope", "unavailable"]),
  entities: z.array(entityReference), conditions: z.array(condition),
  pending: z.array(z.object({ text: z.string(), reason: z.string() }).strict()),
  engine: z.enum(["legacy", "laya"]),
}).strict().superRefine((plan, ctx) => {
  if (plan.interpretation === "identified" && (plan.pending.length || plan.conditions.some(c => c.status !== "recognized"))) {
    ctx.addIssue({ code: "custom", message: "Una interpretación completa no puede ocultar fragmentos pendientes" });
  }
});
export type SearchIntention = z.infer<typeof intentionSchema>;

/** Three independent layers; analysis/proposals cannot masquerade as source testimony. */
export const evidenceSchema = z.object({
  version: z.literal("crv-search-evidence-v1"), id: z.string(), entity: entityReference,
  observation: z.object({ resourceId: z.string().regex(/^R(?:0[1-9]|[1-3][0-9]|4[0-4])$/), source: z.string().url(), locator: z.string(), quote: z.string(), capturedAt: z.string().datetime() }).strict(),
  analysis: z.object({ text: z.string(), method: z.string(), version: z.string() }).strict(),
  proposal: z.object({ axis: z.enum(dimensions), value: z.string(), status: z.enum(["proposed", "approved", "rejected", "withdrawn"]) }).strict(),
  decision: z.object({ actor: z.string().trim().min(1), revision: z.number().int().positive(), reason: z.string().trim().min(1), decidedAt: z.string().datetime() }).strict().nullable(),
}).strict();
export function isPublishableEvidence(value: unknown): boolean {
  const parsed = evidenceSchema.safeParse(value);
  return parsed.success && parsed.data.proposal.status === "approved" && parsed.data.decision !== null
    && parsed.data.entity.resolution === "resolved" && parsed.data.entity.id !== null
    && parsed.data.observation.resourceId !== "R16"
    && !/shoutbox|shouts/iu.test(parsed.data.observation.source)
    && Boolean(parsed.data.observation.quote.trim() && parsed.data.observation.locator.trim());
}

export interface EditorialDecision { revision: number; status: "approved" | "rejected" | "withdrawn"; actor: string }
/** Models/sources/aliases/index rebuilds submit proposals; only an attributed human revision changes a decision. */
export function authorizeEditorialRevision(current: EditorialDecision, update: {
  origin: "human" | "model" | "source" | "alias" | "index"; expectedRevision: number; actor?: string; reason?: string;
}): "apply" | "review" {
  return update.origin === "human" && update.expectedRevision === current.revision && Boolean(update.actor?.trim() && update.reason?.trim()) ? "apply" : "review";
}
