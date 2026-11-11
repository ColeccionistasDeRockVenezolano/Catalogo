import type { Canonical } from "./compiler.js";

/**
 * Modo «solo si coinciden» (criteria 1.10.0 · gatedAgreementMode).
 *
 * El plan del estudiante se responde solo si el plan de la 1.8.0 (segmentador → preguntas de Laya por tramo → compilador,
 * con nombres externos) es el mismo. Sin acuerdo no se ejecuta nada: el plan queda «unsupported» con al menos un pendiente
 * (el sistema declara que no resolvió la consulta entera, en vez de decir que no la reconoce).
 * Es la misma lógica de scripts/stage3/combine.py, que fue la que se midió en la prueba reservada.
 */
export const GATED_MODE_VERSION = "crv-query-gated-1.10.0";

/** Forma canónica para comparar: sin la clase de entidad (el oro no siempre la fija) y con el pendiente reducido a «hay / no hay». */
export function agreementKey(c: Canonical): string {
  const sorted = (xs: readonly string[] | undefined) => [...(xs ?? [])].sort();
  const any = (c.any ?? []).filter(Array.isArray).map(g => sorted(g)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const ent = (c.ent ?? []).map(e => [e.literal.toLowerCase().trim(), e.role ?? "target"]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([c.status, sorted(c.req), sorted(c.exc), sorted(c.pref), any, sorted(c.alts), ent, Number(c.ctx ?? 0), (c.pending ?? 0) > 0 ? 1 : 0]);
}

export function abstain(c: Canonical, other?: Canonical | null): Canonical {
  return { ...c, status: "unsupported", req: [], exc: [], pref: [], any: [], alts: [], ent: [], pending: Math.max(1, c.pending ?? 0, other?.pending ?? 0) };
}

export interface GatedOutcome { answered: boolean; plan: Canonical; reason: "agreement" | "disagreement" | "no_legacy" | "no_student" }

export function gate(student: Canonical | null | undefined, legacy: Canonical | null | undefined): GatedOutcome {
  if (!student) {
    // Sin estudiante no hay nada que responder: se conserva la declaración de pendiente de la 1.8.0 o, si tampoco hay, un plan vacío no resuelto.
    const base = legacy ?? { status: "unsupported", req: [], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 1, alts: [], facets: [] } satisfies Canonical;
    return { answered: false, plan: abstain(base, legacy), reason: "no_student" };
  }
  if (!legacy) return { answered: false, plan: abstain(student), reason: "no_legacy" };
  if (agreementKey(student) === agreementKey(legacy)) return { answered: true, plan: student, reason: "agreement" };
  return { answered: false, plan: abstain(student, legacy), reason: "disagreement" };
}
