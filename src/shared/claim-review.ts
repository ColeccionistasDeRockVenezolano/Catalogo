/** Contrato de la bandeja visual. Cada decisión enumera los claims vistos. */
export interface ClaimReviewEntity {
  kind: string;
  id: number | null;
  name: string;
  context: string | null;
  imageUrl: string | null;
  albumId: number | null;
}
export interface ClaimReviewGroup {
  id: number;
  entity: ClaimReviewEntity;
  pending: number;
  conflicts: number;
  sources: string[];
  fields: string[];
}
export interface ClaimReviewChange {
  id: number;
  version: string;
  field: string;
  value: unknown;
  currentValue: unknown;
  hasCurrentField: boolean;
  status: string;
  confidence: string;
  sourceName: string;
  sourceUrl: string | null;
  evidence: Array<{ url: string | null; excerpt: string | null }>;
  reviewId: number | null;
  requiresReview: boolean;
  canAccept: boolean;
  canReject: boolean;
}
export interface ClaimReviewDetail {
  group: ClaimReviewGroup;
  changes: ClaimReviewChange[];
  pagination: { total: number; limit: number; offset: number };
}
export interface ClaimReviewResult {
  runId: number;
  results: Array<{ id: number; action: string; detail: string }>;
  accepted: number;
  rejected: number;
  pending: number;
}
