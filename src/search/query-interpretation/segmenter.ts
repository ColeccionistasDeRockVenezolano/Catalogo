import { normalizeEntityName } from "../../normalization/entity-name.js";
import { normalizeQueryText, type QueryLexicon } from "./lexicon.js";

/** Resolución exacta de nombres del catálogo (nombre o alias, sin tildes). Nunca inventa IDs. */
export interface CatalogMatch { kind: "artist" | "person" | "album" | "track" | "organization"; id: number; name: string }
export interface CatalogResolver { lookup(literal: string): CatalogMatch[] }
export const emptyCatalog: CatalogResolver = { lookup: () => [] };
export function catalogKey(literal: string): string { return normalizeEntityName(literal).secondaryKey; }

interface Token { orig: string; norm: string; punct: boolean; used: boolean; at: number }
export type Mode = "required" | "excluded" | "preferred";
export type SpanKind = "concept" | "genre" | "facet" | "ambiguous" | "decade" | "residual" | "entity" | "similarity" | "listener" | "comparative";
export interface Span {
  id: string; kind: SpanKind; text: string; start: number; end: number;
  /** Ids de concepto/género/faceta propuestos por el léxico (nunca decididos aquí). */
  candidates: string[];
  /** Señal sintáctica observada: «sobre», «para», adjetivo, ninguna. */
  /** «version»: versión, cifra o atributo sin eje; queda pendiente sin preguntar. */
  cue: "theme" | "activity" | "origin" | "version" | "none";
  mode: Mode; group: string | null;
  entity?: { role: "target" | "reference"; kindHint: CatalogMatch["kind"] | null; literal: string; matches: CatalogMatch[]; quoted: boolean };
  aspect?: string; decade?: string;
  /** Posición en el texto original [charStart, charEnd). */
  charStart?: number; charEnd?: number;
  /** Negación o grado atenuado («ni tan triste»): no representable, se conserva pendiente. */
  attenuated?: boolean;
  /** Negado dentro de una preferencia («ojalá sin letra»): nunca es relleno. */
  negated?: boolean;
}
export interface Segmentation {
  version: "crv-query-segmenter-0.1.0"; lexicon: string; text: string; normalized: string;
  spans: Span[];
  /** Entidad exacta del catálogo que coincide con toda la consulta (sin señales). */
  wholeQueryMatches: CatalogMatch[];
  structure: { orAndMixed: boolean; parentheses: boolean };
  listenerStates: number;
  /** Descripción de sonido sin sustantivo de pedido y con instrumentos o voz («batería simple y voz directa…»). */
  soundDescription: boolean;
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?|[«»"“”(),;:.!?¿¡]/gu;
const QUOTES: Record<string, string> = { "«": "»", "\"": "\"", "“": "”" };

function tokenize(text: string): Token[] {
  return [...text.matchAll(WORD)].map(m => {
    const orig = m[0];
    const punct = !/[\p{L}\p{N}]/u.test(orig);
    // «pa'» → «pa»: el apóstrofo final no separa otra palabra.
    return { orig, norm: punct ? orig : normalizeQueryText(orig.replace(/['’]$/u, "")), punct, used: false, at: m.index ?? 0 };
  }).filter(t => t.punct || t.norm);
}

const phraseSet = (list: string[]) => new Map(list.map(p => [normalizeQueryText(p), p.split(" ").length] as const));

const REQUEST_HEADS = new Set(["musica", "canciones", "cancion", "temas", "tema", "algo", "playlist", "discos", "disco", "albumes", "album", "grabaciones", "pistas", "rolas", "sonidos",
  "quiero", "busco", "necesito", "ponme", "pon", "dame", "recomiendame", "music", "songs", "bandas", "grupos", "artistas"]);

export function segmentQuery(text: string, lexicon: QueryLexicon, catalog: CatalogResolver = emptyCatalog): Segmentation {
  const tokens = tokenize(text);
  const m = lexicon.doc.markers;
  const spans: Span[] = [];
  let seq = 0;
  const nextId = () => `S${++seq}`;
  const wordsAt = (i: number, n: number) => {
    const out: number[] = [];
    for (let j = i; j < tokens.length && out.length < n; j++) { if (tokens[j]!.punct) break; out.push(j); }
    return out;
  };
  const phraseAt = (i: number, phrases: Map<string, number>): number => {
    // Longitud (en tokens) de la frase más larga de la lista que empieza en i.
    let best = 0;
    for (const [p, n] of phrases) {
      const idx = wordsAt(i, n);
      if (idx.length === n && idx.every(j => !tokens[j]!.used) && idx.map(j => tokens[j]!.norm).join(" ") === p && n > best) best = n;
    }
    return best;
  };
  const isLexiconPhrase = (idx: number[]) => lexicon.phrases.has(idx.map(j => tokens[j]!.norm).join(" "));
  const markUsed = (from: number, n: number) => { for (let j = from, k = 0; j < tokens.length && k < n; j++) if (!tokens[j]!.punct) { tokens[j]!.used = true; k++; } };
  const origOf = (idx: number[]) => idx.map(j => tokens[j]!.orig).join(" ");
  /** Texto original entre el primer y el último token (conserva «Pa'», «Inc.»). */
  const sourceOf = (idx: number[]) => { const a = tokens[idx[0]!]!, b = tokens[idx.at(-1)!]!; return text.slice(a.at, b.at + b.orig.length); };
  /** Prefijo más largo (en palabras desde i) que resuelve exactamente en el catálogo. */
  const longestCatalog = (i: number, maxWords = 8, kinds?: CatalogMatch["kind"][]) => {
    const idx = wordsAt(i, maxWords);
    for (let n = idx.length; n >= 1; n--) {
      const part = idx.slice(0, n);
      // Una ficha cuyo nombre son solo palabras vacías («De», «Que») no se toma como entidad.
      if (part.every(j => lexicon.fillers.has(tokens[j]!.norm))) continue;
      const matches = catalog.lookup(origOf(part)).filter(x => !kinds || kinds.includes(x.kind));
      if (matches.length) return { part, matches };
    }
    return null;
  };

  // 1. Literales entre comillas: siempre un nombre propio, nunca un concepto.
  for (let i = 0; i < tokens.length; i++) {
    const close = QUOTES[tokens[i]!.orig];
    if (!close) continue;
    const j = tokens.findIndex((t, k) => k > i && t.orig === close);
    if (j < 0) continue;
    const idx = [...Array(j - i - 1).keys()].map(k => i + 1 + k).filter(k => !tokens[k]!.punct);
    if (!idx.length) continue;
    const literal = origOf(idx);
    const hint = cueKindBefore(i);
    spans.push({ id: nextId(), kind: "entity", text: literal, start: i, end: j, candidates: [], cue: "none", mode: "required", group: null,
      entity: { role: "target", kindHint: hint, literal, matches: catalog.lookup(literal).filter(x => !hint || x.kind === hint), quoted: true } });
    for (let k = i; k <= j; k++) tokens[k]!.used = true;
  }
  function cueKindBefore(i: number): CatalogMatch["kind"] | null {
    for (const [kind, cues] of Object.entries(m.entityCues) as [CatalogMatch["kind"], string[]][]) {
      for (const cue of cues) {
        const n = cue.split(" ").length, start = i - n;
        if (start >= 0 && tokens.slice(start, i).map(t => t.norm).join(" ") === normalizeQueryText(cue)) { markUsed(start, n); return kind; }
      }
    }
    return null;
  }

  // 2. Señales de entidad («la canción X», «la banda X») y de dueño («temas de X»).
  const entityCues = Object.entries(m.entityCues).flatMap(([kind, cues]) => cues.map(c => [normalizeQueryText(c), c.split(" ").length, kind] as const))
    .sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.used || tokens[i]!.punct) continue;
    const cue = entityCues.find(([p, n]) => wordsAt(i, n).map(j => tokens[j]!.norm).join(" ") === p && wordsAt(i, n).length === n);
    if (!cue) continue;
    const [, n, kind] = cue;
    const after = i + n;
    if (after >= tokens.length || tokens[after]!.punct || tokens[after]!.used) continue;
    const found = longestCatalog(after, 8, [kind as CatalogMatch["kind"]]);
    // «el disco X» admite un nombre aún no resuelto; «disco» sin artículo solo con coincidencia exacta.
    const withArticle = cue[1] > 1;
    if (!found && !withArticle) continue;
    // «para la pista de baile»: un nombre sin resolver no empieza por preposición.
    if (!found && ["de", "del", "para", "con", "en", "sin", "que", "y", "o"].includes(tokens[after]!.norm)) continue;
    // «una canción agridulce»: sin artículo determinado, un concepto del léxico describe, no nombra.
    if (found && !withArticle && isLexiconPhrase(found.part)) continue;
    const part = found?.part ?? wordsAt(after, 8);
    if (!part.length) continue;
    const literal = sourceOf(part);
    markUsed(i, n); for (const j of part) tokens[j]!.used = true;
    spans.push({ id: nextId(), kind: "entity", text: literal, start: i, end: part.at(-1)!, candidates: [], cue: "none", mode: "required", group: null,
      entity: { role: "target", kindHint: kind as CatalogMatch["kind"], literal, matches: found?.matches ?? [], quoted: false } });
  }
  const ownerCues = phraseSet(m.ownerCues);
  for (let i = 0; i < tokens.length; i++) {
    const n = phraseAt(i, ownerCues);
    if (!n) continue;
    const after = wordsAt(i, n).at(-1)! + 1;
    const found = longestCatalog(after, 8, ["artist", "person"]);
    if (!found) continue;
    // «temas de bossa nova», «música de sexo»: un concepto en minúsculas no es un dueño.
    if (isLexiconPhrase(found.part) && found.part.every(j => tokens[j]!.orig === tokens[j]!.orig.toLowerCase())) continue;
    markUsed(i, n); for (const j of found.part) tokens[j]!.used = true;
    spans.push({ id: nextId(), kind: "entity", text: origOf(found.part), start: i, end: found.part.at(-1)!, candidates: [], cue: "none", mode: "required", group: null,
      entity: { role: "target", kindHint: "artist", literal: origOf(found.part), matches: found.matches, quoted: false } });
  }

  // 3. Parecido: «parecido a X [en las guitarras] [pero más triste]».
  const simStrong = phraseSet(m.similarityCues), simWeak = phraseSet(m.similarityWeakCues);
  const aspectPhrases = Object.entries(m.aspects).flatMap(([aspect, list]) => list.map(p => [normalizeQueryText(p), p.split(" ").length, aspect] as const)).sort((a, b) => b[1] - a[1]);
  const stopForReference = new Set(["en", "para", "pero", "y", "con", "sin", "de"]);
  for (let i = 0; i < tokens.length; i++) {
    let n = phraseAt(i, simStrong), strong = true;
    if (!n) { n = phraseAt(i, simWeak); strong = false; }
    if (!n) continue;
    const after = wordsAt(i, n).at(-1)! + 1;
    const found = longestCatalog(after, 8, ["artist", "person", "album", "track", "organization"]);
    if (!found && !strong) continue;
    if (found && isLexiconPhrase(found.part) && found.part.every(j => tokens[j]!.orig === tokens[j]!.orig.toLowerCase())) continue;
    if (!found && isLexiconPhrase(wordsAt(after, 8).filter((j, q, all) => all.slice(0, q + 1).every(x => !stopForReference.has(tokens[x]!.norm))))) continue;
    const part = found?.part ?? [];
    if (!found) { for (const j of wordsAt(after, 8)) { if (stopForReference.has(tokens[j]!.norm) || tokens[j]!.used) break; part.push(j); } }
    if (!part.length) continue;
    markUsed(i, n); for (const j of part) tokens[j]!.used = true;
    let aspect = "overall", end = part.at(-1)!;
    // «Korpus Inc. en las guitarras»: el punto de una abreviatura no corta el aspecto.
    if (tokens[end + 1]?.orig === "." && tokens[end + 2]?.norm === "en") { tokens[end + 1]!.used = true; end++; }
    const k = end + 1;
    if (tokens[k]?.norm === "en") {
      const hit = aspectPhrases.find(([p, len]) => wordsAt(k + 1, len).length === len && wordsAt(k + 1, len).map(j => tokens[j]!.norm).join(" ") === p);
      if (hit) { aspect = hit[2]; tokens[k]!.used = true; markUsed(k + 1, hit[1]); end = wordsAt(k + 1, hit[1]).at(-1)!; }
    }
    const literal = sourceOf(part) + (tokens[part.at(-1)! + 1]?.orig === "." && end > part.at(-1)! ? "." : "");
    spans.push({ id: nextId(), kind: "similarity", text: literal, start: i, end, candidates: [`similarity:${aspect}`], cue: "none", mode: "required", group: null, aspect,
      entity: { role: "reference", kindHint: null, literal, matches: found?.matches ?? [], quoted: false } });
    // Comparativo tras la referencia («pero más triste»): se conserva como pendiente.
    let c = end + 1;
    if (tokens[c]?.norm === "pero") c++;
    if (tokens[c] && m.comparatives.includes(tokens[c]!.norm)) {
      const rest = wordsAt(c, 6).filter(j => !tokens[j]!.used);
      for (const j of rest) tokens[j]!.used = true;
      if (tokens[end + 1]?.norm === "pero") tokens[end + 1]!.used = true;
      spans.push({ id: nextId(), kind: "comparative", text: origOf(rest), start: c, end: rest.at(-1) ?? c, candidates: [], cue: "none", mode: "required", group: null });
    }
  }

  // 4. Estado actual de la persona: solo contexto, nunca filtro.
  const listener = phraseSet(m.listener), listenerEnd = phraseSet(m.listenerEnd);
  let listenerStates = 0;
  for (let i = 0; i < tokens.length; i++) {
    const n = phraseAt(i, listener);
    if (!n) continue;
    const idx: number[] = [];
    for (let j = wordsAt(i, n).at(-1)! + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.punct || t.used || t.norm === "pero" || phraseAt(j, listenerEnd)) break;
      // «ando triste y nostálgico, …»: la «y» coordina estados mientras no empiece el pedido (1.4.0).
      if (t.norm === "y") { const nx = tokens[j + 1]; if (!nx || nx.punct || nx.used || phraseAt(j + 1, listenerEnd) || REQUEST_HEADS.has(nx.norm)) break; continue; }
      idx.push(j);
    }
    markUsed(i, n); for (const j of idx) tokens[j]!.used = true;
    listenerStates++;
    spans.push({ id: nextId(), kind: "listener", text: origOf(idx), start: i, end: idx.at(-1) ?? i, candidates: [], cue: "none", mode: "required", group: null });
  }

  // 5. Década de publicación («de los noventa», «los 80»).
  const decadeWords = new Map(Object.entries(m.decades).flatMap(([d, list]) => list.map(w => [normalizeQueryText(w), d] as const)));
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.used || !["los", "anos"].includes(tokens[i]!.norm)) continue;
    let j = i + 1;
    if (tokens[i]!.norm === "los" && tokens[j]?.norm === "anos") j++;
    let len = 1;
    if (tokens[j]?.norm === "dos" && tokens[j + 1]?.norm === "mil") len = 2;
    const word = len === 2 ? "dos mil" : tokens[j]?.norm;
    const decade = word ? decadeWords.get(word) : undefined;
    if (!decade) continue;
    const start = tokens[i - 1]?.norm === "de" && !tokens[i - 1]!.used ? i - 1 : i;
    for (let k = start; k < j + len; k++) tokens[k]!.used = true;
    spans.push({ id: nextId(), kind: "decade", text: tokens.slice(start, j + len).map(t => t.orig).join(" "), start, end: j + len - 1, candidates: [`decade:${decade}`], cue: "none", mode: "required", group: null, decade });
  }

  // 6. Consulta que es, entera, un nombre del catálogo (sin señales de pedido).
  const free = tokens.filter(t => !t.punct && !t.used);
  const requestWords = new Set(["musica", "canciones", "cancion", "algo", "quiero", "para", "pa", "temas", "rolas", "dame", "ponme", "pon", "busco", "necesito", "music", "songs", "sobre", "sin"]);
  const wholeQueryMatches = spans.length === 0 && free.length && !free.some(t => requestWords.has(t.norm))
    ? catalog.lookup(free.map(t => t.orig).join(" ")).filter(x => x.kind !== "organization") : [];

  // 6b. Atenuadores («ni tan», «no muy»): el fragmento siguiente queda pendiente.
  const attenuators = phraseSet(m.attenuators);
  const attenuatedStarts = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const n = phraseAt(i, attenuators);
    if (n) { markUsed(i, n); attenuatedStarts.add(wordsAt(i, n).at(-1)! + 1); }
  }

  // 6c. Circunstancia temporal («después del trabajo», «antes de dormir»): no pide nada a la música.
  const circumstances = phraseSet(m.circumstances ?? []);
  const circumstanceStop = new Set(["y", "o", "pero", "sin", "con", "para", "pa", "pal", "aunque"]);
  for (let i = 0; i < tokens.length; i++) {
    const n = tokens[i]!.used ? 0 : phraseAt(i, circumstances);
    if (!n) continue;
    markUsed(i, n);
    let j = wordsAt(i, n).at(-1)! + 1;
    for (let k = 0; k < 4 && j < tokens.length && !tokens[j]!.punct && !tokens[j]!.used && !circumstanceStop.has(tokens[j]!.norm); k++, j++) tokens[j]!.used = true;
    i = j - 1;
  }

  // 6d. Versión o grabación («grabado en vivo», «remix»): intention-v1 no la representa; queda pendiente.
  const versions = phraseSet(m.versionMarkers ?? []);
  for (let i = 0; i < tokens.length; i++) {
    const n = tokens[i]!.used ? 0 : phraseAt(i, versions);
    if (!n) continue;
    const idx = wordsAt(i, n);
    markUsed(i, n);
    spans.push({ id: nextId(), kind: "residual", text: origOf(idx), start: i, end: idx.at(-1)!, candidates: [], cue: "version", mode: "required", group: null });
    i = idx.at(-1)!;
  }

  // 7. Frases del léxico (la más larga primero). Los sustantivos temáticos exigen señal temática.
  const themeCues = phraseSet(m.themeCues);
  const activityCue = new Set(["para", "pa", "pal", "for"]);
  const markerTokens = new Set<number>();
  let lastTheme = -1;
  const formatNouns = new Set((m.formatNouns ?? []).map(normalizeQueryText));
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.used || tokens[i]!.punct) continue;
    let cueLen = phraseAt(i, themeCues);
    // Una faceta que empieza en la señal y es más larga la gana («que cuente una historia»: estructura; 1.4.0).
    if (cueLen) { const f = longestPhrase(i, false); if (f && f.n > cueLen && f.entries.every(e => e.kind === "facet")) cueLen = 0; }
    let themed = false, continuation = false;
    // «canciones de despecho»: «de» tras un sustantivo de pedido es señal temática solo si sigue un
    // sustantivo temático; un ambiguo («de amor») conserva todas sus lecturas.
    if (!cueLen && tokens[i]!.norm === "de" && i > 0 && !tokens[i - 1]!.punct) {
      const w = nextWord(i + 1);
      const h = w >= 0 ? longestPhrase(w, true) : null;
      if (h && h.entries.every(e => e.kind === "themeNoun")) cueLen = 1;
    }
    if (cueLen) { markUsed(i, cueLen); for (const j of wordsAt(i, cueLen)) markerTokens.add(j); i = wordsAt(i, cueLen).at(-1)!; themed = true; }
    // Enumeración tras un tema («de despecho y ruptura amorosa»): el siguiente miembro también es tema si lo es.
    else if (lastTheme >= 0 && tokens.slice(lastTheme + 1, i).every(t => t.punct ? t.orig === "," : ["y", "e", "o", "u", "la", "el", "los", "las", "de"].includes(t.norm))) {
      const h = longestPhrase(i, true);
      if (h && h.entries.every(e => e.kind === "themeNoun" || e.candidates.every(c => c.startsWith("theme:")))) { themed = true; continuation = true; }
    }
    const start = themed && !continuation ? nextWord(i + 1) : i;
    if (start < 0) continue;
    const hit = longestPhrase(start, themed);
    if (!hit && themed) {
      // Señal temática sin tema del vocabulario: no se reinterpreta como emoción ni actividad.
      const idx: number[] = [];
      for (const j of wordsAt(start, 6)) { if (tokens[j]!.used || ["y", "o", "pero", "sin", "ni", "para"].includes(tokens[j]!.norm)) break; idx.push(j); }
      if (idx.length) {
        for (const j of idx) tokens[j]!.used = true;
        spans.push({ id: nextId(), kind: "residual", text: origOf(idx), start, end: idx.at(-1)!, candidates: [], cue: "theme", mode: "required", group: null });
        i = idx.at(-1)!;
      } else i = start - 1;
      continue;
    }
    if (!hit) continue;
    const { n, entries } = hit, idx = wordsAt(start, n);
    // «un disco que…», «discos conceptuales»: con determinante o en plural es el formato, no el género.
    if (n === 1 && formatNouns.has(tokens[start]!.norm) && (tokens[start]!.norm.endsWith("s") || ["un", "el", "los", "unos", "mi", "mis", "este", "ese", "tu"].includes(tokens[start - 1]?.norm ?? ""))) { i = start; continue; }
    const prev = tokens[start - 1];
    const cue: Span["cue"] = themed ? "theme" : prev && activityCue.has(prev.norm) ? "activity" : "none";
    const candidates = [...new Set(entries.flatMap(e => e.candidates))];
    const kind: SpanKind = entries.some(e => e.kind === "ambiguous") ? "ambiguous" : candidates.every(c => c.startsWith("genre:")) ? "genre"
      : candidates.every(c => c.startsWith("candidate:")) ? "facet" : "concept";
    for (const j of idx) tokens[j]!.used = true;
    lastTheme = candidates.every(c => c.startsWith("theme:")) ? idx.at(-1)! : -1;
    spans.push({ id: nextId(), kind, text: origOf(idx), start, end: idx.at(-1)!, candidates, cue, mode: "required", group: null,
      ...(attenuatedStarts.has(start) ? { attenuated: true } : {}) });
    i = idx.at(-1)!;
    // Elipsis coordinada («energía media o alta»): el núcleo de la frase se sobrentiende en la segunda.
    const conj = tokens[i + 1], w = tokens[i + 2];
    if (n >= 2 && conj && w && ["o", "u", "y", "e"].includes(conj.norm) && !w.punct && !w.used && !(tokens[i + 3] && !tokens[i + 3]!.punct && !tokens[i + 3]!.used && !lexicon.fillers.has(tokens[i + 3]!.norm))) {
      // «energía media o alta», «de energía baja o media»: se prueba el núcleo con y sin sus primeras palabras.
      const heads = [tokens[idx[0]!]!.norm, ...idx.slice(0, -1).map((_, q) => idx.slice(q, -1).map(j => tokens[j]!.norm).join(" "))];
      const elided = (heads.map(h => lexicon.phrases.get(`${h} ${w.norm}`)).find(Boolean) ?? []).filter(e => e.kind !== "themeNoun");
      if (elided.length && !lexicon.phrases.has(w.norm)) {
        w.used = true;
        const c2 = [...new Set(elided.flatMap(e => e.candidates))];
        spans.push({ id: nextId(), kind: c2.every(c => c.startsWith("genre:")) ? "genre" : "concept", text: w.orig, start: i + 2, end: i + 2, candidates: c2, cue, mode: "required", group: null });
        i = i + 1; // la conjunción queda libre para el paso de operadores
      }
    }
  }
  function nextWord(i: number) { for (let j = i; j < tokens.length; j++) { if (tokens[j]!.punct) return -1; if (!tokens[j]!.used && !["el", "la", "los", "las", "un", "una", "de"].includes(tokens[j]!.norm)) return j; } return -1; }
  function longestPhrase(i: number, themed: boolean) {
    for (let n = Math.min(lexicon.maxPhraseTokens, wordsAt(i, 99).length); n >= 1; n--) {
      const idx = wordsAt(i, n);
      if (idx.length !== n || idx.some(j => tokens[j]!.used)) continue;
      // Copia: las entradas del léxico son compartidas entre consultas y no se modifican.
      const entries = (lexicon.phrases.get(idx.map(j => tokens[j]!.norm).join(" ")) ?? [])
        .filter(e => themed ? e.kind === "themeNoun" || e.kind === "ambiguous" || e.candidates.some(c => c.startsWith("theme:")) : e.kind !== "themeNoun")
        .map(e => ({ ...e, candidates: [...e.candidates] }));
      // Con señal temática, un alias ambiguo se restringe a sus lecturas temáticas si las tiene.
      if (themed) for (const e of entries) if (e.kind === "ambiguous" && e.candidates.some(c => c.startsWith("theme:"))) e.candidates = e.candidates.filter(c => c.startsWith("theme:"));
      if (entries.length) return { n, entries: entries.map(e => ({ ...e, candidates: [...e.candidates] })) };
    }
    return null;
  }

  // 8. Operadores y restos. Lo que no es relleno ni operador queda como fragmento residual.
  const ops = { negation: phraseSet(m.negation), or: phraseSet(m.or), and: phraseSet(m.and), preference: phraseSet(m.preference), boundary: phraseSet(m.boundary), clause: phraseSet(m.clauseStarts) };
  type Op = { at: number; type: keyof typeof ops | "punct" };
  const operators: Op[] = [];
  // Expresiones hechas que no niegan ni restringen («sin parar», «no recuerdo»): relleno.
  const idioms = phraseSet(m.fillerIdioms ?? []);
  for (let i = 0; i < tokens.length; i++) { const n = tokens[i]!.used ? 0 : phraseAt(i, idioms); if (n) { markUsed(i, n); i = wordsAt(i, n).at(-1)!; } }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.punct) { if ([",", ";", ".", ":"].includes(t.orig)) operators.push({ at: i, type: "punct" }); continue; }
    if (t.used) continue;
    let matched = false;
    for (const type of ["negation", "preference", "boundary", "or", "and", "clause"] as const) {
      const n = phraseAt(i, ops[type]);
      if (n) { operators.push({ at: i, type }); markUsed(i, n); i = wordsAt(i, n).at(-1)!; matched = true; break; }
    }
    if (matched) continue;
  }
  const origins = new Set((m.origins ?? []).map(normalizeQueryText));
  const unrepresentableWords = new Set((m.unrepresentable ?? []).map(normalizeQueryText));
  // Instrumentos, voz, idioma, época y popularidad: atributo pendiente salvo en una descripción de
  // sonido sin sustantivo de pedido («acordeón, caja y guacharaca», «Suena un arpa…»).
  const words = tokens.filter(t => !t.punct);
  const describing = !words.some(t => REQUEST_HEADS.has(t.norm)) && (words.length >= 5 || tokens.some(t => t.orig === ","));
  const soundSet = new Set((m.soundAttributes ?? []).map(normalizeQueryText));
  const soundDescription = describing && words.some(t => soundSet.has(t.norm)) && !spans.some(sp => sp.kind === "concept" && sp.candidates.every(c => c.startsWith("activity:")));
  if (!describing) for (const w of m.attributes ?? []) unrepresentableWords.add(normalizeQueryText(w));
  // Ruido de teclado («zxcv»): palabras sin vocal no forman fragmento.
  for (const t of tokens) if (!t.punct && !t.used && t.norm.length >= 3 && !/[aeiouy]/u.test(t.norm) && !/\d/u.test(t.norm)) t.used = true;
  // …ni las tecleadas sobre una sola fila con pocas vocales («asdf», «qwe», «asdkjh»; 1.4.0, desarrollo: T245, S245).
  const KEY_ROWS = ["qwertyuiop", "asdfghjkln", "zxcvbnm"];
  for (const t of tokens) {
    if (t.punct || t.used || t.norm.length < 3 || !/^[a-z]+$/u.test(t.norm) || lexicon.fillers.has(t.norm)) continue;
    const vowels = [...t.norm].filter(ch => "aeiou".includes(ch)).length;
    if (vowels / t.norm.length < 0.34 && KEY_ROWS.some(row => [...t.norm].every(ch => row.includes(ch)))) t.used = true;
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.punct || t.used || lexicon.fillers.has(t.norm)) continue;
    const idx: number[] = [];
    let j = i;
    for (; j < tokens.length; j++) {
      const u = tokens[j]!;
      if (u.punct || u.used) break;
      if (lexicon.fillers.has(u.norm)) { if (idx.length && j + 1 < tokens.length && !tokens[j + 1]!.used && !tokens[j + 1]!.punct && !lexicon.fillers.has(tokens[j + 1]!.norm)) { idx.push(j); continue; } break; }
      idx.push(j);
    }
    for (const k of idx) tokens[k]!.used = true;
    // Procedencia (país, gentilicio, ciudad): intention-v1 no la representa; queda pendiente sin preguntar.
    // El topónimo forma su propio fragmento para no arrastrar el resto («mala vibra sonora | perú»).
    const parts: { idx: number[]; origin: boolean }[] = [];
    for (const k of idx) {
      const origin = origins.has(tokens[k]!.norm);
      if (parts.at(-1)?.origin === origin) parts.at(-1)!.idx.push(k); else parts.push({ idx: [k], origin });
    }
    for (const part of parts) {
      const first = part.idx[0]!;
      // Cifras (BPM, compás, minutos) o atributos sin eje (colores): restricción que no se descarta.
      const unrepresentable = part.idx.some(k => /\d/u.test(tokens[k]!.norm) || unrepresentableWords.has(tokens[k]!.norm));
      if (!part.origin && unrepresentable) {
        spans.push({ id: nextId(), kind: "residual", text: origOf(part.idx), start: first, end: part.idx.at(-1)!, candidates: [], cue: "version", mode: "required", group: null });
        continue;
      }
      let back = first - 1;
      while (back >= 0 && ["la", "el", "los", "las", "un", "una", "mi", "mis"].includes(tokens[back]!.norm)) back--;
      const cue = part.origin ? "origin" : back >= 0 && activityCue.has(tokens[back]!.norm) ? "activity" : "none";
      spans.push({ id: nextId(), kind: "residual", text: origOf(part.idx), start: first, end: part.idx.at(-1)!, candidates: [], cue, mode: "required", group: null });
    }
    i = j - 1;
  }

  // 9. Alcance: negación hasta límite; preferencia hasta el final; «o» agrupa vecinos.
  for (const sp of spans) { const a = tokens[sp.start], b = tokens[sp.end]; if (a && b) { sp.charStart = a.at; sp.charEnd = b.at + b.orig.length; } }
  spans.sort((a, b) => a.start - b.start);
  operators.sort((a, b) => a.at - b.at);
  let negated = false, preferred = false, groupSeq = 0, negatedSpans = 0;
  let lastSpan: Span | null = null;
  let pendingOr = false;
  const events = [...operators.map(o => ({ at: o.at, op: o })), ...spans.map(s => ({ at: s.start, span: s }))].sort((a, b) => a.at - b.at);
  let andCount = 0, orCount = 0, connectorsBetweenSpans = 0;
  let lastOp: string | null = null;
  for (const e of events) {
    if ("op" in e && e.op) {
      const type = e.op.type;
      const prevOp = lastOp; lastOp = type;
      if (type === "clause" && prevOp === "or") continue;
      if (type === "negation") { negated = true; negatedSpans = 0; }
      // «para …» abre otra cláusula: cierra una negación que ya alcanzó algún fragmento.
      else if (type === "clause") { if (negatedSpans > 0) negated = false; if (lastOp !== "or") pendingOr = false; }
      else if (type === "preference") { preferred = true; negated = false; }
      else if (type === "boundary" || type === "punct") { negated = false; pendingOr = false; }
      else if (type === "or") { pendingOr = true; orCount++; }
      else if (type === "and") { andCount++; const next = events.find(x => x.at > e.at); if (!(next && "op" in next && next.op?.type === "negation")) negated = false; }
      continue;
    }
    lastOp = null;
    const s = (e as { span: Span }).span;
    if (["listener", "comparative"].includes(s.kind)) { lastSpan = null; pendingOr = false; continue; }
    if (s.kind === "entity") { lastSpan = null; continue; }
    s.mode = preferred ? "preferred" : negated ? "excluded" : "required";
    if (preferred && negated) s.negated = true;
    if (s.mode === "excluded") negatedSpans++;
    if (pendingOr && lastSpan && lastSpan.mode === s.mode) {
      if (!lastSpan.group) lastSpan.group = `G${++groupSeq}`;
      s.group = lastSpan.group;
    }
    if (lastSpan) connectorsBetweenSpans++;
    pendingOr = false;
    lastSpan = s;
  }
  absorbCompanions();
  const conditionSpans = spans.filter(s => !["listener", "comparative", "entity"].includes(s.kind));
  const structure = {
    orAndMixed: orCount > 0 && andCount > 0 && conditionSpans.length >= 3 && !operators.some(o => o.type === "punct" || o.type === "boundary" || o.type === "preference") && connectorsBetweenSpans > 0
      && conditionSpans.every(sp => sp.mode === conditionSpans[0]!.mode),
    parentheses: tokens.some(t => t.orig === "(") && tokens.some(t => t.orig === ")"),
  };
  /**
   * 9b. Lo que acompaña a un pedido sin pedir nada a la música (1.3.0; desarrollo: prueba 3.0.0).
   * - Tras una actividad o un «para …» reconocido, el resto de la cláusula sin palabras del léxico ni
   *   atributos es circunstancia: «para correr media hora», «para leer un libro con un café».
   * - Un verbo auxiliar ante la actividad: «para salir a trotar», «que inviten a bailar», «para prender la fiesta».
   * - En una enumeración de temas, lo que acompaña al tema reconocido es parte del mismo asunto:
   *   «ansiedad, depresión y salud mental», «guerras y soldados en el frente».
   * - Los atributos no representables coordinados forman una sola restricción pendiente:
   *   «con saxofón y batería», «grabaciones en vivo que suenen como en el concierto».
   * Lo negado o preferido nunca se absorbe.
   */
  function absorbCompanions() {
    const opsBetween = (a: number, b: number) => operators.filter(o => o.at > a && o.at < b);
    const only = (a: number, b: number, ok: (o: Op) => boolean) => opsBetween(a, b).every(ok);
    const isCon = (o: Op) => o.type === "and" && tokens[o.at]!.norm === "con";
    const isCoord = (o: Op) => (o.type === "and" && tokens[o.at]!.norm !== "con") || (o.type === "punct" && tokens[o.at]!.orig === ",");
    const free = (sp: Span) => sp.kind === "residual" && ["none", "activity", "theme"].includes(sp.cue) && sp.mode === "required";
    const isAttr = (sp: Span) => sp.kind === "residual" && sp.cue === "version";
    const afterPara = (sp: Span) => { let b = sp.start - 1; while (b >= 0 && ["la", "el", "los", "las", "un", "una", "mi", "mis"].includes(tokens[b]!.norm)) b--; return b >= 0 && activityCue.has(tokens[b]!.norm); };
    const activityLike = (sp: Span) => ["concept", "ambiguous"].includes(sp.kind) && (sp.cue === "activity" || afterPara(sp) || sp.candidates.every(c => c.startsWith("activity:")));
    const themeLike = (sp: Span) => ["concept", "ambiguous"].includes(sp.kind) && sp.candidates.length > 0 && sp.candidates.every(c => c.startsWith("theme:"));
    const ordered = [...spans].sort((a, b) => a.start - b.start);
    const drop = new Set<Span>();
    // Compañía o lugar de otra actividad («para la fiesta con los panas», «bailar en reunión familiar»):
    // circunstancia, no encuentro social pedido (1.4.0; convención de 4.0.0).
    const introducedBy = (sp: Span, words: string[]) => {
      if (words.includes(tokens[sp.start]!.norm)) return true;
      let b = sp.start - 1; while (b >= 0 && ["la", "el", "los", "las", "un", "una", "mi", "mis", "unos", "unas"].includes(tokens[b]!.norm)) b--;
      return b >= 0 && words.includes(tokens[b]!.norm);
    };
    const social = (sp: Span) => sp.kind === "concept" && sp.candidates.length === 1 && sp.candidates[0] === "activity:socializing";
    for (const sp of ordered) {
      if (!social(sp) || sp.mode !== "required" || !introducedBy(sp, ["con", "en"])) continue;
      if (ordered.some(o => o !== sp && !social(o) && o.mode === "required" && ["concept", "ambiguous"].includes(o.kind) && o.candidates.every(c => c.startsWith("activity:")))) drop.add(sp);
    }
    for (let k = 0; k < ordered.length; k++) {
      const sp = ordered[k]!;
      if (!free(sp)) continue;
      const prev = ordered[k - 1], next = ordered[k + 1];
      // Circunstancia tras una actividad (o tras otra circunstancia ya absorbida).
      if (prev && (activityLike(prev) || drop.has(prev)) && only(prev.end, sp.start, o => isCon(o) || o.type === "clause")) { drop.add(sp); continue; }
      // Verbo auxiliar ante la actividad.
      if (next && activityLike(next) && sp.end - sp.start <= 2 && opsBetween(sp.end, next.start).length === 0 && (sp.cue === "activity" || tokens[sp.start - 1]?.norm === "que")) { drop.add(sp); continue; }
    }
    // Enumeración temática: grupos de fragmentos unidos solo por «y» o comas.
    let group: Span[] = [];
    const flush = () => {
      const lexical = group.filter(x => x.kind !== "residual");
      if (lexical.length && lexical.every(themeLike)) for (const x of group) if (free(x)) drop.add(x);
      group = [];
    };
    for (const sp of ordered) {
      const last = group.at(-1);
      if (last && !only(last.end, sp.start, isCoord)) flush();
      if (["listener", "comparative", "entity", "similarity", "decade"].includes(sp.kind)) { flush(); continue; }
      group.push(sp);
    }
    flush();
    // Atributos coordinados y lo que los acompaña en su cláusula: una sola restricción.
    for (let k = 0; k < ordered.length; k++) {
      const a = ordered[k]!;
      if (!isAttr(a) || drop.has(a)) continue;
      for (let q = k + 1; q < ordered.length; q++) {
        const b = ordered[q]!;
        const between = opsBetween(ordered[q - 1]!.end, b.start);
        const joinable = isAttr(b) ? between.every(o => isCoord(o) || isCon(o)) : free(b) && between.length === 0;
        if (!joinable || b.mode !== a.mode) break;
        drop.add(b); a.end = b.end; if (b.charEnd !== undefined) a.charEnd = b.charEnd; a.text = text.slice(a.charStart!, a.charEnd!);
      }
    }
    for (let k = spans.length - 1; k >= 0; k--) if (drop.has(spans[k]!)) spans.splice(k, 1);
  }
  return { version: "crv-query-segmenter-0.1.0", lexicon: lexicon.doc.version, text, normalized: normalizeQueryText(text), spans, wholeQueryMatches, structure, listenerStates, soundDescription };
}
