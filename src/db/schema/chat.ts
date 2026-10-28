// CRV · Schema tipado (Drizzle) del schema `chat`.
// DDL real en migrations/0105_chat_core, 0106_chat_effects y 0107_chat_wallet.
// Igual que el resto de schemas auxiliares, el DDL es la fuente de verdad y
// este archivo se mantiene sincronizado a mano.
import { bigint, boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const chat = pgSchema("chat");

export const chatActors = chat.table("actors", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull().default("guest"),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  avatarSeed: text("avatar_seed").notNull().default("crv"),
  claimedUserId: text("claimed_user_id"),
  isBot: boolean("is_bot").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatRooms = chat.table("rooms", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  theme: jsonb("theme").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const chatMessages = chat.table("messages", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  roomId: integer("room_id").notNull(),
  actorId: uuid("actor_id"),
  body: text("body").notNull(),
  kind: text("kind").notNull().default("chat"),
  effectCode: text("effect_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const chatEffects = chat.table("effects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  description: text("description").notNull().default(""),
  manifest: jsonb("manifest").notNull(),
  priceCoins: integer("price_coins").notNull().default(0),
  priceCredits: integer("price_credits").notNull().default(0),
  durationDays: integer("duration_days"),
  enabled: boolean("enabled").notNull().default(true),
  sort: integer("sort").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatEffectInventory = chat.table("effect_inventory", {
  actorId: uuid("actor_id").notNull(),
  effectId: integer("effect_id").notNull(),
  qty: integer("qty").notNull().default(1),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const chatEquipped = chat.table("equipped", {
  actorId: uuid("actor_id").notNull(),
  slot: text("slot").notNull(),
  effectId: integer("effect_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatAccounts = chat.table("accounts", {
  actorId: uuid("actor_id").primaryKey(),
  coins: bigint("coins", { mode: "number" }).notNull().default(0),
  credits: bigint("credits", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatLedger = chat.table("ledger", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid("actor_id").notNull(),
  deltaCoins: bigint("delta_coins", { mode: "number" }).notNull().default(0),
  deltaCredits: bigint("delta_credits", { mode: "number" }).notNull().default(0),
  reason: text("reason").notNull(),
  ref: text("ref"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
