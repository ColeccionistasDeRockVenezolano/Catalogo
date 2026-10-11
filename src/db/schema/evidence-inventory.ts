import { bigint, integer, jsonb, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { ingestSchema } from "./ingest-enums.js";
import { albums, artists, organizations, persons, tracks } from "./core.js";
import type { DateValue } from "../../catalog/date-value.js";
import type { FactScope } from "../../evidence/inventory.js";

export const evidenceDocuments = ingestSchema.table("evidence_documents", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  documentKey: text("document_key").notNull().unique(), url: text("url").notNull(), title: text("title").notNull(),
  contentText: text("content_text").notNull(), contentHash: text("content_hash").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }), acquisitionMethod: text("acquisition_method").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});
export const evidenceReads = ingestSchema.table("evidence_reads", {
  documentId: bigint("document_id", { mode: "number" }).notNull().references(() => evidenceDocuments.id),
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
}, table => [primaryKey({ columns: [table.documentId, table.readAt] })]);
export const evidenceFragments = ingestSchema.table("evidence_fragments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  documentId: bigint("document_id", { mode: "number" }).notNull().references(() => evidenceDocuments.id),
  offsetUnit: text("offset_unit").notNull().default("utf8_byte"),
  quote: text("quote").notNull(), startOffset: integer("start_offset").notNull(), endOffset: integer("end_offset").notNull(), selector: text("selector"),
});
export const catalogFacts = ingestSchema.table("catalog_facts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(), factKey: text("fact_key").notNull().unique(),
  subjectKind: text("subject_kind").notNull(), originalSubjectId: bigint("original_subject_id", { mode: "number" }).notNull(),
  field: text("field"), relation: text("relation"), value: jsonb("value").notNull(), valueType: text("value_type").notNull(),
  scope: jsonb("scope").$type<FactScope>().notNull().default({}), period: jsonb("period").$type<DateValue>(),
  documentaryState: text("documentary_state").notNull(), createdBy: text("created_by").notNull(), operator: text("operator").notNull(), reason: text("reason").notNull(),
  claimId: bigint("claim_id", { mode: "number" }), runId: bigint("run_id", { mode: "number" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});
export const catalogFactEvidence = ingestSchema.table("catalog_fact_evidence", {
  factId: bigint("fact_id", { mode: "number" }).notNull().references(() => catalogFacts.id),
  fragmentId: bigint("fragment_id", { mode: "number" }).notNull().references(() => evidenceFragments.id), role: text("role").notNull(),
}, table => [primaryKey({ columns: [table.factId, table.fragmentId, table.role] })]);
export const catalogFactBindings = ingestSchema.table("catalog_fact_bindings", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(), factId: bigint("fact_id", { mode: "number" }).notNull().unique().references(() => catalogFacts.id),
  artistId: bigint("artist_id", { mode: "number" }).references(() => artists.id, { onDelete: "cascade" }),
  personId: bigint("person_id", { mode: "number" }).references(() => persons.id, { onDelete: "cascade" }),
  organizationId: bigint("organization_id", { mode: "number" }).references(() => organizations.id, { onDelete: "cascade" }),
  albumId: bigint("album_id", { mode: "number" }).references(() => albums.id, { onDelete: "cascade" }),
  trackId: bigint("track_id", { mode: "number" }).references(() => tracks.id, { onDelete: "cascade" }),
  disposition: text("disposition").notNull().default("pending"), decidedBy: text("decided_by"), decisionReason: text("decision_reason"),
});
