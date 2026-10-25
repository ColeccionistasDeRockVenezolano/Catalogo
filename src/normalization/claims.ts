// Normalización determinista. El valor crudo nunca se modifica: solo se
// añade una representación comparable y un hash estable para idempotencia.
import { createHash } from "node:crypto";
import { z } from "zod";
import { claimEntityKindSchema, rawRecordSchema, type Evidence, type RawRecord } from "../adapters/contracts.js";
import { normalizeDisplayName, normalizeEntityName } from "./entity-name.js";
import { liveTitleVerdict } from "./live-title.js";

export const normalizedClaimSchema = z.object({
  entityKind: claimEntityKindSchema,
  identity: z.string().min(1),
  identitySecondary: z.string().min(1),
  originalIdentity: z.string().min(1),
  field: z.string().min(1).max(80),
  rawValue: z.unknown(),
  normalizedValue: z.unknown(),
  rawHash: z.string().regex(/^[0-9a-f]{64}$/),
  extractor: z.string().min(1),
  extractorVersion: z.string().min(1),
  evidence: z.object({
    url: z.string().url(), excerpt: z.string().optional(), selector: z.string().optional(), position: z.number().int().optional(),
  }),
}).strict();

export type NormalizedClaim = z.infer<typeof normalizedClaimSchema>;

/** Punto de extensión para normalizadores por fuente sin acoplar adapters al merge. */
export interface ClaimNormalizer {
  normalize(record: RawRecord): NormalizedClaim[];
}

export function normalizeText(value: string): string {
  return normalizeDisplayName(value);
}

/** Clave primaria: las tildes se conservan; ver normalizeIdentitySecondary. */
export function normalizeIdentity(value: string): string {
  return normalizeEntityName(value).primaryKey;
}

/** La forma sin tildes es solo una senal secundaria, nunca identidad exacta. */
export function normalizeIdentitySecondary(value: string): string {
  return normalizeEntityName(value).secondaryKey;
}

export function normalizeYear(value: unknown): number | null {
  const compact = String(value).replace(/\s+/g, "").replace(/\.0+$/, "");
  if (!/^\d{4}$/.test(compact)) return null;
  const year = Number(compact);
  return year >= 1900 && year <= 2100 ? year : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function normalizeValue(field: string, rawValue: unknown): unknown {
  if (field.endsWith("_year") || field === "formed_year" || field === "disbanded_year") return normalizeYear(rawValue);
  return typeof rawValue === "string" ? normalizeText(rawValue) : rawValue;
}

/**
 * Regla «en vivo» (plan v2 del primo, punto 5), común a todos los adapters: un
 * disco cuyo título dice que es en vivo y cuya fuente no da tipo lleva además
 * `album_type = live_album`, con la evidencia del título. Si la fuente sí da
 * tipo (la hoja, un «(EP 2015)»), manda la fuente: no se deriva nada. La
 * hoja YT Master tampoco: un disco suyo sin tipo es un tipo compuesto que
 * espera revisión, no un hueco.
 */
const SHEET_EXTRACTORS = new Set(["yt-master-seed"]);

export function withLiveAlbumType(record: RawRecord): RawRecord {
  if (record.entityKind !== "album" || SHEET_EXTRACTORS.has(record.extractor)) return record;
  if (record.fields.some((field) => field.field === "album_type")) return record;
  const title = record.fields.find((field) => field.field === "title" && typeof field.value === "string");
  if (!title) return record;
  const artist = record.fields.find((field) => field.field === "artist_name" && typeof field.value === "string")?.value as string | undefined;
  const verdict = liveTitleVerdict(title.value as string, artist);
  if (!verdict.live) return record;
  return {
    ...record,
    fields: [...record.fields, {
      field: "album_type",
      value: "live_album",
      evidence: { ...title.evidence, excerpt: `regla «en vivo» (${verdict.marker}): ${String(title.value)}`.slice(0, 20_000) },
    }],
  };
}

export function normalizeRecord(recordInput: RawRecord): NormalizedClaim[] {
  const record = withLiveAlbumType(rawRecordSchema.parse(recordInput));
  const normalizedIdentity = normalizeEntityName(record.identity);
  const identity = normalizedIdentity.primaryKey;
  return record.fields.map((rawField) => {
    const evidence: Evidence = rawField.evidence;
    const rawHash = createHash("sha256").update(stableJson({
      entityKind: record.entityKind, identity, field: rawField.field, value: rawField.value, evidence,
    })).digest("hex");
    return normalizedClaimSchema.parse({
      entityKind: record.entityKind,
      identity,
      identitySecondary: normalizedIdentity.secondaryKey,
      originalIdentity: record.identity,
      field: rawField.field,
      rawValue: rawField.value,
      normalizedValue: normalizeValue(rawField.field, rawField.value),
      rawHash,
      extractor: record.extractor,
      extractorVersion: record.extractorVersion,
      evidence,
    });
  });
}

export const deterministicClaimNormalizer: ClaimNormalizer = { normalize: normalizeRecord };
