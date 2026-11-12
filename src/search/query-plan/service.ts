import { gatedConfig, interpretShared, type GatedResult } from "../query-interpretation/gated-service.js";
import { isLayaActive } from "../laya-models.js";
import { GATED_MODE_VERSION } from "../query-interpretation/gated.js";
import { executeStructured, parseStructuredPlan, planMode, type PlanRefusal, type StructuredPlan, type StructuredResult } from "./structured.js";

/** Id con el que quedó activado el modo «solo si coinciden» en el registro de modelos. */
export const GATED_MODEL_ID = GATED_MODE_VERSION;

export type PlanDecision =
  | { servable: false; reason: string }
  | { servable: true; plan: StructuredPlan };

/** Decide, sin tocar la base, si el plan responde esta consulta: acuerdo de los dos sistemas + solo género/década. */
export function decide(r: GatedResult | null): PlanDecision {
  if (!r) return { servable: false, reason: "no_interpretation" };
  if (!r.outcome.answered) return { servable: false, reason: `abstain:${r.outcome.reason}` };
  const parsed = parseStructuredPlan(r.outcome.plan);
  return "refusal" in parsed ? { servable: false, reason: `refused:${parsed.refusal}` } : { servable: true, plan: parsed.plan };
}

export type PlanOutcome = { applied: false; reason: string } | { applied: true; result: StructuredResult };

/** Camino de /search/plan: interpreta (compartido con la anotación), decide y ejecuta. Nunca lanza. */
export async function structuredFor(q: string, limit: number, mode = planMode()): Promise<PlanOutcome> {
  try {
    if (mode !== "on") return { applied: false, reason: "disabled" };
    const cfg = gatedConfig();
    if (!cfg || !(await isLayaActive("query_interpretation", GATED_MODEL_ID))) return { applied: false, reason: "not_active" };
    const d = decide(await interpretShared(q, cfg));
    if (!d.servable) return { applied: false, reason: d.reason };
    const out = await executeStructured(d.plan, limit);
    return "refusal" in out ? { applied: false, reason: `refused:${out.refusal satisfies PlanRefusal}` } : { applied: true, result: out };
  } catch {
    return { applied: false, reason: "error" };
  }
}
