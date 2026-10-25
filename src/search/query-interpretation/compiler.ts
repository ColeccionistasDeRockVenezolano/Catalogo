import { INTENTION_VERSION, intentionSchema, type SearchIntention } from "../contracts.js";
import type { QueryLexicon } from "./lexicon.js";
import type { CatalogMatch, Segmentation, Span } from "./segmenter.js";
import { DESCRIBE_KEY, NOT_REQUESTED, OTHER, UNCLEAR, type Dimension, type QuestionTask } from "./questions.js";

export const COMPILER_VERSION = "crv-query-compiler-0.1.0";
export interface Answer { choice: string; probabilities: Record<string, number> }
export type Answers = Record<string, Answer>;
/** Umbral de confianza calibrada por familia de pregunta; por debajo se pregunta o se conserva pendiente. */
/** `filler` es la confianza mínima para descartar un residuo como relleno; por debajo queda pendiente. */
export type Thresholds = Partial<Record<QuestionTask["family"] | "filler", number>>;
export const DEFAULT_THRESHOLDS: Required<Thresholds> = { span: 0.5, dim: 0.5, pick: 0.5, genre_description: 0.2, facet_family: 0.4, query_kind: 0.6, filler: 0.5 };

export type QueryStatus = "query_valid" | "partial" | "entity_lookup" | "clarify" | "unsupported" | "contradiction" | "unrecognized";
export interface Canonical {
  status: QueryStatus; req: string[]; exc: string[]; any: string[][]; pref: string[]; ctx: number;
  ent: { role: "target" | "reference"; kind: string | null; literal: string }[]; pending: number; alts: string[]; facets: string[];
}
export interface Interpretation {
  version: typeof COMPILER_VERSION; status: QueryStatus; intention: SearchIntention; canonical: Canonical;
  contextOnly: string[]; alternatives: string[]; describedGenres: string[];
  trace: { span: string; text: string; decision: string; confidence: number | null; outcome: string }[];
}

interface Cond { concept: string; text: string; mode: Span["mode"]; group: string | null; scope: string }
const axisOf = (id: string) => id.split(":")[0]!;

function top(a: Answer | undefined): [string, number] {
  if (!a) return [UNCLEAR, 0];
  return [a.choice, a.probabilities[a.choice] ?? 0];
}
function ranked(a: Answer | undefined, exclude: string[] = []): string[] {
  return a ? Object.entries(a.probabilities).filter(([k]) => !exclude.includes(k)).sort((x, y) => y[1] - x[1]).map(([k]) => k) : [];
}

export const DESCRIBED_LEXICAL_PRIOR = 0.3;

export function compileInterpretation(seg: Segmentation, answers: Answers, lexicon: QueryLexicon, thresholds: Thresholds = {}): Interpretation {
  let describedWithoutGenre = 0, facetPending = 0;
  const describedSpans: Span[] = [];
  const thr = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const conds: Cond[] = [], pending: { text: string; reason: string }[] = [], trace: Interpretation["trace"] = [];
  const clarify: string[] = [], described: string[] = [], facets: string[] = [], contextOnly: string[] = [];
  const entities: Canonical["ent"] = [], intentionEntities: SearchIntention["entities"] = [];
  let needClarify = false, ignoredFiller = 0;
  const addEntity = (role: "target" | "reference", hint: CatalogMatch["kind"] | null, literal: string, matches: CatalogMatch[]) => {
    const kinds = [...new Set(matches.map(x => x.kind))];
    // Una referencia de parecido apunta al artista cuando el catálogo lo tiene como tal.
    const kind = hint ?? (kinds.length === 1 ? kinds[0]! : role === "reference" && kinds.includes("artist") ? "artist" : null);
    const same = matches.filter(x => !kind || x.kind === kind);
    entities.push({ role, kind, literal: normalizeLiteral(literal) });
    intentionEntities.push({ role, kind: (kind ?? "artist") as SearchIntention["entities"][number]["kind"], id: same.length === 1 ? same[0]!.id : null, name: literal,
      resolution: same.length === 1 ? "resolved" : same.length > 1 ? "ambiguous" : "absent" });
  };

  if (seg.structure.parentheses) { needClarify = true; trace.push({ span: "-", text: seg.text, decision: "structure", confidence: null, outcome: "dnf_not_representable" }); }
  if (seg.structure.orAndMixed) { needClarify = true; trace.push({ span: "-", text: seg.text, decision: "structure", confidence: null, outcome: "and_or_scope_ambiguous" }); }

  for (const span of seg.spans) {
    if (span.kind === "listener") { contextOnly.push(span.text); continue; }
    if (span.kind === "entity" && span.entity) { addEntity("target", span.entity.kindHint, span.entity.literal, span.entity.matches); continue; }
    if (span.kind === "similarity" && span.entity) {
      addEntity("reference", span.entity.kindHint, span.entity.literal, span.entity.matches);
      conds.push({ concept: `similarity:${span.aspect ?? "overall"}`, text: span.text, mode: span.mode, group: span.group, scope: "track" });
      continue;
    }
    if (span.kind === "comparative") { pending.push({ text: span.text, reason: "comparative_not_representable" }); continue; }
    if (span.kind === "decade") { conds.push({ concept: span.candidates[0]!, text: span.text, mode: span.mode, group: span.group, scope: "album" }); continue; }
    if (span.attenuated) { pending.push({ text: span.text, reason: "attenuated_degree_not_representable" }); continue; }
    if (span.kind === "residual") { compileResidual(span); continue; }
    const [choice, p] = top(answers[`span:${span.id}`]);
    trace.push({ span: span.id, text: span.text, decision: choice, confidence: p, outcome: "" });
    const t = trace.at(-1)!;
    if (choice === NOT_REQUESTED && p >= thr.span) { t.outcome = "not_requested"; continue; }
    if (choice === UNCLEAR || choice === NOT_REQUESTED || p < thr.span) {
      if (span.candidates.length > 1 || span.kind === "ambiguous") { needClarify = true; clarify.push(...ranked(answers[`span:${span.id}`], [NOT_REQUESTED, UNCLEAR]).filter(x => span.candidates.includes(x))); t.outcome = "clarify"; }
      else { pending.push({ text: span.text, reason: "low_confidence" }); t.outcome = "pending"; }
      continue;
    }
    if (choice.startsWith("candidate:")) { facets.push(choice); pending.push({ text: span.text, reason: `facet_candidate:${choice}` }); t.outcome = "facet"; continue; }
    conds.push({ concept: choice, text: span.text, mode: span.mode, group: span.group, scope: scopeOf(choice) }); t.outcome = "condition";
  }

  function compileResidual(span: Span) {
    const [dim, p] = top(answers[`dim:${span.id}`]);
    const t = { span: span.id, text: span.text, decision: dim, confidence: p, outcome: "" };
    trace.push(t);
    if (span.cue === "origin") { pending.push({ text: span.text, reason: "origin_not_representable" }); t.decision = "origin"; t.outcome = "pending"; return; }
    if (p < thr.dim) { pending.push({ text: span.text, reason: "residual_low_confidence" }); t.outcome = "pending"; return; }
    const d = dim as Dimension;
    // Lo negado nunca es relleno: descartarlo perdería una exclusión pedida.
    if (d === "filler" && p >= thr.filler && span.mode !== "excluded") { t.outcome = "ignored"; ignoredFiller++; return; }
    if (d === "filler") { pending.push({ text: span.text, reason: span.mode === "excluded" ? "excluded_restriction_not_representable" : "residual_low_confidence" }); t.outcome = "pending"; return; }
    if (d === "catalog_name") { pending.push({ text: span.text, reason: "unresolved_name" }); t.outcome = "pending"; return; }
    if (d === "unsupported") { pending.push({ text: span.text, reason: "unsupported_restriction" }); t.outcome = "pending"; return; }
    if (d === "technical_facet") {
      const [f, fp] = top(answers[`pick:${span.id}:facet`]);
      if (f !== OTHER && fp >= thr.facet_family) facets.push(f);
      pending.push({ text: span.text, reason: f !== OTHER && fp >= thr.facet_family ? `facet_candidate:${f}` : "technical_facet" }); facetPending++; t.outcome = "facet"; return;
    }
    if (d === "genre_description") { describedSpans.push(span); t.outcome = "described"; return; }
    const [c, cp] = top(answers[`pick:${span.id}:${d}`]);
    if (c === OTHER || cp < thr.pick) { pending.push({ text: span.text, reason: c === OTHER ? "concept_not_in_vocabulary" : "pick_low_confidence" }); t.outcome = "pending"; return; }
    conds.push({ concept: c, text: span.text, mode: span.mode, group: span.group, scope: scopeOf(c) }); t.outcome = "condition";
  }

  if (describedSpans.length) {
    // Orden de las alternativas: probabilidad de Laya más un previo por el orden léxico del mapa de
    // géneros (las opciones llegan ordenadas por coincidencia de rasgos). λ=0,3 elegido en validación.
    const a = answers[DESCRIBE_KEY];
    const keys = Object.keys(a?.probabilities ?? {}).filter(k => k !== OTHER);
    const score = (k: string) => (a!.probabilities[k] ?? 0) + DESCRIBED_LEXICAL_PRIOR / (keys.indexOf(k) + 1);
    const options = [...keys].sort((x, y) => score(y) - score(x)).slice(0, 3);
    if (options.length && (a?.probabilities[OTHER] ?? 0) < 1 - thr.genre_description) described.push(...options);
    else { pending.push({ text: describedSpans.map(s => s.text).join(" · "), reason: "described_traits_without_genre" }); describedWithoutGenre++; }
  }

  // Consulta que coincide entera con una ficha y además contiene posibles conceptos.
  let wholeAsEntity = false;
  if (seg.wholeQueryMatches.length) {
    const conditionLike = conds.length + clarify.length + pending.length > 0;
    if (!conditionLike && !needClarify) wholeAsEntity = true;
    else {
      const [k, kp] = top(answers["kind"]);
      if (k === "catalog_lookup" && kp >= thr.query_kind) wholeAsEntity = true;
      else if (!(k === "music_request" && kp >= thr.query_kind)) { needClarify = true; clarify.push(...conds.map(c => c.concept)); }
    }
    if (wholeAsEntity) {
      conds.length = 0; pending.length = 0; clarify.length = 0; needClarify = false;
      addEntity("target", null, seg.text.trim(), seg.wholeQueryMatches);
    } else if (needClarify) entities.push({ role: "target", kind: null, literal: normalizeLiteral(seg.text) });
  }

  // Duplicados exactos (mismo concepto y modo) se funden; los grupos O de un solo miembro se disuelven.
  const unique: Cond[] = [];
  for (const c of conds) if (!unique.some(u => u.concept === c.concept && u.mode === c.mode && u.group === c.group)) unique.push(c);
  const groupSizes = new Map<string, number>();
  for (const c of unique) if (c.group) groupSizes.set(c.group, (groupSizes.get(c.group) ?? 0) + 1);
  for (const c of unique) if (c.group && groupSizes.get(c.group)! < 2) c.group = null;

  const required = unique.filter(c => c.mode === "required" && !c.group).map(c => c.concept);
  const excluded = unique.filter(c => c.mode === "excluded").map(c => c.concept);
  const energies = required.filter(c => c.startsWith("energy:"));
  const contradiction = required.some(c => excluded.includes(c)) || new Set(energies).size > 1;

  let status: QueryStatus;
  if (contradiction) status = "contradiction";
  else if (needClarify) status = "clarify";
  // Una descripción de sonido sin condiciones se aclara con la persona, aunque no haya género candidato.
  else if ((described.length || describedWithoutGenre) && !unique.length && pending.length === describedWithoutGenre + facetPending) status = "clarify";
  else if (!unique.length && entities.some(e => e.role === "target")) status = "entity_lookup";
  else if (unique.length) status = pending.length ? "partial" : "query_valid";
  else if (pending.length) status = "unsupported";
  else status = "unrecognized";
  if (status === "query_valid" && described.length) status = "partial";

  const anyGroups = [...new Set(unique.filter(c => c.group).map(c => c.group!))].map(g => unique.filter(c => c.group === g).map(c => c.concept).sort());
  const alternatives = [...new Set([...clarify, ...described])];
  const canonical: Canonical = {
    status, req: [...new Set(required)].sort(), exc: [...new Set(excluded)].sort(), any: anyGroups.sort(),
    pref: [...new Set(unique.filter(c => c.mode === "preferred").map(c => c.concept))].sort(),
    ctx: contextOnly.length, ent: entities, pending: pending.length, alts: alternatives, facets: [...new Set(facets)],
  };
  void ignoredFiller;
  const intention = intentionSchema.parse({
    version: INTENTION_VERSION, engine: "laya",
    capabilities: [...new Set([
      ...(entities.some(e => e.role === "target") ? ["direct"] : []),
      ...(unique.some(c => ["emotion", "energy", "atmosphere"].includes(axisOf(c.concept))) ? ["emotional"] : []),
      ...(unique.some(c => ["activity", "theme", "genre", "similarity", "decade"].includes(axisOf(c.concept))) ? ["contextual"] : []),
    ])],
    interpretation: ({ query_valid: "identified", entity_lookup: "identified", partial: "partial", clarify: "ambiguous", contradiction: "ambiguous", unsupported: "out_of_scope", unrecognized: "unrecognized" } as const)[status],
    entities: intentionEntities,
    conditions: status === "query_valid" || status === "partial" ? unique.map((c, i) => {
      const axis = axisOf(c.concept);
      const isAxis = ["genre", "activity", "emotion", "energy", "atmosphere", "theme"].includes(axis);
      return { id: `C${i + 1}`, axis: isAxis ? axis : null, facet: isAxis ? null : axis, value: c.concept.slice(axis.length + 1), sourceText: c.text,
        scope: c.scope, mode: c.mode, alternativeGroup: c.group, status: "recognized" as const };
    }) : [],
    pending: status === "query_valid" || status === "entity_lookup" ? [] : pending.length ? pending : [{ text: seg.text, reason: status }],
  });
  return { version: COMPILER_VERSION, status, intention, canonical, contextOnly, alternatives, describedGenres: described, trace };

  function scopeOf(concept: string) { return axisOf(concept) === "decade" ? "album" : "track"; }
}

export function normalizeLiteral(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[«»"“”]/gu, "").replace(/\s+/gu, " ").trim();
}
