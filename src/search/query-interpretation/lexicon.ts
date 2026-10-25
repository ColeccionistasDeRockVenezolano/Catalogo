import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectRoot } from "../../config/project-root.js";

/** Candidatos léxicos para proponer fragmentos (crv-query-lexicon). No deciden ni asignan. */
export interface LexiconConcept { id: string; dimension: string; labelEs: string; definitionEs: string; aliases: string[]; themeNouns: string[] }
export interface LexiconGenre { slug: string; name: string; level: string; parentId: string | null; definition: string | null; traits: { aspect: string; description: string }[]; mapStatus: string | null; aliases: string[] }
export interface LexiconFacet { id: string; aliases: string[]; definition: string }
export interface QueryLexiconDocument {
  version: string; vocabularyVersion: string; genreMapVersion: string;
  concepts: LexiconConcept[]; facets: LexiconFacet[]; genres: LexiconGenre[];
  ambiguous: { phrase: string; candidates: string[] }[];
  markers: {
    negation: string[]; or: string[]; and: string[]; preference: string[]; boundary: string[];
    listener: string[]; listenerEnd: string[]; themeCues: string[];
    entityCues: Record<"track" | "album" | "artist", string[]>; ownerCues: string[];
    similarityCues: string[]; similarityWeakCues: string[]; aspects: Record<string, string[]>;
    comparatives: string[]; attenuators: string[]; clauseStarts: string[]; decades: Record<string, string[]>; fillers: string[]; origins?: string[]; fillerIdioms?: string[]; circumstances?: string[]; versionMarkers?: string[]; unrepresentable?: string[]; attributes?: string[]; soundAttributes?: string[]; formatNouns?: string[];
  };
}

/** Minúsculas, sin tildes ni signos; el apóstrofo («pa'») separa. Igual que el generador Python. */
export function normalizeQueryText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9ñ'\s-]/gu, " ").replace(/[-']/gu, " ").replace(/\s+/gu, " ").trim();
}

export type PhraseKind = "concept" | "themeNoun" | "genre" | "facet" | "ambiguous";
export interface PhraseEntry { kind: PhraseKind; candidates: string[] }

export class QueryLexicon {
  readonly doc: QueryLexiconDocument;
  readonly hash: string;
  readonly phrases = new Map<string, PhraseEntry[]>();
  readonly maxPhraseTokens: number;
  readonly concepts = new Map<string, LexiconConcept>();
  readonly genres = new Map<string, LexiconGenre>();
  readonly facets = new Map<string, LexiconFacet>();
  readonly fillers: Set<string>;

  constructor(doc: QueryLexiconDocument, hash: string) {
    this.doc = doc; this.hash = hash;
    const add = (phrase: string, kind: PhraseKind, candidate: string | string[]) => {
      const key = normalizeQueryText(phrase); if (!key) return;
      const list = this.phrases.get(key) ?? [];
      const existing = list.find(e => e.kind === kind);
      const values = Array.isArray(candidate) ? candidate : [candidate];
      if (existing) { for (const v of values) if (!existing.candidates.includes(v)) existing.candidates.push(v); }
      else list.push({ kind, candidates: [...values] });
      this.phrases.set(key, list);
    };
    for (const c of doc.concepts) {
      this.concepts.set(c.id, c);
      for (const a of c.aliases) add(a, "concept", c.id);
      for (const n of c.themeNouns) add(n, "themeNoun", c.id);
    }
    for (const g of doc.genres) { this.genres.set(g.slug, g); for (const a of g.aliases) add(a, "genre", `genre:${g.slug}`); }
    for (const f of doc.facets) { this.facets.set(f.id, f); for (const a of f.aliases) add(a, "facet", f.id); }
    for (const a of doc.ambiguous) add(a.phrase, "ambiguous", a.candidates);
    this.maxPhraseTokens = Math.max(...[...this.phrases.keys()].map(k => k.split(" ").length));
    this.fillers = new Set(doc.markers.fillers.map(normalizeQueryText));
  }

  label(id: string): string {
    if (id.startsWith("genre:")) return this.genres.get(id.slice(6))?.name ?? id;
    return this.concepts.get(id)?.labelEs ?? this.facets.get(id)?.id ?? id;
  }
  /** Descripción para la opción de Laya: definición del concepto o, para géneros, del mapa 0.17.0. */
  describe(id: string): string {
    if (id.startsWith("genre:")) {
      const g = this.genres.get(id.slice(6));
      return g ? `${g.name}. ${g.definition ?? ""}`.trim() : id;
    }
    const c = this.concepts.get(id);
    if (c) return `${c.labelEs}. ${c.definitionEs} Ej.: ${conceptExamples(c.aliases).join(", ")}.`;
    const f = this.facets.get(id);
    return f ? `${FACET_LABELS[id] ?? id}. Ej.: ${f.aliases.join(", ")}.` : id;
  }
}

let cached: QueryLexicon | null = null;
export function loadQueryLexicon(file = path.join(projectRoot(import.meta.url), "docs/unified-search/stage3/query-lexicon.json")): QueryLexicon {
  if (cached && !process.env["CRV_QUERY_LEXICON"]) return cached;
  const raw = readFileSync(process.env["CRV_QUERY_LEXICON"] ?? file, "utf8");
  cached = new QueryLexicon(JSON.parse(raw) as QueryLexiconDocument, createHash("sha256").update(raw).digest("hex"));
  return cached;
}

/** Hasta seis alias variados (raíces distintas, incluido inglés) como ejemplos de una opción de concepto. */
export function conceptExamples(aliases: string[], k = 6): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const a of [...aliases].sort((x, y) => x.length - y.length)) {
    const stem = a.slice(0, 5);
    if (seen.has(stem)) continue;
    seen.add(stem); out.push(a);
    if (out.length >= k) break;
  }
  return out;
}

/** Qué pide quien busca con cada familia técnica (las definiciones del vocabulario son notas de curaduría). */
const FACET_LABELS: Record<string, string> = {
  "candidate:timbre.fuzz": "Timbre fuzz de guitarra",
  "candidate:timbre.abrasiveness": "Sonido o voz áspera, rasposa, abrasiva",
  "candidate:arrangement.density": "Densidad del arreglo: muchas capas o pocos elementos",
  "candidate:production.fidelity-aesthetic": "Fidelidad de la grabación: lo-fi, crudo, maqueta",
  "candidate:production.sources": "Fuentes sonoras: samples, collage, grabaciones de campo",
  "candidate:instrument.role": "Un instrumento protagonista o destacado",
  "candidate:vocals.mode": "Modo de la voz: cantada, rapeada, hablada o narrada",
  "candidate:vocals.prominence": "Presencia de la voz en la mezcla: al frente, enterrada o casi sin voz",
  "candidate:vocals.delivery": "Forma expresiva de cantar: contenida, dramática, vulnerable",
  "candidate:vocals.variation": "Variación vocal: cambios de flow o de forma de cantar",
  "candidate:vocals.treatment": "Voz procesada, filtrada, acelerada o distorsionada",
  "candidate:rhythm.pattern": "Patrón rítmico reconocible (dembow, groove marcado)",
  "candidate:structure.narrative": "Disco conceptual o que cuenta una historia",
  "candidate:structure.continuity": "Continuidad: temas enlazados, de corrido, sin cortes",
  "candidate:structure.development": "Desarrollo de las canciones: que crezcan, finales, intros y outros",
  "candidate:structure.arc": "Arco del disco o la canción: apertura, cierre, cambio de ambiente, final instrumental",
  "candidate:structure.repetition-object": "Repetición: bases, motivos o patrones que se repiten",
  "candidate:listening.perceived-length": "Duración percibida: se hace largo, compacto, sobran temas",
  "candidate:reception.acclimatization": "Gana con escuchas, cuesta entrar al principio",
  "candidate:access.lyric-comprehension": "Poder entender o seguir la letra",
  "candidate:reception.cultural-familiarity": "Familiaridad cultural: me recuerda a mi país, reconozco esos sonidos",
  "candidate:affinity.aspect": "Parecido con otra obra o persona en un aspecto concreto",
};

