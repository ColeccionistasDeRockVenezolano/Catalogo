import { z } from "zod";
const text = z.string().trim().min(1).max(4000);
const key = z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/);
const id = z.number().int().positive().safe();
const level = z.enum(["low", "medium", "high"]);
export const energyObservationSchema = z.object({
  activity: level, dynamics: level, density: level,
  basis: z.enum(["authorized-listening", "reviewed-description"]),
  reference: text, rightsBasis: text, observations: text,
}).strict();
/** Median of three documented ordinal judgements; not BPM, loudness or popularity. */
export function energyLabel(data: z.infer<typeof energyObservationSchema>): string {
  const levels = ["low", "medium", "high"];
  const values = [data.activity, data.dynamics, data.density].map(x => levels.indexOf(x)).sort((a,b) => a-b);
  return `energy-${levels[values[1]!]}`;
}
const annotation = z.object({
  key, trackId: id, expectedTitle: text, expectedAlbumId: id,
  label: z.string().regex(/^[a-z-]+$/), evidenceId: id.nullable(), confidence: level,
  methodVersion: z.enum(["context-editorial-v1", "perceived-energy-v1"]),
  methodData: energyObservationSchema.nullable().default(null),
}).strict();
function validateMethod(a: z.infer<typeof annotation>, ctx: z.RefinementCtx) {
  if (a.label.startsWith("energy-")) {
    if (a.methodVersion !== "perceived-energy-v1" || !a.methodData || energyLabel(a.methodData) !== a.label || !a.evidenceId) {
      ctx.addIssue({ code: "custom", message: "Energía requiere evidencia, perceived-energy-v1 y etiqueta igual a la mediana de los tres ejes" });
    }
  } else if (a.methodVersion !== "context-editorial-v1" || a.methodData !== null) {
    ctx.addIssue({ code: "custom", message: "Contextos/ánimos requieren context-editorial-v1, sin observaciones de energía" });
  }
}
export const trackContextProposalSchema = annotation.extend({
  origin: z.enum(["human", "algorithm"]), proposer: text,
  modelName: text.nullable(), modelVersion: text.nullable(), generatedAt: z.string().datetime({ offset: true }), rationale: text,
}).strict().superRefine((a,ctx) => {
  validateMethod(a,ctx);
  if (a.origin === "algorithm" ? !a.modelName || !a.modelVersion : a.modelName !== null || a.modelVersion !== null) {
    ctx.addIssue({ code: "custom", message: "Propuestas algorítmicas requieren nombre y versión del modelo; humanas no los admiten" });
  }
  if (a.origin === "algorithm" && a.label.startsWith("energy-")) {
    ctx.addIssue({ code: "custom", message: "perceived-energy-v1 es una metodología de revisión humana" });
  }
});
export const trackContextDecisionSchema = annotation.extend({
  proposalKey: key.nullable(), state: z.enum(["approved", "rejected", "withdrawn"]), reason: text,
  validFrom: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((a,ctx) => {
  validateMethod(a,ctx);
  if (a.state === "approved" && !a.evidenceId) ctx.addIssue({ code: "custom", message: "Aprobación sin evidencia específica de la pista" });
  if (a.validUntil && Date.parse(a.validUntil) <= Date.parse(a.validFrom)) ctx.addIssue({ code: "custom", message: "Ventana temporal inválida" });
});
export const trackContextBatchSchema = z.object({
  batch: key, reviewer: text, note: text,
  proposals: z.array(trackContextProposalSchema).max(500).default([]),
  decisions: z.array(trackContextDecisionSchema).max(500).default([]),
  evaluations: z.array(z.object({ key, assignmentKey: key, verdict: z.enum(["relevant", "irrelevant", "uncertain"]), reason: text }).strict()).max(500).default([]),
}).strict();
export type TrackContextBatch = z.infer<typeof trackContextBatchSchema>;
