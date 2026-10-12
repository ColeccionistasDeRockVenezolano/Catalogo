import type { ResearchLedger } from "./research-ledger.js";
import type { SourceProvenance } from "../evidence/provenance.js";

export type VerificationKind = "person" | "artist" | "album";
export const VERIFICATION_AREAS = {
  identity: { label: "Nombre e identidad", weight: 15 },
  members: { label: "Integrantes y créditos", weight: 15 },
  discography: { label: "Discos y discografía", weight: 15 },
  missingAlbums: { label: "Discos faltantes", weight: 10 },
  tracks: { label: "Pistas y orden por álbum", weight: 15 },
  socials: { label: "Redes y enlaces", weight: 10 },
  genres: { label: "Géneros", weight: 5 },
  status: { label: "Estado y cronología", weight: 5 },
  images: { label: "Portadas y fotos", weight: 5 },
  labels: { label: "Sellos discográficos", weight: 5 },
  biography: { label: "Biografía", weight: 10 },
} as const;
export type VerificationArea = keyof typeof VERIFICATION_AREAS;
export interface VerificationUnit {
  key: string; area: VerificationArea; label: string; value: string | null;
  /** Datos literales necesarios para respaldar una unidad completa. */
  expected: string[]; context: string[]; issue: string | null;
}
export interface VerificationSnapshot {
  kind: VerificationKind; id: number; name: string; identity: string[];
  units: VerificationUnit[]; sourceUrls: string[];
  catalogAlbums: Array<{ id: number; title: string; artist: string; year: number | null }>;
  albums: Array<{ id: number; title: string; artist: string; year: number | null }>;
}
export type VerificationStatus = "confirmed" | "partial" | "contradicted" | "missing" | "unverified";
export interface VerificationEvidence extends SourceProvenance {
  contentHash?:string;
  requiresOriginalReview?:boolean;
  captureId?:number;
  locations?:import("./documents/types.js").DocumentLocation[];
  url: string; title: string; quote: string; origin: "page" | "search_snippet"; fetchedAt: string;
}
export interface VerificationFinding extends VerificationUnit {
  status: VerificationStatus; observed: string | null; explanation: string;
  coverage: number; evidence: VerificationEvidence[];
}
export interface VerificationReport {
  researchVersionId?:number;
  /** Respaldo provisional guardado mientras se evalúan los lotes. */
  inProgress?: boolean;
  research?: ResearchLedger | undefined;
  rulesVersion?: number;
  suggestions?: VerificationFinding[];
  evaluation?: { total: number; processed: number; pendingKeys: string[]; attempts: number; complete: boolean; sourceChunks?: { total: number; processed: number } };
  version: 1; snapshotHash: string; kind: VerificationKind; entityId: number; name: string;
  createdAt: string; researched: boolean; stale: boolean; score: number | null;
  areas: Array<{ key: VerificationArea; label: string; points: number; maximum: number; confirmed: number; partial: number; missing: number; contradicted: number; unverified: number }>;
  findings: VerificationFinding[]; issues: string[]; limitations: string[];
  sources: Array<SourceProvenance & { url: string; title: string; origin: "page" | "search_snippet"; fetchedAt: string; contentHash: string;document?:Omit<import("./documents/types.js").DocumentMetadata,"locations"|"followLinks"> }>;
}
export interface VerificationJob {
  researchVersionId?:number;
  sourceReportId?:number;
  resumeFromJobId?:number;
  reportId?:number;
  preservedOnly?:boolean;
  id: number; kind: VerificationKind; entityId: number;
  status: "queued" | "running" | "done" | "failed" | "partial" | "paused" | "cancelled";
  control?: "continue" | "paused" | "cancelled";
  budget?: { maxCalls?:number | undefined; maxTokens?:number | undefined };
  error: string | null; requestedAt: string; finishedAt: string | null;
  progress?: VerificationProgress | null;
}
export interface VerificationVersion {
  id:number;createdAt:string;requestedBy:string;sourceCount:number;
  snapshotHash:string;complete:boolean;reprocessAvailable:boolean;unavailableReason:string|null;
}
export interface VerificationHistory {versions:VerificationVersion[];nextBeforeId:number|null;}
export interface VerificationProgress {
  phase: "collecting" | "evaluating" | "saving" | "done";
  completed: number; total: number; sources: number;
  evaluated: number; totalUnits: number; updatedAt: string;
}

/** Solo coincidencias y discrepancias externas entran en la puntuación. */
export function isDocumentarilyScored(f: VerificationFinding): boolean {
  return f.key!=="discography.search"&&!f.issue&&f.value!==null&&f.evidence.length>0&&(f.status==="confirmed"||f.status==="partial"||f.status==="contradicted");
}
