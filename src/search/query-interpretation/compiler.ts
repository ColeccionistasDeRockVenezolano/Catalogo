import { INTENTION_VERSION, intentionSchema, type SearchIntention } from "../contracts.js";
import { normalizeQueryText, type QueryLexicon } from "./lexicon.js";
import { bareName, catalogKey, type CatalogMatch, type Segmentation, type Span } from "./segmenter.js";
import { loadDictionary, nameRuns, type ExternalHit } from "./external-names.js";
import { DESCRIBE_KEY, isSoundOnly, NOT_REQUESTED, OTHER, UNCLEAR, type Dimension, type QuestionTask } from "./questions.js";

export const COMPILER_VERSION = "crv-query-compiler-0.2.0";
export interface Answer { choice: string; probabilities: Record<string, number> }
export type Answers = Record<string, Answer>;
/** Umbral de confianza calibrada por familia de pregunta; por debajo se pregunta o se conserva pendiente. */
/** `filler` es la confianza mínima para descartar un residuo como relleno; por debajo queda pendiente. */
/** `residual` es la confianza conjunta mínima (dimensión × concepto) para que un residuo sea condición;
 * `fillerAfterCue` la de descartar como relleno lo que sigue a «para» («para la piscina»). */
export type Thresholds = Partial<Record<QuestionTask["family"] | "filler" | "fillerAfterCue" | "residual" | "convention", number>>;
/** convention = 1: reglas de la convención escrita de 1.8.0 (relleno cerrado, «suave» acompañado, género + nombre); 0: ≤ 1.7.0. */
export const DEFAULT_THRESHOLDS: Required<Thresholds> = { span: 0.5, dim: 0.5, pick: 0.5, genre_description: 0.2, facet_family: 0.4, query_kind: 0.6, filler: 0.5, fillerAfterCue: 0.5, residual: 0, convention: 0 };

// 1.8.0 · relleno de la convención escrita (docs/unified-search/stage3/query-label-convention.md §4).
// Solo esto es relleno; cualquier otro resto que acota queda pendiente.
const CLOSED_FILLER = new Set([
  "musica", "canciones", "cancion", "temas", "tema", "playlist", "lista", "listas", "rolas", "algo", "quiero", "busco", "ponme", "pon", "dame",
  "recomiendame", "recomienda", "escuchar", "para escuchar", "quiero escuchar", "oir", "un poco de", "un poco", "songs", "music", "tracks",
  "mix", "mixes", "enganchados", "enganchado", "mixtas", "mixtos",
  "que es", "q es", "es", "que significa", "significa", "significado", "rym", "wiki", "wikipedia", "o que e", "o que es",
  "videos", "video", "audio",
  "youtube", "spotify", "wattpad", "bandcamp", "soundcloud", "google",
  "chida", "chido", "bonita", "bonitas", "bonito", "bonitos", "buena", "buenas", "bueno", "buenos", "bien", "hermosa", "hermosas", "hermoso",
  "linda", "lindas", "lindo", "muy", "full", "super", "tipo", "tipos",
]);
/** Formas del diccionario que puede tener una palabra flexionada: plural, femenino y verbo conjugado
 * («éxitos», «positivas», «significa», «explota»); los diccionarios solo traen la forma base. */
export function dictionaryForms(w: string): string[] {
  const plain = [w, ...(w.endsWith("es") ? [w.slice(0, -2)] : []), ...(w.endsWith("s") ? [w.slice(0, -1)] : [])];
  // Diptongo de la raíz conjugada: «tiene» → tener, «puede» → poder.
  const bases = [...plain, ...plain.flatMap(b => [b.replace(/ie(?=[^aeiou]+[aeo]n?$)/u, "e"), b.replace(/ue(?=[^aeiou]+[aeo]n?$)/u, "o")]).filter(b => !plain.includes(b))];
  return bases.flatMap(b => [b, `${b}r`, ...(b.endsWith("a") ? [`${b.slice(0, -1)}o`, `${b.slice(0, -1)}ar`] : []),
    ...(b.endsWith("e") ? [`${b.slice(0, -1)}er`, `${b.slice(0, -1)}ir`] : []), ...(b.endsWith("an") ? [`${b.slice(0, -2)}ar`] : []),
    ...(b.endsWith("en") ? [`${b.slice(0, -2)}er`, `${b.slice(0, -2)}ir`] : []),
    ...(/(?:amo|emo|imo)$/u.test(b) ? [`${b.slice(0, -3)}ar`, `${b.slice(0, -3)}er`, `${b.slice(0, -3)}ir`] : [])]);
}
/** Alguna palabra (4+ letras, no cifra) que no está en los diccionarios del sistema, ni en su forma base; sin diccionario, nunca. */
function foreignWord(text: string): boolean {
  const dict = loadDictionary();
  if (!dict) return false;
  return catalogKey(text).split(" ").some(w => w.length >= 4 && !/^\d+$/u.test(w) && !dictionaryForms(w).some(f => dict.words.has(f)));
}
// 1.8.0 · convención §5: un resto de otro dominio (cocina, compras, imágenes, tareas escolares, herramientas,
// tocar un instrumento) muestra que la consulta no pide música del catálogo («salsa para guiso», «jazz queen
// poster», «bolero best price»). Solo cuenta en un resto: las frases del léxico nunca se leen aquí.
const NON_MUSIC = new Set([
  "guiso", "fideo", "pasta", "espagueti", "ravioli", "raviole", "yuca", "untar", "galleta", "pizza", "taco", "carne", "pollo", "pescado", "ensalada",
  "receta", "bebida", "ricotta", "queso", "arroz", "alita", "hamburguesa", "nacho", "coctel", "postre", "torta",
  "precio", "price", "barata", "barato", "comprar", "venta", "tienda", "oferta", "amazon", "mercadolibre", "cost", "cheap", "buy",
  "dibujar", "dibujo", "colorear", "imagen", "imagenes", "poster", "wallpaper", "fondo de pantalla", "logo", "tatuaje", "headboard", "png", "sticker", "camiseta",
  "question", "paper", "paragraph", "essay", "ensayo", "examen", "quiz", "pdf", "worksheet", "crucigrama", "tarea",
  "firefox", "chrome", "mbps", "wifi", "karts", "esmerilar", "esmeril", "taladro", "soldar", "production",
  "acordes", "tablatura", "partitura", "afinar", "afinacion",
]);
function nonMusic(text: string): boolean {
  const k = catalogKey(text);
  return [...NON_MUSIC].some(x => x.includes(" ") ? ` ${k} `.includes(` ${x} `) : k.split(" ").some(w => dictionaryForms(w).includes(x) || w === x));
}
const SUPPORT = new Set(["videos", "video", "audio"]);
/** Pregunta de definición («qué es», «qué significa», «significado»). */
const DEFINITION = /(?:^| )(?:que|q) (?:es|significa)(?: |$)|(?:^| )significado(?: |$)/u;
const INTERJECTION = /^(?:x+d+|ja(?:ja)+j?|je(?:je)+|u{2,}|a{2,}y*|lol|wow)$/u;
/** Resto que la convención trata como relleno: lista cerrada, número de una o dos cifras, interjección o repetición. */
export function closedFiller(text: string, conditionTexts: string[]): boolean {
  const t = normalizeQueryText(text);
  if (!t) return true;
  // Una letra suelta («música con s») es ruido de teclado (convención §5).
  if (CLOSED_FILLER.has(t) || /^\d{1,2}$/u.test(t) || /^[a-z]$/u.test(t) || INTERJECTION.test(t)) return true;
  const words = t.split(" ");
  if (words.every(w => CLOSED_FILLER.has(w) || INTERJECTION.test(w))) return true;
  // Repetición de una condición ya dicha («art pop arte», «canciones tristes videos tristes»).
  const said = conditionTexts.flatMap(c => normalizeQueryText(c).split(" ")).filter(w => w.length >= 3);
  const same = (w: string, x: string) => w.length >= 3 && (w.startsWith(x.slice(0, 4)) || x.startsWith(w.slice(0, 4)));
  return words.every(w => CLOSED_FILLER.has(w) || said.some(x => same(w, x)));
}

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

export const DESCRIBED_LEXICAL_PRIOR = 1;

/** `external`: nombres hallados fuera del catálogo por clave normalizada (1.7.0, external-names.ts). */
export function compileInterpretation(seg: Segmentation, answers: Answers, lexicon: QueryLexicon, thresholds: Thresholds = {}, external?: Map<string, ExternalHit>): Interpretation {
  let describedWithoutGenre = 0;
  const describedSpans: Span[] = [];
  const soundOnly = isSoundOnly(seg);
  const thr = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const hasLexicalCondition = seg.spans.some(s => ["concept", "genre", "decade"].includes(s.kind));
  const conds: Cond[] = [], pending: { text: string; reason: string }[] = [], trace: Interpretation["trace"] = [];
  const clarify: string[] = [], described: string[] = [], facets: string[] = [], contextOnly: string[] = [];
  const entities: Canonical["ent"] = [], intentionEntities: SearchIntention["entities"] = [];
  let needClarify = false, ignoredFiller = 0;
  const addEntity = (role: "target" | "reference", hint: CatalogMatch["kind"] | null, literal: string, matches: CatalogMatch[]) => {
    const kinds = [...new Set(matches.map(x => x.kind))];
    // Una referencia de parecido apunta al artista cuando el catálogo lo tiene como tal.
    // Sin señal de clase, un nombre suelto o de referencia apunta al artista cuando el catálogo lo tiene.
    let kind = hint ?? (kinds.length === 1 ? kinds[0]! : kinds.includes("artist") ? "artist" : null);
    // Fuera del catálogo, la clase la dice la fuente externa; sin ella, el artista: en las etiquetas
    // humanas de desarrollo los nombres con clase son artistas 62 veces y canciones 25 (1.7.0).
    if (!kind && !matches.length) kind = external?.get(catalogKey(literal))?.kind ?? "artist";
    // La referencia de un parecido es el artista, también cuando el catálogo solo tiene a la persona.
    if (role === "reference" && kind === "person") kind = "artist";
    const same = matches.filter(x => !kind || x.kind === kind);
    entities.push({ role, kind, literal: normalizeLiteral(literal) });
    intentionEntities.push({ role, kind: (kind ?? "artist") as SearchIntention["entities"][number]["kind"], id: same.length === 1 ? same[0]!.id : null, name: literal,
      resolution: same.length === 1 ? "resolved" : same.length > 1 ? "ambiguous" : "absent" });
  };

  if (seg.structure.parentheses) { needClarify = true; trace.push({ span: "-", text: seg.text, decision: "structure", confidence: null, outcome: "dnf_not_representable" }); }
  if (seg.structure.orAndMixed) { needClarify = true; trace.push({ span: "-", text: seg.text, decision: "structure", confidence: null, outcome: "and_or_scope_ambiguous" }); }

  // 1.8.0: un tramo entero con nombre externo («yo quiero un héroe», «jesse y joy») es ese nombre y consume
  // sus fragmentos, también la frase del léxico que contiene («gangsta paradise»). Primero el más largo.
  const consumed = new Set<string>();
  if (thr.convention && external?.size && !seg.wholeQueryMatches.length && !bareName(seg)) for (const run of nameRuns(seg)) {
    const hit = external.get(catalogKey(run.literal));
    if (!hit || hit.weak || (hit.kind === "track" && run.cued) || run.spans.some(id => consumed.has(id)) || closedFiller(run.literal, [])) continue;
    addEntity("target", hit.kind, run.literal, []); run.spans.forEach(id => consumed.add(id));
    trace.push({ span: run.spans.join("+"), text: run.literal, decision: `external:${hit.kind}`, confidence: null, outcome: "entity" });
  }

  for (const span of seg.spans) {
    if (consumed.has(span.id)) continue;
    if (span.kind === "listener") { contextOnly.push(span.text); continue; }
    if (span.kind === "entity" && span.entity) { addEntity("target", span.entity.kindHint, span.entity.literal, span.entity.matches); continue; }
    if (span.kind === "similarity" && span.entity) {
      addEntity("reference", span.entity.kindHint, span.entity.literal, span.entity.matches);
      conds.push({ concept: `similarity:${span.aspect ?? "overall"}`, text: span.text, mode: span.mode, group: span.group, scope: "track" });
      continue;
    }
    if (span.kind === "comparative") { pending.push({ text: span.text, reason: "comparative_not_representable" }); continue; }
    // En una descripción de sonido, un adjetivo ambiguo («pesado», «suave») es un rasgo más (1.4.0).
    if (soundOnly && span.kind === "ambiguous") { describedSpans.push(span); continue; }
    if (span.kind === "decade") { conds.push({ concept: span.candidates[0]!, text: span.text, mode: span.mode, group: span.group, scope: "album" }); continue; }
    if (span.attenuated) { pending.push({ text: span.text, reason: "attenuated_degree_not_representable" }); continue; }
    if (span.kind === "residual") { compileResidual(span); continue; }
    const [choice, p] = top(answers[`span:${span.id}`]);
    trace.push({ span: span.id, text: span.text, decision: choice, confidence: p, outcome: "" });
    const t = trace.at(-1)!;
    // Un término ambiguo solo, sin señal temática ni otra condición que lo sitúe («música de amor»),
    // no tiene contexto para decidir: se pregunta (1.3.0; desarrollo: S183, S184).
    // Convención 1.8.0: «suave» acompañado de otra condición o de un nombre es energía baja; solo, se aclara.
    if (thr.convention && span.kind === "ambiguous" && span.candidates.includes("energy:energy-low") && span.candidates.includes("emotion:serene") &&
        seg.spans.some(x => x !== span && (x.kind !== "residual" || !closedFiller(x.text, [])))) {
      conds.push({ concept: "energy:energy-low", text: span.text, mode: span.mode, group: span.group, scope: scopeOf("energy:energy-low") }); t.decision = "suave_accompanied"; t.outcome = "condition"; continue;
    }
    if (span.kind === "ambiguous" && span.cue !== "theme" && span.candidates.length > 1 && isolated(span)) {
      needClarify = true; clarify.push(...[...ranked(answers[`span:${span.id}`], [NOT_REQUESTED, UNCLEAR]).filter(x => span.candidates.includes(x)), ...span.candidates]); t.outcome = "clarify"; continue;
    }
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
    // Un resto con artista exacto fuera del catálogo, con la popularidad que su texto exige, es ese nombre (1.7.0).
    const extAny = span.mode !== "excluded" && !span.negated ? external?.get(catalogKey(span.text)) : undefined;
    const ext = extAny?.weak ? undefined : extAny;
    if (ext) { addEntity("target", ext.kind, span.text, []); t.decision = `external:${ext.kind}`; t.outcome = "entity"; return; }
    // Convención 1.8.0: lo de la lista cerrada es relleno, se pregunte o no a Laya.
    const said = seg.spans.filter(x => x !== span && x.kind !== "residual").map(x => x.text);
    // El soporte («sin videos», «sin audio») es relleno también negado: no acota la música.
    const support = SUPPORT.has(normalizeQueryText(span.text));
    if (thr.convention && ((span.mode !== "excluded" && !span.negated) || support) && closedFiller(span.text, said)) { t.decision = "closed_filler"; t.outcome = "ignored"; ignoredFiller++; return; }
    if (span.cue === "origin") { pending.push({ text: span.text, reason: "origin_not_representable" }); t.decision = "origin"; t.outcome = "pending"; return; }
    // Convención 1.8.0 (Brian, lote 2: «género + nombre: sí»): junto a una condición del léxico, un resto con una
    // palabra que no está en el diccionario y que Deezer tiene como artista, aunque con pocos fans («hernan marin»: 27).
    // Sin esa confirmación eran más atributos («saturada», «handpan», «vikinga») que nombres: 20 contra 9 en desarrollo.
    if (thr.convention && span.cue === "none" && span.mode !== "excluded" && !span.negated && hasLexicalCondition && foreignWord(span.text) && extAny?.kind === "artist") {
      addEntity("target", null, span.text, []); t.decision = "genre_plus_name"; t.outcome = "entity"; return;
    }
    if (span.cue === "version") { pending.push({ text: span.text, reason: "attribute_not_representable" }); t.decision = "unrepresentable"; t.outcome = "pending"; return; }
    // Descripción de sonido: los restos son rasgos para la pregunta de género, sin preguntas por fragmento
    // (1.4.0; latencia: hasta 51 preguntas por consulta en 4.0.0).
    if (soundOnly) {
      t.decision = "genre_description";
      if (span.mode === "excluded") { pending.push({ text: span.text, reason: "excluded_restriction_not_representable" }); t.outcome = "pending"; return; }
      describedSpans.push(span); t.outcome = "described"; return;
    }
    if (p < thr.dim) { pending.push({ text: span.text, reason: "residual_low_confidence" }); t.outcome = "pending"; return; }
    const d = dim as Dimension;
    // Lo negado nunca es relleno: descartarlo perdería una exclusión pedida.
    if (d === "filler" && thr.convention) { pending.push({ text: span.text, reason: "not_closed_filler" }); t.outcome = "pending"; return; }
    if (d === "filler" && p >= (span.cue === "activity" ? Math.max(thr.filler, thr.fillerAfterCue) : thr.filler) && span.mode !== "excluded" && !span.negated) { t.outcome = "ignored"; ignoredFiller++; return; }
    if (d === "filler") { pending.push({ text: span.text, reason: span.mode === "excluded" ? "excluded_restriction_not_representable" : "residual_low_confidence" }); t.outcome = "pending"; return; }
    // Un nombre fuera del catálogo («peso pluma», «Abolitino») se busca por nombre: en el tráfico real
    // los nombres son la búsqueda más frecuente (1.6.0, partición de entrenamiento humana).
    if (d === "catalog_name") { addEntity("target", null, span.text, []); t.outcome = "entity"; return; }
    if (d === "unsupported") { pending.push({ text: span.text, reason: "unsupported_restriction" }); t.outcome = "pending"; return; }
    if (d === "technical_facet") {
      const [f, fp] = top(answers[`pick:${span.id}:facet`]);
      if (f !== OTHER && fp >= thr.facet_family) facets.push(f);
      pending.push({ text: span.text, reason: f !== OTHER && fp >= thr.facet_family ? `facet_candidate:${f}` : "technical_facet" }); t.outcome = "facet"; return;
    }
    // Un sonido negado («sin voces») no describe un género: es una restricción pendiente.
    if (d === "genre_description" && span.mode === "excluded") { pending.push({ text: span.text, reason: "excluded_restriction_not_representable" }); t.outcome = "pending"; return; }
    // Convención 1.8.0: con un género ya nombrado, el resto no abre una descripción: es un nombre si Deezer lo tiene
    // como artista («música de cámara zombie», «mambo makito») y si no, un pendiente («onda nueva cuatro»).
    if (d === "genre_description" && thr.convention && seg.spans.some(s => s.kind === "genre")) {
      if (extAny?.kind === "artist") { addEntity("target", null, span.text, []); t.decision = "genre_plus_name"; t.outcome = "entity"; return; }
      pending.push({ text: span.text, reason: "described_with_named_genre" }); t.outcome = "pending"; return;
    }
    if (d === "genre_description") { describedSpans.push(span); t.outcome = "described"; return; }
    const [c, cp] = top(answers[`pick:${span.id}:${d}`]);
    if (c === OTHER || cp < thr.pick || p * cp < thr.residual) { pending.push({ text: span.text, reason: c === OTHER ? "concept_not_in_vocabulary" : "pick_low_confidence" }); t.outcome = "pending"; return; }
    conds.push({ concept: c, text: span.text, mode: span.mode, group: span.group, scope: scopeOf(c) }); t.outcome = "condition";
  }

  // Descripción de sonido sin pedido ni atributo negado: se aclara con géneros aunque Laya no marque
  // ningún resto como descripción (1.3.0; desarrollo: S204, T238).
  if (!describedSpans.length && seg.soundDescription && !entities.length) describedSpans.push(...seg.spans.filter(s => s.kind === "residual" && s.mode !== "excluded"));
  if (describedSpans.length) {
    // Orden de las alternativas: probabilidad de Laya más un previo por el orden léxico del mapa de
    // géneros (las opciones llegan ordenadas por coincidencia de rasgos BM25). λ=1 elegido en desarrollo
    // 1.3.0 (pruebas 1.0.0–3.0.0); antes 0,3. Con la descripción siempre se ofrecen las tres primeras.
    const a = answers[DESCRIBE_KEY];
    const keys = Object.keys(a?.probabilities ?? {}).filter(k => k !== OTHER);
    const score = (k: string) => (a!.probabilities[k] ?? 0) + DESCRIBED_LEXICAL_PRIOR / (keys.indexOf(k) + 1);
    const options = [...keys].sort((x, y) => score(y) - score(x)).slice(0, 3);
    if (options.length) described.push(...options);
    else { pending.push({ text: describedSpans.map(s => s.text).join(" · "), reason: "described_traits_without_genre" }); describedWithoutGenre++; }
  }

  // Convención 1.8.0 §5: un resto de otro dominio, sin un nombre del catálogo, hace la consulta no reconocida.
  // Igual una pregunta de definición con algo más que el género («noise que es en inglés», «calipso que es en
  // la odisea», «ebm que nota es»): pregunta otra cosa; «X que es» solo pide el género (§1).
  // Y la definición de algo que no es un género («qué significa correr»).
  const definition = thr.convention > 0 && DEFINITION.test(normalizeQueryText(seg.text));
  const offTopic = thr.convention ? seg.spans.find(s => s.kind === "residual" && s.mode !== "excluded" && !s.negated &&
    (nonMusic(s.text) || (definition && !closedFiller(s.text, seg.spans.filter(x => x !== s && x.kind !== "residual").map(x => x.text)))))
    ?? (definition && !seg.spans.some(s => s.kind === "genre" || s.kind === "entity") ? seg.spans[0] : undefined) : undefined;
  if (offTopic && !seg.wholeQueryMatches.length && !seg.spans.some(s => s.entity?.matches.length)) {
    conds.length = 0; pending.length = 0; clarify.length = 0; needClarify = false; entities.length = 0; intentionEntities.length = 0; described.length = 0; describedWithoutGenre = 0; facets.length = 0;
    trace.push({ span: offTopic.id, text: offTopic.text, decision: "non_music", confidence: null, outcome: "unrecognized" });
  }

  // Nombre suelto: la consulta entera no toca el léxico ni el catálogo y no lleva señales de pedido (1.7.0).
  const bare = offTopic && !seg.wholeQueryMatches.length ? null : bareName(seg);
  if (bare) {
    conds.length = 0; pending.length = 0; clarify.length = 0; needClarify = false; entities.length = 0; intentionEntities.length = 0; described.length = 0; describedWithoutGenre = 0;
    addEntity("target", null, bare.literal, []);
    // 1.8.0: «música vieja X», «X 2025»: la época queda pendiente junto al nombre.
    if (thr.convention && bare.pending) pending.push({ text: seg.text, reason: "attribute_not_representable" });
    trace.push({ span: "-", text: bare.literal, decision: "bare_name", confidence: null, outcome: "entity" });
  }

  // Consulta que coincide entera con una ficha y además contiene posibles conceptos.
  let wholeAsEntity = false;
  const lexical = seg.spans.filter(s => ["concept", "genre", "ambiguous", "facet", "decade"].includes(s.kind));
  // Un género del léxico gana a una canción o persona homónima («golpe larense»), no a un artista.
  const genreOverTitle = lexical.length > 0 && lexical.every(s => s.kind === "genre") && !seg.wholeQueryMatches.some(x => x.kind === "artist");
  if (seg.wholeQueryMatches.length && !genreOverTitle) {
    // Sin frases del léxico, el resto de la consulta no puede ser un pedido: es el nombre.
    // Si el léxico no cubre toda la consulta («Seguridad Nacional»), el resto confirma el nombre.
    const conditionLike = lexical.length > 0 && conds.length + clarify.length + pending.length > 0 && !seg.spans.some(s => s.kind === "residual");
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

  // Una descripción de sonido se aclara con la persona: los géneros nombrados se suman a las
  // alternativas y las demás condiciones no se ejecutan hasta que elija.
  const describing = (described.length > 0 || describedWithoutGenre > 0) && !entities.some(e => e.role === "target");
  if (describing) {
    const named = unique.filter(c => c.concept.startsWith("genre:") && c.mode === "required").map(c => c.concept);
    described.splice(0, described.length, ...[...new Set([...named.slice(0, 1), ...described, ...named.slice(1)])]);
  }
  let status: QueryStatus;
  if (contradiction) status = "contradiction";
  else if (needClarify) status = "clarify";
  else if (describing) { status = "clarify"; unique.length = 0; required.length = 0; excluded.length = 0; }
  else if (!unique.length && entities.some(e => e.role === "target")) status = "entity_lookup";
  else if (unique.length) status = pending.length ? "partial" : "query_valid";
  else if (pending.length) status = "unsupported";
  else status = "unrecognized";

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

  function isolated(span: Span) { return seg.spans.every(o => o === span || o.kind === "listener"); }
  function scopeOf(concept: string) { return axisOf(concept) === "decade" ? "album" : "track"; }
}

export function normalizeLiteral(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[«»"“”]/gu, "").replace(/\s+/gu, " ").trim();
}
