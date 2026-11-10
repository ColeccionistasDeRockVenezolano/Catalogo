import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { bareNameLiteral, catalogKey, type Segmentation } from "./segmenter.js";

// Etapa 3, versión 1.7.0 (decisión de Brian, 2026-11-10: «Nombres externos»).
// Un resto que el catálogo no resuelve se consulta en la búsqueda pública de artistas de Deezer (sin clave).
// Spotify queda fuera: su cuota tiene un único dueño (ops/spotify-diario).
// La popularidad sola no separa nombres de palabras («latino» tiene 33.172 fans y «willyrex», 3.943), así
// que un resto hecho solo de palabras del diccionario exige un artista muy conocido («led zeppelin»,
// «paradise lost»); uno con una palabra ajena al diccionario («willyrex», «cecilia todd») basta con el mínimo.
// Sin diccionario la regla queda apagada (nunca se adivina). Desarrollo: t2, h1t, h1r.
// 0.3.0 (1.8.0): también el tramo libre entero de la consulta («yo quiero un héroe», «jesse y joy»), que el
// segmentador parte en restos, y la búsqueda de canciones (/search/track) con el mismo criterio de popularidad.
export const EXTERNAL_VERSION = "crv-external-names-0.3.0";

export interface ExternalRaw { artists: { name: string; fans: number }[]; tracks?: { title: string; rank: number; artist: string }[] }
/** `weak`: artista exacto con pocos fans; no basta para nombrar un resto, solo confirma «género + nombre». */
export interface ExternalHit { kind: "artist" | "track"; name: string; popularity: number; source: "deezer"; weak?: boolean }
export interface ExternalThresholds { externalArtistFans: number; externalCommonWordFans: number; externalBudgetMs: number; externalTrackRank: number; externalCommonTrackRank: number; externalWeakFans: number }
export const DEFAULT_EXTERNAL: ExternalThresholds = { externalArtistFans: 1000, externalCommonWordFans: 90000, externalBudgetMs: 400, externalTrackRank: 30000, externalCommonTrackRank: 30000, externalWeakFans: 20 };

export const DICTIONARY_FILES = (process.env["CRV_STAGE3_DICTIONARIES"] ?? "/usr/share/dict/spanish:/usr/share/dict/american-english").split(":").filter(Boolean);

export interface Dictionary { words: Set<string>; files: { path: string; sha256: string }[] }
let dictionary: Dictionary | null | undefined;
/** Palabras comunes (entradas en minúscula de los diccionarios del sistema, sin tildes). */
export function loadDictionary(files = DICTIONARY_FILES): Dictionary | null {
  if (dictionary !== undefined && files === DICTIONARY_FILES) return dictionary;
  const words = new Set<string>(), meta: Dictionary["files"] = [];
  for (const path of files) {
    if (!existsSync(path)) { if (files === DICTIONARY_FILES) dictionary = null; return null; }
    const buf = readFileSync(path);
    meta.push({ path, sha256: createHash("sha256").update(buf).digest("hex") });
    for (const line of buf.toString("utf8").split("\n")) {
      const w = line.trim().replace(/'s$/u, "");
      if (w && w[0] === w[0]!.toLowerCase()) words.add(catalogKey(w));
    }
  }
  const out = { words, files: meta };
  if (files === DICTIONARY_FILES) dictionary = out;
  return out;
}

/** Textos que se consultan fuera: los nombres que pueden acabar como entidad y los restos sin resolver. */
export function externalCandidates(seg: Segmentation): string[] {
  const out = new Set<string>();
  const bare = bareNameLiteral(seg);
  if (bare) out.add(bare);
  for (const s of seg.spans) {
    if ((s.kind === "entity" || s.kind === "similarity") && s.entity && !s.entity.matches.length) out.add(s.entity.literal);
    else if (s.kind === "residual" && s.mode !== "excluded" && !s.negated && s.cue !== "origin" && s.cue !== "activity") out.add(s.text);
  }
  return [...out].filter(l => catalogKey(l));
}

/** Tramo de nombre: palabras seguidas (sin puntuación) que no son del léxico, con al menos un resto, sin las
 * palabras de pedido de los bordes; también unido a una sola frase del léxico vecina («gangsta paradise»,
 * «we will rock you»). Nunca cruza un nombre ya hallado, una procedencia ni una exclusión. */
/** `cued`: el tramo va tras «para», «con», «en» o «sin»: es la ocasión o el acompañamiento, no un título. */
export interface NameRun { literal: string; spans: string[]; words: number; cued: boolean }
const RUN_CUES = new Set(["para", "pa", "pal", "con", "sin", "en", "for"]);
const RUN_EDGE = new Set(["musica", "canciones", "cancion", "temas", "tema", "playlist", "lista", "mix", "rolas", "de", "del", "para", "pa", "con", "en", "y", "o", "e", "tipo", "videos", "video", "nueva", "nuevas", "vieja", "viejas", "viejitas"]);
export function nameRuns(seg: Segmentation, max = 4): NameRun[] {
  const words = [...seg.text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)].map(m => ({ at: m.index!, end: m.index! + m[0].length, norm: catalogKey(m[0]) }));
  const spanAt = (w: { at: number; end: number }) => seg.spans.find(s => s.charStart !== undefined && w.at >= s.charStart && w.end <= s.charEnd!);
  type W = (typeof words)[number] & { span: Segmentation["spans"][number] | undefined; label: "res" | "lex" | "free" | "stop" };
  const labeled: W[] = words.map(w => {
    const span = spanAt(w);
    // «música como pasó»: un parecido débil sin referencia conocida puede ser el título entero («como» incluido).
    const weakLike = span?.kind === "similarity" && !span.entity?.matches.length && /^(?:como|cómo)\s/iu.test(seg.text.slice(span.charStart ?? 0));
    const label: W["label"] = !span ? "free" : weakLike ? "res" : span.kind === "residual" ? (span.mode !== "required" || span.negated || span.cue === "origin" ? "stop" : "res")
      : ["concept", "genre", "ambiguous", "facet", "decade"].includes(span.kind) && span.mode === "required" && !span.negated ? "lex" : "stop";
    return { ...w, span, label };
  });
  // Grupos sin puntuación entre palabras.
  const groups: W[][] = [];
  labeled.forEach((w, i) => { const prev = labeled[i - 1]; if (prev && /^\s+$/u.test(seg.text.slice(prev.end, w.at)) && groups.length) groups.at(-1)!.push(w); else groups.push([w]); });
  const out = new Map<string, NameRun>();
  const add = (ws: W[], g: W[]) => {
    let a = 0, b = ws.length;
    while (a < b && ws[a]!.label !== "lex" && RUN_EDGE.has(ws[a]!.norm)) a++;
    while (b > a && ws[b - 1]!.label !== "lex" && RUN_EDGE.has(ws[b - 1]!.norm)) b--;
    const part = ws.slice(a, b);
    if (!part.some(w => w.label === "res") || part[0]!.label === "lex" && part.at(-1)!.label === "lex") return;
    // Unido a una frase del léxico, solo un título largo («we will rock you»): «dancehall queen», «darkwave sabbat» no.
    if (part.some(w => w.label === "lex") && part.length < 3) return;
    const literal = seg.text.slice(part[0]!.at, part.at(-1)!.end);
    const key = catalogKey(literal);
    // Tras «para»/«con» en la misma cláusula («para leer la biblia», «para bailar día de muertos»).
    const cued = g.slice(0, g.indexOf(part[0]!)).some(w => RUN_CUES.has(w.norm));
    if (key && !out.has(key)) out.set(key, { literal, spans: [...new Set(part.flatMap(w => w.span ? [w.span.id] : []))], words: part.length, cued });
  };
  for (const g of groups) {
    // Tramos libres: corridas de restos y palabras sueltas, cortadas por el léxico o por lo que no se cruza.
    const pieces: { ws: W[]; lex: boolean }[] = [];
    for (const w of g) {
      if (w.label === "stop") { pieces.push({ ws: [], lex: false }); continue; }
      const lex = w.label === "lex";
      const last = pieces.at(-1);
      if (last && last.lex === lex && last.ws.length && (!lex || last.ws.at(-1)!.span === w.span)) last.ws.push(w); else pieces.push({ ws: [w], lex });
    }
    pieces.forEach((p, i) => {
      if (p.lex || !p.ws.length) return;
      add(p.ws, g);
      const prev = pieces[i - 1], next = pieces[i + 1], after = pieces[i + 2];
      if (prev?.lex) add([...prev.ws, ...p.ws], g);
      if (next?.lex) add([...p.ws, ...next.ws], g);
      if (next?.lex && after && !after.lex && after.ws.length) add([...p.ws, ...next.ws, ...after.ws], g);
    });
  }
  return [...out.values()].sort((x, y) => y.words - x.words).slice(0, max);
}

const wordCount = (key: string) => key.split(" ").filter(Boolean).length;
/** Título de canción sin lo que va entre paréntesis ni la coletilla tras « - » («Golden (from KPop…)»). */
const cleanTitle = (t: string) => t.replace(/\([^)]*\)|\[[^\]]*\]/gu, " ").replace(/\s-\s.*$/u, "");
/** Canción con el título exacto del tramo y el ranking de Deezer que exige su texto. */
export function decideTrack(literal: string, raw: ExternalRaw | undefined | null, th: ExternalThresholds = DEFAULT_EXTERNAL, dict = loadDictionary()): ExternalHit | null {
  if (!raw?.tracks || !dict) return null;
  const key = catalogKey(literal);
  const foreign = key.split(" ").some(w => w.length >= 4 && !/^\d+$/u.test(w) && !dict.words.has(w));
  const min = foreign ? th.externalTrackRank : th.externalCommonTrackRank;
  // Una sola palabra casi nunca es el título pedido («animales», «gritos», «classic»): desarrollo 1.8.0.
  if (wordCount(key) < 2 || /\d/u.test(key)) return null;
  const track = raw.tracks.filter(t => catalogKey(cleanTitle(t.title)) === key && t.rank >= min).sort((a, b) => b.rank - a.rank)[0];
  return track ? { kind: "track", name: track.title, popularity: track.rank, source: "deezer" } : null;
}

/** Coincidencia exacta de artista (misma clave que el catálogo) con la popularidad que exige su texto. */
export function decideExternal(literal: string, raw: ExternalRaw | undefined | null, th: ExternalThresholds = DEFAULT_EXTERNAL, dict = loadDictionary()): ExternalHit | null {
  if (!raw || !dict) return null;
  const key = catalogKey(literal);
  const words = key.split(" ").filter(Boolean);
  const foreign = words.some(w => w.length >= 4 && !/^\d+$/u.test(w) && !dict.words.has(w));
  const min = foreign ? th.externalArtistFans : th.externalCommonWordFans;
  const artist = raw.artists.filter(a => catalogKey(a.name) === key && a.fans >= min).sort((a, b) => b.fans - a.fans)[0];
  return artist ? { kind: "artist", name: artist.name, popularity: artist.fans, source: "deezer" } : null;
}
/** Artista exacto con al menos `externalWeakFans` (1.8.0, «género + nombre»: «hernán marín» tiene 27). */
export function decideWeakArtist(literal: string, raw: ExternalRaw | undefined | null, th: ExternalThresholds = DEFAULT_EXTERNAL): ExternalHit | null {
  const key = catalogKey(literal);
  const artist = raw?.artists.filter(a => catalogKey(a.name) === key && a.fans >= th.externalWeakFans).sort((a, b) => b.fans - a.fans)[0];
  return artist ? { kind: "artist", name: artist.name, popularity: artist.fans, source: "deezer", weak: true } : null;
}

// Evaluación en lote: un arranque cada 110 ms (≈45 peticiones cada 5 s, bajo el límite de 50 de Deezer).
// La espera del limitador no cuenta como latencia: una búsqueda aislada no la sufre.
let nextSlot = 0;
async function throttle(gapMs = 110) {
  const now = performance.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + gapMs;
  if (wait) await new Promise(r => setTimeout(r, wait));
}

export interface Lookup { raw: ExternalRaw | null; ms: number; error?: string }
/**
 * Búsqueda de artistas con presupuesto de tiempo: lo que no llega dentro de `budgetMs` no cuenta (sin nombre
 * externo), como en producción, y `ms` es el presupuesto. Solo se reintenta un rechazo por ritmo de la CDN
 * (HTML, 429 o código 4), que es propio de la evaluación en lote; se mide el intento que responde.
 */
export async function lookupDeezer(literal: string, budgetMs = DEFAULT_EXTERNAL.externalBudgetMs, kind: "artist" | "track" = "artist"): Promise<Lookup> {
  const url = `https://api.deezer.com/search/${kind}?limit=10&q=${encodeURIComponent(literal)}`;
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const t0 = performance.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(budgetMs), headers: { "user-agent": "crv-search-stage3/1.7.0" } });
      const text = await res.text();
      const ms = performance.now() - t0;
      const body = res.ok && text.trimStart().startsWith("{") ? JSON.parse(text) as { data?: Record<string, unknown>[]; error?: { code?: number } } : null;
      if ((!body || body.error?.code === 4) && attempt < 4) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
      if (!body || body.error) return { raw: null, ms, error: body ? JSON.stringify(body.error) : `HTTP ${res.status}` };
      const data = body.data ?? [];
      return { raw: kind === "artist" ? { artists: data.map(x => ({ name: String(x["name"]), fans: Number(x["nb_fan"] ?? 0) })) }
        : { artists: [], tracks: data.map(x => ({ title: String(x["title"]), rank: Number(x["rank"] ?? 0), artist: String((x["artist"] as Record<string, unknown> | undefined)?.["name"] ?? "") })) }, ms };
    } catch (e) {
      return { raw: null, ms: Math.min(performance.now() - t0, budgetMs), error: (e as Error).name };
    }
  }
}

/** Caché en archivo por clave normalizada. Una evaluación reservada empieza con una caché vacía. */
export class ExternalNameCache {
  private readonly entries: Record<string, { raw: ExternalRaw | null; ms: number; at: string; error?: string }>;
  failures = 0;
  constructor(private readonly file: string, private readonly budgetMs = DEFAULT_EXTERNAL.externalBudgetMs) {
    this.entries = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  }
  /** Las canciones se guardan con el prefijo «track:» junto a los artistas. */
  get(literal: string, kind: "artist" | "track" = "artist") { return this.entries[(kind === "track" ? "track:" : "") + catalogKey(literal)]; }
  async resolve(literal: string, live: boolean, kind: "artist" | "track" = "artist") {
    const hit = this.get(literal, kind);
    if (hit || !live) return hit;
    const r = await lookupDeezer(literal, this.budgetMs, kind);
    if (r.error) this.failures++;
    return (this.entries[(kind === "track" ? "track:" : "") + catalogKey(literal)] = { raw: r.raw, ms: r.ms, at: new Date().toISOString(), ...(r.error ? { error: r.error } : {}) });
  }
  save() { writeFileSync(this.file, JSON.stringify(this.entries)); }
}
