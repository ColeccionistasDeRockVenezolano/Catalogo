import type { SourceProvenance } from "../../evidence/provenance.js";

/** Shared type-only contract. The model proposes; an admin approves the exact preview. */
export type CatalogKind =
  | "artist"
  | "person"
  | "organization"
  | "album"
  | "track";
export type CatalogRef =
  | { kind: CatalogKind; id: number }
  | { kind: CatalogKind; key: string };
export type RelationKind =
  | "artist_membership"
  | "person_organization"
  | "album_credit"
  | "track_credit"
  | "album_format";
export type CatalogValue = string | number | boolean | null;
export interface OperationBase {
  key: string;
  label: string;
  reason: string;
  evidenceIds: string[];
  enabled: boolean;
}
export type CatalogOperation = OperationBase &
  (
    | {
        op: "create_album";
        artist: CatalogRef;
        labelEntity?: CatalogRef | undefined;
        values: Record<string, CatalogValue>;
        tracks: Array<{
          title: string;
          discNumber: number;
          trackNumber: number;
          durationSeconds?: number | null | undefined;
          youtubeStartSeconds?: number | null | undefined;
          notes?: string | null | undefined;
        }>;
        credits: Array<{
          target: CatalogRef;
          role: string;
          creditType?: string | undefined;
        }>;
        genres: Array<{ slug: string; role: "primary" | "secondary" }>;
        aliases: string[];
        formats: Array<{
          format: string;
          quality?: "HQ" | "LQ" | "unknown" | undefined;
          archiveStatus?: "published" | "unpublished" | "unknown" | undefined;
          notes?: string | null | undefined;
        }>;
      }
    | {
        op: "create_entity";
        kind: CatalogKind;
        values: Record<string, CatalogValue>;
        parent?: CatalogRef | undefined;
      }
    | {
        op: "replace_fields";
        target: CatalogRef;
        values: Record<string, CatalogValue>;
      }
    | {
        op: "add_alias";
        target: CatalogRef;
        alias: string;
        aliasType: string;
        isPrimary: boolean;
      }
    | {
        op: "add_social_link";
        target: CatalogRef;
        platform: "instagram" | "facebook" | "x" | "tiktok" | "threads" | "bluesky" | "website" | "store" | "linktree";
        url: string;
        handle?: string | null | undefined;
      }
    | {
        op: "create_relation";
        kind: RelationKind;
        endpoints: Record<string, CatalogRef>;
        values: Record<string, CatalogValue>;
      }
    | {
        op: "replace_relation";
        kind: RelationKind;
        id: number;
        values: Record<string, CatalogValue>;
      }
    | { op: "remove_relation"; kind: RelationKind; id: number }
    | {
        op: "assign_genre";
        target: CatalogRef;
        genreSlug: string;
        role: "primary" | "secondary";
      }
    | { op: "remove_genre"; target: CatalogRef; genreSlug: string }
    | {
        op: "reorder_tracks";
        album: CatalogRef;
        positions: Array<{
          track: CatalogRef;
          discNumber: number;
          trackNumber: number;
        }>;
      }
    | {
        op: "merge_entities";
        keep: CatalogRef;
        drop: CatalogRef;
        fieldChoices: Record<string, "keep" | "drop">;
      }
    | { op: "remove_entity"; target: CatalogRef }
  );
export interface CatalogDraft {
  summary: string;
  operations: CatalogOperation[];
  unresolved: string[];
}
export interface CatalogField {
  key: string;
  type: "string" | "number" | "boolean";
  nullable: boolean;
  options?: string[];
}
export interface CatalogVocabulary {
  configured: boolean;
  model: string;
  modelLabel: string;
  maxCalls: number;
  maxTokens: number;
  entities: Record<CatalogKind, CatalogField[]>;
  relations: Record<RelationKind, CatalogField[]>;
  genres: Array<{
    slug: string;
    name: string;
    level: string;
    parentGenreId: number | null;
  }>;
}
export interface CatalogEvidence extends SourceProvenance {
  id: string;
  url: string;
  quote: string;
  fetchedAt: string;
  origin: string;
  contentHash: string;
  label: string;
}
export interface CatalogPreviewItem {
  key: string;
  op: CatalogOperation["op"];
  label: string;
  before: unknown;
  after: unknown;
  error: string | null;
  warnings: string[];
  /** Parts without documentary support; present on accepted editorial decisions too. */
  evidenceGaps?: string[] | undefined;
}
export interface CatalogPreview {
  hash: string;
  ready: boolean;
  sensitive: boolean;
  operationHashes?: Record<string, string>;
  /** What the plan really contains and the summary claims no operation backs. */
  outcome?: { text: string; issues: string[] } | undefined;
  items: CatalogPreviewItem[];
  affected: Array<{ kind: CatalogKind; id: number; label: string }>;
}
export interface CatalogPlan {
  id: number;
  entityKind: CatalogKind;
  entityId: number;
  instruction: string;
  status: "queued" | "running" | "ready" | "failed" | "applied" | "reviewed";
  phase: string;
  revision: number;
  draft: CatalogDraft | null;
  evidence: CatalogEvidence[];
  preview: CatalogPreview | null;
  reviewedKeys: string[];
  decisions?: Record<string, CatalogDecision>;
  result: {
    runId: number;
    created: Record<string, { kind: CatalogKind; id: number }>;
    verification?: unknown;
  } | null;
  usage: {
    calls: number;
    cachedCalls: number;
    tokensIn: number;
    tokensOut: number;
    model?: string;
  };
  requestedBy: string;
  editedBy: string | null;
  appliedBy: string | null;
  error: string | null;
  runId: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface CatalogDecision {
  decision: "accepted" | "rejected";
  decidedBy: string;
  decidedAt: string;
  runId: number | null;
  undone?: boolean;
  preview?: CatalogPreviewItem;
}
export const OPERATION_LABELS: Record<CatalogOperation["op"], string> = {
  create_entity: "Crear ficha",
  replace_fields: "Reemplazar campos",
  add_alias: "Añadir alias",
  add_social_link: "Añadir red social",
  create_album: "Añadir disco completo",
  create_relation: "Añadir relación",
  replace_relation: "Corregir relación",
  remove_relation: "Retirar relación",
  assign_genre: "Añadir género",
  remove_genre: "Retirar género",
  reorder_tracks: "Ordenar pistas",
  merge_entities: "Fusionar fichas",
  remove_entity: "Retirar ficha",
};
