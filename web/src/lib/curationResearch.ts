import type { CurationFinding } from "./types";
import { findingPair } from "./curation";

export interface DocumentedResearch {
  label: string;
  verdict: string;
  finding: string;
  recommendation: string;
  researchedAt: string;
  suggestedKeep: number | null;
  changedAlbumIds: number[];
  sources: string[];
  albums: Array<{ id: number; title: string; artist: string; year: number | null; tracks: number }>;
  mergePreview: { positionOnly: unknown[]; engineSuggestedMode: string; requiredMode: string } | null;
}

export function researchOf(finding: CurationFinding): DocumentedResearch | null {
  const value = finding.evidence["research"] as DocumentedResearch | undefined;
  return value && typeof value.finding === "string" && Array.isArray(value.albums)
    && Array.isArray(value.sources) && Array.isArray(value.changedAlbumIds) ? value : null;
}

export function researchInstruction(finding: CurationFinding): string {
  const research = researchOf(finding);
  return [
    `Revisa este hallazgo: ${finding.title}. ${finding.suggestion ?? ""}`,
    ...(findingPair(finding) ? [`Fichas del par: ${findingPair(finding)!.join(" y ")}.`] : []),
    ...(research ? [
      `Investigación guardada: ${research.finding}`,
      `Fichas: ${research.albums.map((album) => `#${album.id} ${album.title}`).join("; ")}.`,
      `Fuentes: ${research.sources.join(" ")}`,
      ...(research.changedAlbumIds.length ? ["Las fichas cambiaron desde la investigación: verifica de nuevo los datos antes de proponer cambios."] : []),
    ] : []),
    "Consulta las fuentes y prepara solo cambios documentados para revisión humana.",
  ].join("\n");
}
