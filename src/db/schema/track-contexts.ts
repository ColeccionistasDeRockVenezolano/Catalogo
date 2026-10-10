import { bigint, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { ingestSchema } from "./ingest-enums.js";
import { tracks } from "./core.js";
import { claimEvidence } from "./ingest.js";
const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
export const trackContextLabels = ingestSchema.table("track_context_labels", {
  id: id(), slug: text("slug").notNull().unique(), kind: text("kind").notNull(), name: text("name").notNull(),
  definition: text("definition").notNull(), criterion: text("criterion").notNull(), ontologyVersion: text("ontology_version").notNull(),
});
const annotation = () => ({
  id: id(), importKey: text("import_key").notNull().unique(),
  trackId: bigint("track_id", { mode: "number" }).notNull().references(() => tracks.id, { onDelete: "cascade" }),
  labelId: bigint("label_id", { mode: "number" }).notNull().references(() => trackContextLabels.id, { onDelete: "restrict" }),
  evidenceId: bigint("evidence_id", { mode: "number" }).references(() => claimEvidence.id, { onDelete: "restrict" }),
  confidence: text("confidence").notNull(), methodVersion: text("method_version").notNull(),
  methodData: jsonb("method_data").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const trackContextProposals = ingestSchema.table("track_context_proposals", {
  ...annotation(), origin: text("origin").notNull(), proposer: text("proposer").notNull(),
  modelName: text("model_name"), modelVersion: text("model_version"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(), rationale: text("rationale").notNull(),
});
export const trackContextAssignments = ingestSchema.table("track_context_assignments", {
  ...annotation(), proposalId: bigint("proposal_id", { mode: "number" }).references(() => trackContextProposals.id, { onDelete: "restrict" }),
  state: text("state").notNull(), reviewer: text("reviewer").notNull(), reason: text("reason").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(), validUntil: timestamp("valid_until", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});
export const trackContextEvaluations = ingestSchema.table("track_context_evaluations", {
  id: id(), importKey: text("import_key").notNull().unique(),
  assignmentId: bigint("assignment_id", { mode: "number" }).notNull().references(() => trackContextAssignments.id, { onDelete: "restrict" }),
  assignmentSnapshot: jsonb("assignment_snapshot").notNull(), verdict: text("verdict").notNull(),
  reviewer: text("reviewer").notNull(), reason: text("reason").notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
});
