import { z } from "zod";

export const RECOMMENDATION_VERSION = "crv-recommendations-v1";
export const CONTEXTS = ["concentration", "relaxation", "celebration", "joyful", "melancholic", "tense", "serene", "energy-low", "energy-medium", "energy-high"] as const;
export const LABEL_DESCRIPTIONS: Record<typeof CONTEXTS[number], string> = {
  concentration: "música para concentrarse o estudiar", relaxation: "música para descansar o relajarse",
  celebration: "música para celebrar o una fiesta", joyful: "carácter musical alegre",
  melancholic: "carácter musical melancólico", tense: "carácter musical tenso", serene: "carácter musical sereno",
  "energy-low": "intensidad musical baja", "energy-medium": "intensidad musical media", "energy-high": "intensidad musical alta",
};
const id = z.number().int().positive().safe();
const ids = z.array(id).max(200).default([]);
const labels = z.array(z.enum(CONTEXTS)).max(CONTEXTS.length).default([]);
export const recommendationIntentSchema = z.object({
  requiredLabels: labels, excludedLabels: labels,
  artistIds: ids, excludeArtistIds: ids, excludeTrackIds: ids,
  albumIds: ids, yearFrom: z.number().int().min(1800).max(2200).nullable().default(null),
  yearUntil: z.number().int().min(1800).max(2200).nullable().default(null),
  seedArtistId: id.nullable().default(null),
}).strict().superRefine((v,ctx) => {
  if (v.requiredLabels.some(x => v.excludedLabels.includes(x)) || v.artistIds.some(x => v.excludeArtistIds.includes(x))) {
    ctx.addIssue({ code: "custom", message: "Restricciones contradictorias" });
  }
  if (v.requiredLabels.filter(x => x.startsWith("energy-")).length > 1 ||
      (v.yearFrom !== null && v.yearUntil !== null && v.yearFrom > v.yearUntil)) {
    ctx.addIssue({ code: "custom", message: "Energía o ventana temporal contradictorias" });
  }
});
export type RecommendationIntent = z.infer<typeof recommendationIntentSchema>;
export const recommendationRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000).optional(),
  intent: recommendationIntentSchema.optional(),
  limit: z.number().int().min(1).max(20).default(10),
  maxPerArtist: z.number().int().min(1).max(5).default(2),
  useFeedbackFrom: z.array(z.string().uuid()).max(20).default([]),
}).strict().refine(v => Boolean(v.text) !== Boolean(v.intent), "Proporcionar text o intent, exactamente uno");
export type RecommendationRequest = z.infer<typeof recommendationRequestSchema>;
export const feedbackSchema = z.object({
  requestId: z.string().uuid(), key: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/),
  trackId: id.nullable().default(null), verdict: z.enum(["relevant", "irrelevant", "skip"]),
  reason: z.string().trim().min(1).max(2000),
}).strict();
export const versionBatchSchema = z.object({
  reviewer: z.string().trim().min(1).max(100), note: z.string().trim().min(1).max(2000),
  versions: z.array(z.object({
    key: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/), group: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/),
    trackId: id, expectedTitle: z.string().min(1), expectedAlbumId: id, evidenceId: id,
    state: z.enum(["approved", "rejected", "withdrawn"]), reason: z.string().trim().min(1).max(2000),
  }).strict()).min(1).max(500),
}).strict();
