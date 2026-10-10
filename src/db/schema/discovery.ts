import { bigint, integer, text, timestamp } from "drizzle-orm/pg-core";
import { ingestSchema } from "./ingest-enums.js";
import { artists } from "./core.js";
import { claimEvidence } from "./ingest.js";
export const discoveryLabels = ingestSchema.table("discovery_labels", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(), name: text("name").notNull(),
  definition: text("definition").notNull(), criterion: text("criterion").notNull(),
});
const decision = () => ({
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  importKey: text("import_key").notNull().unique(),
  artistId: bigint("artist_id", { mode: "number" }).notNull().references(() => artists.id, { onDelete: "cascade" }),
  evidenceId: bigint("evidence_id", { mode: "number" }).references(() => claimEvidence.id, { onDelete: "restrict" }),
  state: text("state").notNull().default("proposed"),
  reviewer: text("reviewer").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull(),
});
export const artistDiscoveryLabels = ingestSchema.table("artist_discovery_labels", {
  ...decision(), labelId: bigint("label_id", { mode: "number" }).notNull().references(() => discoveryLabels.id, { onDelete: "restrict" }),
});
export const artistSearchSuggestions = ingestSchema.table("artist_search_suggestions", {
  ...decision(), exposureGroup: text("exposure_group").notNull(), priority: integer("priority").notNull().default(1),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
});
