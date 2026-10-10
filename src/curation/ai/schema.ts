import { z } from "zod";
import type { CatalogDraft, CatalogOperation, CatalogRef } from "./types.js";

export const catalogKindSchema = z.enum([
  "artist",
  "person",
  "organization",
  "album",
  "track",
]);
export const refSchema = z.union([
  z
    .object({ kind: catalogKindSchema, id: z.number().int().positive() })
    .strict(),
  z
    .object({
      kind: catalogKindSchema,
      key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u),
    })
    .strict(),
]);
const value = z.union([
  z.string().max(20000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const values = z
  .record(value)
  .refine((v) => Object.keys(v).length > 0, "indica al menos un campo");
const relation = z.enum([
  "artist_membership",
  "person_organization",
  "album_credit",
  "track_credit",
  "album_format",
]);
const base = {
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u),
  label: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(700),
  evidenceIds: z.array(z.string().max(80)).max(8).default([]),
  enabled: z.boolean().default(true),
};
export const operationSchema = z.discriminatedUnion("op", [
  z
    .object({
      ...base,
      op: z.literal("create_album"),
      artist: refSchema,
      labelEntity: refSchema.optional(),
      values,
      tracks: z
        .array(
          z
            .object({
              title: z.string().trim().min(1).max(250),
              discNumber: z.number().int().min(1).max(99).default(1),
              trackNumber: z.number().int().min(1).max(999),
              durationSeconds: z
                .number()
                .int()
                .nonnegative()
                .nullable()
                .optional(),
              youtubeStartSeconds: z
                .number()
                .int()
                .nonnegative()
                .nullable()
                .optional(),
              notes: z.string().max(2000).nullable().optional(),
            })
            .strict(),
        )
        .max(150)
        .default([]),
      credits: z
        .array(
          z
            .object({
              target: refSchema,
              role: z.string().trim().min(1).max(200),
              creditType: z.string().max(50).optional(),
            })
            .strict(),
        )
        .max(60)
        .default([]),
      genres: z
        .array(
          z
            .object({
              slug: z.string().min(1).max(100),
              role: z.enum(["primary", "secondary"]).default("secondary"),
            })
            .strict(),
        )
        .max(12)
        .default([]),
      aliases: z.array(z.string().trim().min(1).max(250)).max(12).default([]),
      formats: z
        .array(
          z
            .object({
              format: z.string().trim().min(1).max(50),
              quality: z.enum(["HQ", "LQ", "unknown"]).optional(),
              archiveStatus: z
                .enum(["published", "unpublished", "unknown"])
                .optional(),
              notes: z.string().max(2000).nullable().optional(),
            })
            .strict(),
        )
        .max(12)
        .default([]),
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("create_entity"),
      kind: catalogKindSchema,
      values,
      parent: refSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("replace_fields"),
      target: refSchema,
      values,
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("add_alias"),
      target: refSchema,
      alias: z.string().trim().min(1).max(250),
      aliasType: z
        .enum([
          "name_variant",
          "spelling_variant",
          "former_name",
          "stage_name",
          "acronym",
          "misspelling",
          "alternate_title",
          "other",
        ])
        .default("name_variant"),
      isPrimary: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("create_relation"),
      kind: relation,
      endpoints: z.record(refSchema),
      values,
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("replace_relation"),
      kind: relation,
      id: z.number().int().positive(),
      values,
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("remove_relation"),
      kind: relation,
      id: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("assign_genre"),
      target: refSchema,
      genreSlug: z.string().min(1).max(100),
      role: z.enum(["primary", "secondary"]).default("secondary"),
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("remove_genre"),
      target: refSchema,
      genreSlug: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("reorder_tracks"),
      album: refSchema,
      positions: z
        .array(
          z
            .object({
              track: refSchema,
              discNumber: z.number().int().min(1).max(99),
              trackNumber: z.number().int().min(1).max(999),
            })
            .strict(),
        )
        .min(1)
        .max(250),
    })
    .strict(),
  z
    .object({
      ...base,
      op: z.literal("merge_entities"),
      keep: refSchema,
      drop: refSchema,
      fieldChoices: z.record(z.enum(["keep", "drop"])).default({}),
    })
    .strict(),
  z
    .object({ ...base, op: z.literal("remove_entity"), target: refSchema })
    .strict(),
]);
export const draftSchema = z
  .object({
    summary: z.string().max(1500),
    operations: z.array(operationSchema),
    unresolved: z.array(z.string().max(700)),
  })
  .strict();
export const plannerSchema = draftSchema
  .extend({
    resolvedUnresolved: z.array(z.string().max(700)).default([]),
    lookups: z
      .array(
        z
          .object({
            type: z.enum(["catalog", "web", "page"]),
            query: z.string().trim().min(1).max(500),
            kind: catalogKindSchema.optional(),
          })
          .strict(),
      )
      .max(4)
      .default([]),
  })
  .strict();

export function operationRefs(op: CatalogOperation): CatalogRef[] {
  if (op.op === "create_album")
    return [
      op.artist,
      ...(op.labelEntity ? [op.labelEntity] : []),
      ...op.credits.map((c) => c.target),
    ];
  if ("target" in op) return [op.target];
  if (op.op === "create_entity") return op.parent ? [op.parent] : [];
  if (op.op === "create_relation") return Object.values(op.endpoints);
  if (op.op === "merge_entities") return [op.keep, op.drop];
  if (op.op === "reorder_tracks")
    return [op.album, ...op.positions.map((p) => p.track)];
  return [];
}
/** Stable dependency order; disabling a prerequisite blocks its dependants. */
export function orderedOperations(draft: CatalogDraft): CatalogOperation[] {
  const all = new Map<string, CatalogOperation>();
  for (const op of draft.operations) {
    if (all.has(op.key)) throw new Error(`clave repetida: ${op.key}`);
    all.set(op.key, op);
  }
  const result: CatalogOperation[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (op: CatalogOperation) => {
    if (done.has(op.key)) return;
    if (visiting.has(op.key))
      throw new Error(`dependencia circular: ${op.key}`);
    visiting.add(op.key);
    for (const ref of operationRefs(op))
      if ("key" in ref) {
        const parent = all.get(ref.key);
        const kind =
          parent?.op === "create_album"
            ? "album"
            : parent?.op === "create_entity"
              ? parent.kind
              : null;
        if (!parent?.enabled || kind !== ref.kind)
          throw new Error(`referencia nueva no disponible: ${ref.key}`);
        visit(parent);
      }
    visiting.delete(op.key);
    done.add(op.key);
    result.push(op);
  };
  draft.operations.filter((op) => op.enabled).forEach(visit);
  return result;
}
