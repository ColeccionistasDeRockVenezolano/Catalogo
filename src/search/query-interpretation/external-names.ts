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
export const EXTERNAL_VERSION = "crv-external-names-0.2.0";

export interface ExternalRaw { artists: { name: string; fans: number }[]; tracks?: { title: string; rank: number }[] }
export interface ExternalHit { kind: "artist"; name: string; popularity: number; source: "deezer" }
export interface ExternalThresholds { externalArtistFans: number; externalCommonWordFans: number; externalBudgetMs: number }
export const DEFAULT_EXTERNAL: ExternalThresholds = { externalArtistFans: 1000, externalCommonWordFans: 90000, externalBudgetMs: 400 };

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
export async function lookupDeezer(literal: string, budgetMs = DEFAULT_EXTERNAL.externalBudgetMs): Promise<Lookup> {
  const url = `https://api.deezer.com/search/artist?limit=10&q=${encodeURIComponent(literal)}`;
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
      return { raw: { artists: (body.data ?? []).map(x => ({ name: String(x["name"]), fans: Number(x["nb_fan"] ?? 0) })) }, ms };
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
  get(literal: string) { return this.entries[catalogKey(literal)]; }
  async resolve(literal: string, live: boolean) {
    const hit = this.get(literal);
    if (hit || !live) return hit;
    const r = await lookupDeezer(literal, this.budgetMs);
    if (r.error) this.failures++;
    return (this.entries[catalogKey(literal)] = { raw: r.raw, ms: r.ms, at: new Date().toISOString(), ...(r.error ? { error: r.error } : {}) });
  }
  save() { writeFileSync(this.file, JSON.stringify(this.entries)); }
}
