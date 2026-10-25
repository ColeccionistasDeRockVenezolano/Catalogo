import { detectEmotionIntent } from "../../api/repositories/emotions.js";
import { explicitRequestSpans } from "../../discovery/recommendation-interpreter.js";
import type { Answers, Canonical } from "./compiler.js";
import { NOT_REQUESTED, UNCLEAR, type QuestionTask } from "./questions.js";
import type { Segmentation } from "./segmenter.js";

/** Reglas nuevas sin modelo: el léxico decide solo si hay un único candidato o una señal temática. */
export function rulesAnswers(seg: Segmentation, tasks: QuestionTask[]): Answers {
  const out: Answers = {};
  const one = (choice: string, keys: string[]) => ({ choice, probabilities: Object.fromEntries(keys.map(k => [k, k === choice ? 1 : 0])) });
  for (const t of tasks) {
    const keys = Object.keys(t.question.criteria);
    const span = seg.spans.find(s => s.id === t.spanId);
    if (t.family === "span" && span) {
      const themed = span.cue === "theme" ? span.candidates.filter(c => c.startsWith("theme:")) : [];
      const activity = span.cue === "activity" ? span.candidates.filter(c => c.startsWith("activity:")) : [];
      const pick = span.candidates.length === 1 ? span.candidates[0]! : themed.length === 1 ? themed[0]! : activity.length === 1 ? activity[0]! : UNCLEAR;
      out[t.key] = one(pick, keys);
    } else if (t.family === "dim") out[t.key] = one(keys.includes("unsupported") ? "unsupported" : keys[0]!, keys);
    else if (t.family === "query_kind") out[t.key] = one(UNCLEAR, keys);
    else out[t.key] = one(keys.includes("other") ? "other" : keys[0]!, keys);
  }
  void NOT_REQUESTED;
  return out;
}

/**
 * Híbrido: un fragmento del léxico con un único significado posible (o con señal temática o de
 * actividad que lo decide) se resuelve por reglas; Laya decide todo lo demás (ambigüedades,
 * restos, tipo de consulta). Laya solo se consulta donde hay una elección real.
 */
export function hybridAnswers(seg: Segmentation, tasks: QuestionTask[], laya: Answers): Answers {
  const rules = rulesAnswers(seg, tasks);
  const out: Answers = {};
  for (const t of tasks) {
    const span = seg.spans.find(s => s.id === t.spanId);
    const ruled = t.family === "span" && span && span.kind !== "ambiguous" && rules[t.key]!.choice !== UNCLEAR;
    out[t.key] = ruled ? rules[t.key]! : laya[t.key]!;
  }
  return out;
}

/** Correspondencia heredada → conceptos (legacyCrosswalk del diccionario 0.1.0). */
const LEGACY: Record<string, string[]> = {
  emocion: ["emotion:romantic", "theme:love"],
  tristeza: ["emotion:sad", "emotion:melancholic", "emotion:nostalgic", "theme:death", "theme:breakup"],
  enfocado: ["activity:concentration", "activity:relaxation", "activity:sleep", "activity:meditation", "activity:exercise", "emotion:serene"],
  libertad: ["emotion:rebellious", "activity:travel"],
  cachonda: ["activity:intimacy", "emotion:sensual", "theme:sexuality"],
  aumenta_mi_aura: ["emotion:confident", "atmosphere:epic", "energy:energy-high", "activity:celebration", "activity:dancing"],
};
const PATTERN: Record<string, string> = {
  concentration: "activity:concentration", relaxation: "activity:relaxation", celebration: "activity:celebration",
  joyful: "emotion:joyful", melancholic: "emotion:melancholic", tense: "emotion:tense", serene: "emotion:serene",
  "energy-low": "energy:energy-low", "energy-medium": "energy:energy-medium", "energy-high": "energy:energy-high",
};

/**
 * Lógica heredada con interpretación generosa: los patrones de recomendaciones dan conceptos
 * exactos; si no, la emoción heredada se cuenta como acierto cuando la etiqueta tiene un solo
 * concepto dentro de su correspondencia. Sin coincidencia, la búsqueda directa sigue: se trata
 * como búsqueda de entidad si la consulta no pide nada y como no reconocida en otro caso.
 */
export function legacyCanonical(text: string, gold?: { req: string[]; status: string; ent: Canonical["ent"] }): Canonical {
  const empty: Canonical = { status: "unrecognized", req: [], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 0, alts: [], facets: [] };
  const spans = explicitRequestSpans(text);
  if (spans) {
    const req: string[] = [], exc: string[] = [];
    for (const s of spans) for (const label of Object.values(s.groups)) { const c = PATTERN[label!]; if (c) (s.excluded ? exc : req).push(c); }
    return { ...empty, status: "query_valid", req: [...new Set(req)].sort(), exc: [...new Set(exc)].sort() };
  }
  const emotion = detectEmotionIntent(text);
  if (emotion) {
    const candidates = LEGACY[emotion] ?? [];
    const req = gold && gold.req.length === 1 && candidates.includes(gold.req[0]!) ? gold.req : [candidates[0]!];
    return { ...empty, status: "query_valid", req };
  }
  if (gold?.status === "entity_lookup") return { ...empty, status: "entity_lookup", ent: gold.ent };
  return empty;
}
