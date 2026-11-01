// CRV · Detector de artistas duplicados por EVIDENCIA (etapa 1 de unificación).
//
// Complementa a `artistas_equivalentes`: aquel compara nombres; este compara
// hechos que una ficha no comparte por casualidad —página de evidencia, cuenta
// oficial, ID externo, lista de pistas, foto, integrantes, discografía— y
// emite un hallazgo por par con la evidencia que lo sostiene.
//
// Es global: corre sobre la foto completa del catálogo y no escribe nada. La
// fusión verificada y el veredicto de la IA llegan en las etapas 2 y 3; hasta
// entonces el hallazgo se revisa a mano.
import { artistPairBlocks, pictureComparableKey, scoreArtistPairs } from "../../review/artist-candidates.js";
import type { Finding } from "../types.js";
import type { AnalysisContext, Detector } from "./shared.js";

const CATEGORY = "fichas_repetidas";
const KEY = "artistas_duplicados_evidencia";
const MIN_SCORE = 0.45;

/** Etiquetas legibles de las señales que ya calcula el detector de review. */
const FEATURE_LABEL: Readonly<Record<string, string>> = {
  shared_evidence_url: "misma página de evidencia",
  shared_official_link: "misma cuenta oficial",
  shared_external_id: "mismo ID externo",
  tracklist_equal: "misma lista de pistas",
  picture_equal: "misma foto",
  alias_claimed: "alias que ya pertenece a la otra ficha",
  member_overlap: "integrantes en común",
  album_overlap: "discografía en común",
  name_token_containment: "nombre contenido",
  name_jaro_winkler: "nombre muy parecido",
  name_phonetic: "fonética equivalente",
  same_city: "misma ciudad",
  same_formed_year: "mismo año de formación",
  same_country: "mismo país",
};

const labelOf = (key: string): string => FEATURE_LABEL[key] ?? key.replaceAll("_", " ");

/** Claves de foto comparables sin leer archivos (sha del nombre o la URL). */
function pictureKeys(facts: readonly { pictureUrl: string | null }[]): Map<string, string | null> {
  const keys = new Map<string, string | null>();
  for (const factsItem of facts) {
    if (!factsItem.pictureUrl || keys.has(factsItem.pictureUrl)) continue;
    keys.set(factsItem.pictureUrl, pictureComparableKey(factsItem.pictureUrl));
  }
  return keys;
}

export const evidenceArtistDuplicates: Detector = {
  key: KEY,
  category: CATEGORY,
  label: "Artistas duplicados por evidencia",
  description:
    "Pares de artistas que comparten página de evidencia, cuenta oficial, ID externo, lista de pistas, foto, integrantes o discografía. No es una decisión: es un par que hay que verificar antes de fusionar.",
  actionability: "actionable",
  actions: { "*": ["verificar_identidad_ia", "fusionar", "descartar_duplicado", "descartar_duplicado_ia"] },
  run(context: AnalysisContext): Finding[] {
    const facts = context.snapshot.artistFacts;
    if (!facts || facts.length < 2) return [];
    const { pairs, comparedPairs } = artistPairBlocks(facts, {
      maxBlockSize: 80,
      skipPair: (key) => {
        const [left, right] = key.split("|").map(Number);
        return left !== undefined && right !== undefined
          && context.snapshot.distinctPairs.has(`artist:${Math.min(left, right)}-${Math.max(left, right)}`);
      },
    });
    const scan = scoreArtistPairs(pairs, { minScore: MIN_SCORE, pictures: pictureKeys(facts) });
    const findings = scan.candidates.map((candidate): Finding => {
      const [first, second] = candidate.a.id <= candidate.b.id
        ? [candidate.a, candidate.b]
        : [candidate.b, candidate.a];
      const positives = candidate.features
        .filter((feature) => feature.value > 0)
        .sort((left, right) => right.value - left.value);
      const labels = [...new Set(positives.map((feature) => labelOf(feature.key)))].slice(0, 3);
      const signature = candidate.deterministic ? "evidencia_determinista" : "probable";
      return {
        detector: KEY,
        category: CATEGORY,
        signature,
        signatureLabel: candidate.deterministic ? "Evidencia determinista" : "Coincidencia probable",
        severity: candidate.deterministic ? "high" : "medium",
        entity: { kind: "artist", id: first.id, label: first.name },
        field: "name",
        value: first.name,
        title: `${first.name} y ${second.name}: ${labels.length ? labels.join(", ") : "coincidencias de identidad"}`,
        suggestion: "Verificar identidad en las dos fichas antes de fusionar; la evidencia está en el par.",
        related: [{ kind: "artist", id: second.id, label: second.name }],
        pair: [first.id, second.id],
        evidence: {
          pair: [first.id, second.id],
          score: candidate.score,
          signals: candidate.signals,
          deterministic: candidate.deterministic,
          features: candidate.features.map((feature) => ({
            key: feature.key, value: feature.value, evidence: feature.evidence,
          })),
          comparedPairs,
        },
      };
    });
    // La bandeja histórica de revisión también vive aquí: un par abierto que la
    // evidencia no alcanzó a puntuar no puede quedar invisible en Curaduría.
    const covered = new Set(findings.map((finding) => `${finding.pair![0]}-${finding.pair![1]}`));
    for (const revision of context.snapshot.openReviewPairs ?? []) {
      const [firstId, secondId] = revision.aId <= revision.bId ? [revision.aId, revision.bId] : [revision.bId, revision.aId];
      const key = `${firstId}-${secondId}`;
      if (covered.has(key)) continue;
      covered.add(key);
      const firstName = revision.aId === firstId ? revision.aName : revision.bName;
      const secondName = revision.aId === firstId ? revision.bName : revision.aName;
      findings.push({
        detector: KEY,
        category: CATEGORY,
        signature: "revision_pendiente",
        signatureLabel: "Revisión pendiente",
        severity: "medium",
        entity: { kind: "artist", id: firstId, label: firstName },
        field: "name",
        value: firstName,
        title: `${firstName} y ${secondName}: par pendiente de revisión`,
        suggestion: "El par venía de la bandeja de revisión. Verifica identidad o descártalo; desde aquí se cierra la tarea vieja.",
        related: [{ kind: "artist", id: secondId, label: secondName }],
        pair: [firstId, secondId],
        evidence: {
          pair: [firstId, secondId], reviewId: revision.reviewId,
          score: 0, signals: 0, deterministic: false, features: [], comparedPairs,
        },
      });
    }
    return findings;
  },
};
