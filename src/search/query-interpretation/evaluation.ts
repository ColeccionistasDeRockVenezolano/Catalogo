import type { Canonical, QueryStatus } from "./compiler.js";

/** Etiqueta de un caso de consulta (formato de los conjuntos de la etapa 3). */
export interface QueryGold {
  status: QueryStatus; req: string[]; exc: string[]; any: string[][]; pref: string[]; ctx: number;
  ent: { role: "target" | "reference"; kind: string | null; literal: string }[]; pending: number; alts: string[]; facet: string | null;
}
export interface QueryCase { id: string; category: string; text: string; gold: QueryGold; split?: string; family?: string }

const eqSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const groupsKey = (g: string[][]) => g.map(x => [...x].sort().join("|")).sort().join("||");

export interface CaseResult {
  id: string; category: string; exact: boolean; critical: string[]; overAbstained: boolean; pendingPreserved: boolean | null;
  describedHit: boolean | null; facetHit: boolean | null; reasons: string[];
}

export function compareCase(c: QueryCase, p: Canonical): CaseResult {
  const g = c.gold, reasons: string[] = [];
  if (p.status !== g.status) reasons.push(`status:${p.status}≠${g.status}`);
  const structural = ["query_valid", "partial", "entity_lookup"].includes(g.status);
  if (structural) {
    if (!eqSet(p.req, g.req)) reasons.push(`req:${p.req.join(",")}≠${g.req.join(",")}`);
    if (!eqSet(p.exc, g.exc)) reasons.push(`exc:${p.exc.join(",")}≠${g.exc.join(",")}`);
    if (groupsKey(p.any) !== groupsKey(g.any)) reasons.push("any");
    if (!eqSet(p.pref, g.pref)) reasons.push(`pref:${p.pref.join(",")}≠${g.pref.join(",")}`);
    if (p.ctx !== g.ctx) reasons.push(`ctx:${p.ctx}≠${g.ctx}`);
    if ((p.pending > 0) !== (g.pending > 0)) reasons.push(`pending:${p.pending}≠${g.pending}`);
    const entOk = g.ent.length === p.ent.length && g.ent.every(e => p.ent.some(x => x.role === e.role && x.literal === e.literal && (!e.kind || x.kind === e.kind)));
    if (!entOk) reasons.push(`ent:${p.ent.map(e => `${e.role}/${e.kind}/${e.literal}`).join(",")}`);
  }
  let describedHit: boolean | null = null;
  if (g.status === "clarify" && g.alts.length) {
    const hit = p.alts.slice(0, 3).some(a => g.alts.includes(a));
    if (c.category === "described") describedHit = hit;
    if (!hit) reasons.push(`alts:${p.alts.slice(0, 3).join(",")}`);
  }
  if (g.status === "clarify" && g.ctx && p.ctx !== g.ctx) reasons.push("ctx");
  const facetHit = g.facet ? p.facets.includes(g.facet) : null;
  if (g.facet && !facetHit) reasons.push(`facet:${p.facets.join(",")}`);

  // Errores críticos (criterios congelados).
  const critical: string[] = [];
  const predPositive = [...p.req, ...p.pref, ...p.any.flat()];
  if (g.exc.some(x => predPositive.includes(x)) || g.req.some(x => p.exc.includes(x))) critical.push("polarity_inverted");
  if (g.pending > 0 && p.status === "query_valid") critical.push("restriction_dropped");
  if (g.ctx > 0) { const allowed = new Set([...g.req, ...g.pref, ...g.any.flat()]); if (p.req.some(x => !allowed.has(x))) critical.push("listener_state_as_filter"); }
  if (g.status === "entity_lookup" && (p.req.length || p.exc.length || p.any.length || p.pref.length)) critical.push("title_as_concept");
  if (g.pref.some(x => p.req.includes(x))) critical.push("preference_as_requirement");
  if (g.status === "contradiction" && ["query_valid", "partial"].includes(p.status)) critical.push("contradiction_executed");
  const overAbstained = g.status === "query_valid" && ["clarify", "unsupported", "unrecognized"].includes(p.status);
  const pendingPreserved = g.pending > 0 ? p.pending > 0 && p.status !== "query_valid" : null;
  return { id: c.id, category: c.category, exact: reasons.length === 0, critical, overAbstained, pendingPreserved, describedHit, facetHit, reasons };
}

/** Condiciones con su modo, para micro-F1 (las de grupos O cuentan como exigidas en grupo). */
function conditionKeys(x: { req: string[]; exc: string[]; any: string[][]; pref: string[] }) {
  return [...x.req.map(v => `req:${v}`), ...x.exc.map(v => `exc:${v}`), ...x.pref.map(v => `pref:${v}`), ...x.any.flat().map(v => `any:${v}`)];
}

export function aggregate(cases: QueryCase[], preds: Canonical[], adversarial = ["negation", "listener", "entity", "clarify", "contradiction", "unsupported", "mandatory"]) {
  const results = cases.map((c, i) => compareCase(c, preds[i]!));
  let tp = 0, fp = 0, fn = 0;
  cases.forEach((c, i) => {
    if (!["query_valid", "partial"].includes(c.gold.status) && !["query_valid", "partial"].includes(preds[i]!.status)) return;
    const g = new Set(conditionKeys(c.gold)), p = new Set(conditionKeys(preds[i]!));
    for (const k of p) { if (g.has(k)) tp++; else fp++; }
    for (const k of g) if (!p.has(k)) fn++;
  });
  const rate = (xs: boolean[]) => xs.length ? xs.filter(Boolean).length / xs.length : null;
  const adv = results.filter(r => adversarial.includes(r.category));
  const byCategory: Record<string, { n: number; exact: number }> = {};
  for (const r of results) { const b = byCategory[r.category] ??= { n: 0, exact: 0 }; b.n++; if (r.exact) b.exact++; }
  const valid = results.filter((r, i) => cases[i]!.gold.status === "query_valid");
  return {
    n: results.length,
    exactPlanAccuracy: rate(results.map(r => r.exact)),
    exactPlanAccuracyAdversarial: rate(adv.map(r => r.exact)),
    criticalErrorRate: rate(results.map(r => r.critical.length > 0)),
    // Respuesta equivocada sin abstenerse: todas sus decisiones superaron los umbrales calibrados.
    overconfidence: rate(results.map((r, i) => !r.exact && ["query_valid", "partial", "entity_lookup"].includes(preds[i]!.status))),
    criticalCases: results.filter(r => r.critical.length).map(r => ({ id: r.id, critical: r.critical })),
    unsupportedPreservation: rate(results.filter(r => r.pendingPreserved !== null).map(r => r.pendingPreserved!)),
    overAbstention: rate(valid.map(r => r.overAbstained)),
    conditionF1: tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : null,
    describedGenreRecallAt3: rate(results.filter(r => r.describedHit !== null).map(r => r.describedHit!)),
    facetFamilyRecall: rate(results.filter(r => r.facetHit !== null).map(r => r.facetHit!)),
    byCategory, results,
  };
}

/** No invención en tráfico real: toda condición predicha debe estar permitida. */
export function noInvention(allowed: string[], p: Canonical): boolean {
  return [...p.req, ...p.exc, ...p.pref, ...p.any.flat()].every(x => allowed.includes(x));
}
