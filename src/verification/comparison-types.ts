import type { VerificationEvidence, VerificationKind, VerificationReport, VerificationSnapshot } from "./types.js";
export interface EntityRef { kind: VerificationKind; id: number }
export interface ComparisonSide extends EntityRef { name: string; hash: string; artistType: string | null; facts: Record<string, string[]>; snapshot: VerificationSnapshot; verification: VerificationReport }
export interface ComparisonRow {
  key: string; label: string; left: string[]; right: string[];
  status: "match" | "partial" | "different" | "missing";
  coverage: number; points: number; maximum: number; explanation: string;
}
export type ComparisonConclusion = "same_identity" | "related" | "distinct" | "inconclusive";
export interface ComparisonReport {
  version: 1; left: ComparisonSide; right: ComparisonSide; createdAt: string;
  researched: boolean; stale: boolean; score: number | null;
  catalogPoints: number; webPoints: number; rows: ComparisonRow[];
  conclusion: ComparisonConclusion; explanation: string; evidence: VerificationEvidence[]; limitations: string[];
}
export interface ComparisonJob {
  id: number; left: EntityRef; right: EntityRef;
  status: "queued" | "running" | "done" | "failed";
  error: string | null; requestedAt: string; finishedAt: string | null;
}
