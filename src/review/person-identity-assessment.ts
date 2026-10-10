import { comparisonRows, type ComparisonRow, type PersonComparison } from "./person-comparison.js";

/** Un puntaje de respaldo documental, no una probabilidad ni autorización para fusionar. */
export type IdentityRecommendation = "investigate" | "consider_merge" | "do_not_merge" | "review_split" | "wait";
export type IdentityVerdict = "same" | "different" | "mixed" | "unknown";
export interface IdentityResearch {
  verdict: IdentityVerdict;
  evidence: ReadonlyArray<{ supports: "same" | "different" | "mixed" }>;
  comparison?: PersonComparison | null;
  declaredDistinct?: boolean;
}
export interface IdentityAssessment {
  score: number | null; evidencePoints: number; recommendation: IdentityRecommendation; explanation: string;
  signals: ComparisonRow[];
}
export function personIdentityAssessment(_catalogScore: number | null, research: IdentityResearch | null,
  blockedReason: string | null = null, comparisonOverride: PersonComparison | null = null): IdentityAssessment {
  const comparison = comparisonOverride ?? research?.comparison;
  const signals = comparison ? comparisonRows(comparison) : [];
  const catalogPoints = signals.filter((s) => !s.key.startsWith("web_") && s.key !== "bridge").reduce((sum, s) => sum + s.points, 0);
  const evidencePoints = comparison && !comparison.stale ? Math.round((comparison.documentary.a + comparison.documentary.b + comparison.documentary.bridge) * 10) / 10 : 0;
  const score = comparison ? Math.round((catalogPoints + evidencePoints) * 10) / 1000 : null;
  const answer = (recommendation: IdentityRecommendation, explanation: string, rejected = false): IdentityAssessment => ({
    score: rejected ? 0 : score, evidencePoints: rejected ? 0 : evidencePoints, recommendation, explanation, signals,
  });
  if (research?.declaredDistinct) return answer("do_not_merge", "Una persona ya registró que estas fichas son distintas.", true);
  if (blockedReason) return answer("wait", `El catálogo contiene ${blockedReason}. Hay una contradicción que debe comprobarse antes de fusionar.`, true);
  if (!research) return answer("investigate", "Falta investigar ambas fichas y comprobar una conexión documental entre sus trayectorias.");
  if (comparison?.stale) return answer("wait", "Los datos de las fichas cambiaron desde la investigación. Actualízala: la evidencia anterior no suma puntos.");
  const verdict = comparison?.conclusion ?? research.verdict;
  const quoted = research.evidence.some((item) => item.supports === verdict);
  if (verdict === "different" && (quoted || comparison?.contradictions.length)) return answer("do_not_merge", "Las fuentes documentan una contradicción entre ambas personas. Revisa las pruebas de cada ficha.", true);
  if (verdict === "mixed" && quoted) return answer("review_split", "Una ficha reúne trayectorias incompatibles. Revisa las pruebas antes de separar sus créditos.", true);
  if (!comparison) return answer("wait", "La investigación guardada no incluye el desglose de ambas fichas. Actualízala para evaluar su evidencia; no recibe puntos documentales completos.");
  if (comparison.contradictions.length) return answer("wait", "Hay pruebas contradictorias. El puntaje no resuelve esa contradicción; revisa las fuentes de ambos lados.", true);
  const linked = comparison.bridge.some((item) => item.origin === "page");
  const both = comparison.a.evidence.some((item) => item.origin === "page") && comparison.b.evidence.some((item) => item.origin === "page");
  if (verdict === "same" && linked && both && quoted) return answer("consider_merge", "Hay evidencia para ambas fichas y una conexión documental entre sus trayectorias. Revisa el detalle y los datos pendientes antes de decidir.");
  return answer("wait", "La evidencia disponible es parcial. Falta corroborar ambas trayectorias y su conexión; no permite decidir que sean la misma persona.");
}
export const IDENTITY_RECOMMENDATION: Record<IdentityRecommendation, string> = {
  investigate: "Investigar ambas fichas", consider_merge: "Conexión documentada: revisar para fusionar",
  do_not_merge: "No fusionar: personas distintas", review_split: "No fusionar: revisar la ficha mezclada", wait: "Sin conclusión comprobada",
};
