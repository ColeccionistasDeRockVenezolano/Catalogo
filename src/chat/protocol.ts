// CRV · Protocolo del chat (REST + WebSocket).
//
// Los eventos se validan con zod en el servidor y se comparten con el
// navegador: un mensaje mal formado se rechaza antes de tocar PostgreSQL.
// Nada de XML ni base64: JSON plano y campos con nombre.
import { z } from "zod";
import { EFFECT_KINDS } from "./effects-catalog.js";

export const MAX_BODY = 2000;

export const equippedSchema = z.object({
  name: z.string().nullable(),
  frame: z.string().nullable(),
  background: z.string().nullable(),
  ambient: z.string().nullable(),
});
export type Equipped = z.infer<typeof equippedSchema>;

export const chatUserSchema = z.object({
  id: z.string(),
  handle: z.string(),
  displayName: z.string(),
  avatarSeed: z.string(),
  isBot: z.boolean(),
  equipped: equippedSchema,
});
export type ChatUser = z.infer<typeof chatUserSchema>;

export const chatMessageSchema = z.object({
  id: z.number().int(),
  roomId: z.number().int(),
  actorId: z.string().nullable(),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  kind: z.enum(["chat", "system", "action", "sticker"]),
  body: z.string(),
  effectCode: z.string().nullable(),
  createdAt: z.string(),
  equipped: equippedSchema.nullable(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRoomSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  theme: z.record(z.unknown()),
});
export type ChatRoom = z.infer<typeof chatRoomSchema>;

export const chatEffectSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.enum(EFFECT_KINDS),
  description: z.string(),
  manifest: z.record(z.unknown()),
  priceCoins: z.number().int(),
  priceCredits: z.number().int(),
  durationDays: z.number().int().nullable(),
  sort: z.number().int(),
  owned: z.boolean(),
  equipped: z.boolean(),
});
export type ChatEffect = z.infer<typeof chatEffectSchema>;

export const walletSchema = z.object({
  coins: z.number().int(),
  credits: z.number().int(),
});
export type Wallet = z.infer<typeof walletSchema>;

// ── Cliente → servidor ─────────────────────────────────────────────────────
export const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), body: z.string().trim().min(1).max(MAX_BODY), effectCode: z.string().max(40).optional() }),
  z.object({ type: z.literal("typing"), active: z.boolean() }),
  z.object({ type: z.literal("action"), code: z.string().regex(/^[a-z0-9-]{2,40}$/u), targetId: z.string().uuid().optional() }),
  z.object({ type: z.literal("equip"), slot: z.enum(["name", "frame", "background", "ambient"]), effectCode: z.string().max(40).nullable() }),
  z.object({ type: z.literal("profile"), displayName: z.string().trim().min(2).max(40) }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

// ── Servidor → cliente ─────────────────────────────────────────────────────
export type ServerEvent =
  | { type: "snapshot"; room: ChatRoom; actor: ChatUser; me: { coins: number; credits: number }; messages: ChatMessage[]; users: ChatUser[]; effects: ChatEffect[] }
  | { type: "message"; message: ChatMessage }
  | { type: "presence"; users: ChatUser[] }
  | { type: "typing"; actorId: string; displayName: string; active: boolean }
  | { type: "system"; text: string }
  | { type: "wallet"; coins: number; credits: number }
  | { type: "equipped"; actorId: string; equipped: Equipped }
  | { type: "error"; code: string; message: string };

/** Límites de escritura por conexión (ventana deslizante de 10 s). */
export const CHAT_RATE = { windowMs: 10_000, maxMessages: 8, maxTyping: 20 } as const;
