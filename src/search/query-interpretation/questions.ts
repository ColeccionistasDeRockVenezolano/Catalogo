import { normalizeQueryText, type QueryLexicon } from "./lexicon.js";
import type { Segmentation, Span } from "./segmenter.js";

/** Preguntas tipadas para Laya. Opciones acotadas y jerárquicas; nunca texto libre ni IDs. */
export const QUESTION_VERSION = "crv-query-questions-0.1.0";
export interface LayaQuestion { type: "choice"; instructions: string; criteria: Record<string, string> }
export interface QuestionTask {
  /** Identificador estable dentro de la consulta: span:S3, dim:S4, pick:S4:emotion, kind. */
  key: string; family: QuestionFamily; spanId: string | null; state: string; question: LayaQuestion;
}
export type QuestionFamily = "span" | "dim" | "pick" | "genre_description" | "facet_family" | "query_kind";

export const NOT_REQUESTED = "not_requested", UNCLEAR = "unclear", OTHER = "other";
export const DIMENSIONS = {
  activity: "Uso o actividad para la que se pide la música (estudiar, dormir, bailar, manejar…)",
  emotion: "Carácter afectivo que debe tener la música (alegre, triste, romántica…)",
  energy: "Nivel de intensidad o energía de la música",
  atmosphere: "Ambiente sonoro de la música (oscuro, nocturno, épico…)",
  theme: "De qué tratan las letras o la obra",
  genre_description: "Describe rasgos de sonido, instrumentos, ritmo o forma propios de un género o estilo",
  technical_facet: "Rasgo técnico de grabación, voz, estructura o arreglo (lo-fi, sin voces, en vivo, conceptual…)",
  catalog_name: "Es el nombre de un artista, disco o canción",
  filler: "Relleno, cortesía, valoración vaga o palabra sin pedido musical",
  unsupported: "Otra restricción concreta que no encaja en ninguna de estas categorías (duración, tempo, color, origen…)",
} as const;
export type Dimension = keyof typeof DIMENSIONS;
const AXES = ["activity", "emotion", "energy", "atmosphere", "theme"] as const;

function state(seg: Segmentation, span?: Span) {
  return span ? `Consulta: «${seg.text}»\nFragmento: «${span.text}»` : `Consulta: «${seg.text}»`;
}

export const DESCRIBE_KEY = "describe:genre";

/** Atajo léxico para «género por descripción»: géneros cuyos rasgos del mapa comparten palabras con el fragmento. */
export function genreShortlist(text: string, lexicon: QueryLexicon, k = 10): string[] {
  const stop = new Set(["de", "la", "el", "los", "las", "y", "con", "en", "un", "una", "que", "por", "a", "o", "su", "sus", "del", "se", "al", "lo", "muy", "mucha", "mucho"]);
  const words = (s: string) => new Set(normalizeQueryText(s).split(" ").filter(w => w.length > 2 && !stop.has(w)).map(w => w.replace(/(es|s)$/u, "")));
  const q = words(text);
  if (!q.size) return [];
  const scored = lexicon.doc.genres.filter(g => g.traits.length).map(g => {
    const bag = words([g.definition ?? "", ...g.traits.map(t => t.description)].join(" "));
    let hit = 0; for (const w of q) if (bag.has(w)) hit++;
    return { id: `genre:${g.slug}`, score: hit / Math.sqrt(bag.size + 4) };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(x => x.id);
}

export function buildQuestions(seg: Segmentation, lexicon: QueryLexicon): QuestionTask[] {
  const tasks: QuestionTask[] = [];
  const describe = (ids: string[]) => Object.fromEntries(ids.map(id => [id, lexicon.describe(id)]));
  for (const span of seg.spans) {
    if (["concept", "genre", "ambiguous", "facet"].includes(span.kind) && span.candidates.length) {
      tasks.push({ key: `span:${span.id}`, family: "span", spanId: span.id, state: state(seg, span), question: { type: "choice",
        instructions: "¿Qué pide la persona con el fragmento señalado? Elige el significado que tiene en esta consulta. Si el fragmento describe el estado actual de la persona, forma parte de un nombre o no pide nada a la música, elige not_requested.",
        criteria: { ...describe(span.candidates), [NOT_REQUESTED]: "El fragmento no describe la música pedida (estado de la persona, parte de un nombre u otra cosa)", [UNCLEAR]: "La consulta no permite decidir entre los significados; hay que preguntar" } } });
    }
    if (span.kind === "residual") {
      const dims: Dimension[] = span.cue === "theme" ? ["theme", "unsupported"] : Object.keys(DIMENSIONS) as Dimension[];
      tasks.push({ key: `dim:${span.id}`, family: "dim", spanId: span.id, state: state(seg, span), question: { type: "choice",
        instructions: "¿Qué tipo de pedido hace la persona con el fragmento señalado? No deduzcas actividad desde un género o una emoción.",
        criteria: Object.fromEntries(dims.map(d => [d, DIMENSIONS[d]])) } });
      for (const axis of AXES) {
        if (!dims.includes(axis)) continue;
        const ids = lexicon.doc.concepts.filter(c => c.dimension === axis).map(c => c.id);
        tasks.push({ key: `pick:${span.id}:${axis}`, family: "pick", spanId: span.id, state: state(seg, span), question: { type: "choice",
          instructions: `Si el fragmento pide algo de tipo «${axis}», ¿cuál de estos conceptos pide? Elige other si ninguno corresponde exactamente.`,
          criteria: { ...describe(ids), [OTHER]: "Ninguno de estos conceptos corresponde" } } });
      }
      if (dims.includes("genre_description")) {
        tasks.push({ key: `pick:${span.id}:facet`, family: "facet_family", spanId: span.id, state: state(seg, span), question: { type: "choice",
          instructions: "Si el fragmento pide un rasgo técnico, ¿a qué familia de rasgo corresponde?",
          criteria: { ...describe(lexicon.doc.facets.map(f => f.id)), [OTHER]: "Otro rasgo técnico sin familia propuesta" } } });
      }
    }
  }
  // Una sola pregunta de género sobre toda la descripción: los rasgos suelen venir repartidos
  // en varios fragmentos («guitarras distorsionadas» y «voz gritada»).
  const describable = seg.spans.filter(s => s.kind === "residual" && s.cue !== "theme");
  if (describable.length) {
    const joined = describable.map(s => s.text).join(" · ");
    const shortlist = genreShortlist(joined, lexicon);
    if (shortlist.length) tasks.push({ key: DESCRIBE_KEY, family: "genre_description", spanId: null, state: `Consulta: «${seg.text}»\nDescripción: «${joined}»`, question: { type: "choice",
      instructions: "Si la consulta describe rasgos de un género o estilo, ¿cuál de estos encaja mejor con lo descrito en conjunto? Es una propuesta, no un filtro.",
      criteria: { ...describe(shortlist), [OTHER]: "Ninguno encaja con lo descrito" } } });
  }
  const conditionSpans = seg.spans.filter(s => ["concept", "genre", "ambiguous", "facet", "residual"].includes(s.kind));
  if (seg.wholeQueryMatches.length && conditionSpans.length) {
    tasks.push({ key: "kind", family: "query_kind", spanId: null, state: state(seg), question: { type: "choice",
      instructions: "La consulta coincide con el nombre de una ficha del catálogo. ¿Qué busca la persona?",
      criteria: { catalog_lookup: "Busca esa ficha concreta por su nombre (artista, disco o canción)", music_request: "Describe la música que quiere oír; el nombre coincide por casualidad", [UNCLEAR]: "No se puede saber sin preguntar" } } });
  }
  return tasks;
}
