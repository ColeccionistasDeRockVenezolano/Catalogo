import { bigint, text, timestamp, uuid, date, integer, jsonb, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import { ingestSchema } from "./ingest-enums.js";
import { artists } from "./core.js";
export const discoveryMetricSubjects = ingestSchema.table("discovery_metric_subjects", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  artistId: bigint("artist_id", { mode: "number" }).references(() => artists.id, { onDelete: "set null" }),
  nameAtCollection: text("name_at_collection").notNull(),
});
export const discoveryMetricEvents = ingestSchema.table("discovery_metric_events", {
  id: uuid("id").primaryKey(), impressionId: uuid("impression_id").notNull().references((): AnyPgColumn => discoveryMetricEvents.id, { onDelete: "cascade" }),
  subjectId: bigint("subject_id", { mode: "number" }).notNull().references(() => discoveryMetricSubjects.id),
  kind: text("kind").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  clientKey: text("client_key").notNull(), exposureConfig: text("exposure_config").notNull(),
});
export const discoveryMetricDaily = ingestSchema.table("discovery_metric_daily", {
  day: date("day").notNull(), subjectId: bigint("subject_id", { mode: "number" }).notNull().references(() => discoveryMetricSubjects.id),
  kind: text("kind").notNull(), count: integer("count").notNull(), exposureConfigs: text("exposure_configs").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.day, t.subjectId, t.kind] })]);
export const discoveryMetricJobs = ingestSchema.table("discovery_metric_jobs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }), status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(1), summary: jsonb("summary").notNull().default({}),
});
