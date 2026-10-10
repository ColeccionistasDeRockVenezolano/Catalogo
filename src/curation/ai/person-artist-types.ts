import type { CatalogEvidence } from "./types.js";

export interface ArtistIdentityCandidate {
  id: number;
  name: string;
  artistType: string;
  biography: string | null;
  originCountry: string;
  aliases: string[];
  members: Array<{ personId: number; name: string; realName: string | null }>;
}
export interface PersonArtistResult {
  action:
    | "created"
    | "linked"
    | "already_linked"
    | "conflict"
    | "not_solo"
    | "unresolved";
  artistId: number | null;
  stageName: string | null;
  explanation: string;
  conflicts: string[];
  candidates: ArtistIdentityCandidate[];
  evidence: CatalogEvidence[];
  runId: number | null;
  reports: Partial<Record<"person" | "artist", number>>;
  pending: string[];
}
export interface PersonArtistJob {
  id: number;
  personId: number;
  status: "queued" | "running" | "done" | "failed";
  phase: string;
  result: PersonArtistResult | null;
  error: string | null;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
}
