// El servidor y el navegador usan exactamente la misma regla de puntuación.
export { personIdentityAssessment, IDENTITY_RECOMMENDATION } from "../../../src/review/person-identity-assessment.js";
export type { IdentityRecommendation } from "../../../src/review/person-identity-assessment.js";

export { comparisonRows } from "../../../src/review/person-comparison.js";
export type { PersonComparison, ComparisonRow, ComparisonCitation, ComparedPerson } from "../../../src/review/person-comparison.js";
export const formatIdentityPoints = (value: number) => new Intl.NumberFormat("es-VE", { maximumFractionDigits: 1 }).format(value);
