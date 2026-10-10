import { bigint, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ingestSchema } from "./ingest-enums.js";
import { tracks } from "./core.js";
import { claimEvidence } from "./ingest.js";
export const recommendationRequests = ingestSchema.table("recommendation_requests", {
  id: uuid("id").primaryKey(), actor: text("actor").notNull(), intent: jsonb("intent"),
  interpretation: jsonb("interpretation").notNull(), response: jsonb("response").notNull(),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const recommendationFeedback = ingestSchema.table("recommendation_feedback", {
  id: bigint("id",{mode:"number"}).primaryKey().generatedAlwaysAsIdentity(),
  requestId: uuid("request_id").notNull().references(() => recommendationRequests.id,{onDelete:"restrict"}),
  feedbackKey: text("feedback_key").notNull(), trackId: bigint("track_id",{mode:"number"}),
  verdict: text("verdict").notNull(), reviewer: text("reviewer").notNull(), reason: text("reason").notNull(),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const recommendationVersions = ingestSchema.table("recommendation_versions", {
  id: bigint("id",{mode:"number"}).primaryKey().generatedAlwaysAsIdentity(), importKey: text("import_key").notNull().unique(),
  groupKey: text("group_key").notNull(), trackId: bigint("track_id",{mode:"number"}).notNull().references(()=>tracks.id,{onDelete:"cascade"}),
  evidenceId: bigint("evidence_id",{mode:"number"}).notNull().references(()=>claimEvidence.id,{onDelete:"restrict"}),
  state: text("state").notNull(), reviewer: text("reviewer").notNull(), reason: text("reason").notNull(),
  reviewedAt: timestamp("reviewed_at",{withTimezone:true}).notNull().defaultNow(),
});
