/**
 * Etapa 3 · composición de consultas etiquetadas para entrenar, validar y calibrar Laya.
 *   compose <bank.jsonl[,suplemento.jsonl]> <outDir> [--seed 7] [--train 6000 --val 900 --calib 900]
 *   tasks   <dataset.json> <tasks.jsonl>      preguntas con su respuesta esperada (entrenamiento)
 *   tasks-human <query-real-human-train-1.json> <tasks.jsonl>
 *           preguntas derivadas de etiquetas humanas de consulta completa (versión 1.6.0); solo
 *           las que la etiqueta decide sin ambigüedad. Nunca recibe la partición de prueba.
 * Cada fragmento tiene etiqueta por construcción; las frases del banco se reparten entre
 * conjuntos por huella, así que una frase nunca aparece en dos conjuntos. No lee la prueba reservada.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadQueryLexicon, normalizeQueryText } from "../src/search/query-interpretation/lexicon.js";
import { segmentQuery, catalogKey, type Segmentation } from "../src/search/query-interpretation/segmenter.js";
import { loadCatalogSnapshot } from "../src/search/query-interpretation/catalog.js";
import { buildQuestions, DESCRIBE_KEY, NOT_REQUESTED, OTHER, UNCLEAR } from "../src/search/query-interpretation/questions.js";
import type { QueryGold } from "../src/search/query-interpretation/evaluation.js";

const CATALOG = process.env["CRV_STAGE3_CATALOG"] ?? `${process.env["HOME"]}/.cache/crv-stage3/catalog-names-2026-10-25.json`;
const lexicon = loadQueryLexicon();
const catalog = loadCatalogSnapshot(CATALOG);
const [cmd, input, output, ...rest] = process.argv.slice(2);
const opt = (n: string, d: number) => { const i = rest.indexOf(n); return i >= 0 ? Number(rest[i + 1]) : d; };

type Cls = "concept" | "facet" | "genre_description" | "listener" | "unsupported" | "filler" | "genre" | "ambiguous" | "entity" | "similarity";
interface Frag { text: string; cls: Cls; label: string; mode: "required" | "excluded" | "preferred"; group: string | null; start?: number; end?: number }
interface Case { id: string; category: string; text: string; gold: QueryGold; split: string; fragments: Frag[]; kindGold?: string }
type Split = "train" | "val" | "calib";

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const splitOf = (text: string): Split => { const h = createHash("sha256").update(normalizeQueryText(text)).digest()[0]! / 256; return h < 0.7 ? "train" : h < 0.85 ? "val" : "calib"; };

/** Una frase del banco se conserva solo si el segmentador no le encuentra otro significado. */
function keep(row: { text: string; class: string; label: string }): boolean {
  const seg = segmentQuery(row.text, lexicon, catalog);
  if (seg.spans.some(s => ["entity", "similarity", "decade", "comparative"].includes(s.kind))) return false;
  const lex = seg.spans.filter(s => ["concept", "genre", "facet", "ambiguous"].includes(s.kind));
  if (row.class === "listener") return seg.listenerStates === 1 && lex.length === 0 && seg.spans.filter(s => s.kind === "residual").length === 0;
  if (seg.listenerStates) return false;
  if (["unsupported", "filler", "genre_description"].includes(row.class)) return lex.length === 0;
  if (row.class === "concept" || row.class === "facet") return lex.every(s => s.candidates.includes(row.label)) && (lex.length > 0 || seg.spans.filter(s => s.kind === "residual").length === 1);
  return false;
}

if (cmd === "compose") {
  const rand = rng(opt("--seed", 7));
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const bank = input!.split(",").flatMap(f => readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as { text: string; class: string; label: string; sub?: string; pair?: string }));
  const kept = bank.filter(keep);
  const pools: Record<Split, Map<string, typeof kept>> = { train: new Map(), val: new Map(), calib: new Map() };
  for (const r of kept) { const p = pools[splitOf(r.text)]; const k = r.sub === "circumstance" ? "circumstance|circumstance" : r.sub === "elaboration" ? `elaboration|${r.pair}` : `${r.class}|${r.class === "concept" || r.class === "facet" || r.class === "genre_description" ? r.label : r.class}`; p.set(k, [...(p.get(k) ?? []), r]); }
  // Formas cortas (alias del léxico) para negar o preferir; nombres de género; nombres reales del catálogo.
  const shortForms = lexicon.doc.concepts.flatMap(c => c.dimension === "theme" ? c.themeNouns.slice(0, 2).map(n => ({ text: `sobre ${n}`, label: c.id })) : c.aliases.filter(a => a.split(" ").length <= 3).map(a => ({ text: a, label: c.id })));
  const genreNames = lexicon.doc.genres.filter(g => g.mapStatus !== "excluded_by_decision").map(g => ({ text: g.name.toLowerCase(), label: `genre:${g.slug}` }))
    .filter(g => { const s = segmentQuery(g.text, lexicon, catalog); return s.spans.length === 1 && s.spans[0]!.kind === "genre" && s.spans[0]!.candidates.length === 1 && s.spans[0]!.candidates[0] === g.label; });
  const snapshot = JSON.parse(readFileSync(CATALOG, "utf8")) as { names: Record<string, [number, string][]> };
  const artists = snapshot.names["artist"]!.map(([, n]) => n).filter(n => n.length >= 3 && n.length <= 30 && /^[\p{L}\p{N} .'&-]+$/u.test(n) && !segmentQuery(n, lexicon, catalog).spans.some(s => s.kind !== "residual"));
  const conceptWordTitles = [...new Set(lexicon.doc.concepts.flatMap(c => [...c.aliases, ...c.themeNouns]).filter(a => !a.includes(" ")))]
    .filter(w => catalog.lookup(w).some(x => x.kind === "track"));
  const ambiguousPhrases = lexicon.doc.ambiguous.map(a => a.phrase);
  const openers = ["", "", "", "quiero ", "busco ", "ponme ", "recomiéndame ", "dame ", "necesito "];
  const stripLead = (t: string) => t.replace(/^(m[uú]sica|canciones|temas|algo|songs|music|rolas)\s+/iu, "");
  const fromPool = (split: Split, key: string) => { const p = pools[split].get(key); return p?.length ? pick(p) : null; };
  const conceptKeys = (split: Split) => [...pools[split].keys()].filter(k => k.startsWith("concept|"));

  const build = (split: Split, n: number): Case[] => {
    const out: Case[] = [];
    let guard = 0;
    while (out.length < n && guard++ < n * 20) {
      const r = rand(); const frags: Frag[] = []; let category = "single"; let kindGold: string | undefined;
      const concept = (): Frag | null => { const row = fromPool(split, pick(conceptKeys(split))); return row ? { text: row.text, cls: "concept" as Cls, label: row.label, mode: "required" as const, group: null } : null; };
      const short = (): Frag => { const s = pick(shortForms); return { text: s.text, cls: "concept" as Cls, label: s.label, mode: "required" as const, group: null }; };
      const genre = (): Frag => { const g = pick(genreNames); return { text: g.text, cls: "genre" as Cls, label: g.label, mode: "required" as const, group: null }; };
      let text = "";
      const join = (fs: Frag[], seps: string[]) => {
        const lead = normalizeQueryText(fs[0]!.text);
        // Una descripción de sonido va sin encabezado de pedido: con «quiero…» sería un atributo pendiente (1.3.0).
        text = category === "whole_name" || category === "described" || fs[0]!.cls === "listener" || /^(quiero|busco|necesito|ponme|pon|dame|recomiendame|i |me |estoy|ando)/u.test(lead) ? "" : pick(openers);
        fs.forEach((f, i) => { if (i) text += seps[i - 1]!; const t = i ? (rand() < 0.7 ? stripLead(f.text) : f.text) : f.text; f.start = text.length; text += t; f.end = text.length; f.text = t; frags.push(f); });
      };
      if (r < 0.15) { const c = concept(); if (!c) continue; join([c], []); }
      else if (r < 0.22) { // Cláusula que refuerza el mismo pedido sin añadir otro (1.5.0): relleno.
        const keys = [...pools[split].keys()].filter(k => k.startsWith("elaboration|") && pools[split].has(`concept|${k.slice(12)}`));
        if (!keys.length) { const c = concept(); if (!c) continue; join([c], []); }
        else { category = "elaboration"; const k = pick(keys); const a = fromPool(split, `concept|${k.slice(12)}`)!, e = fromPool(split, k)!;
          join([{ text: a.text, cls: "concept", label: a.label, mode: "required", group: null }, { text: e.text, cls: "filler", label: "filler", mode: "required", group: null }], [pick([" ", " ", ", "])]); } }
      else if (r < 0.40) { category = "and"; const a = concept(), b = rand() < 0.5 ? concept() : genre(); if (!a || !b || a.label === b.label) continue; join(rand() < 0.5 ? [b, a] : [a, b], [pick([" y ", ", ", " ", " y que sea "])]); }
      else if (r < 0.47) { category = "and"; const a = genre(), b = concept(), c = concept(); if (!b || !c || b.label === c.label || b.label.split(":")[0] === "energy" && c.label.split(":")[0] === "energy") continue; join([a, b, c], [" ", pick([" y ", ", "])]); }
      else if (r < 0.53) { category = "or"; const a = short(); const same = shortForms.filter(s => s.label.split(":")[0] === a.label.split(":")[0] && s.label !== a.label); if (!same.length) continue; const b: Frag = { ...short(), ...pick(same) }; a.group = b.group = "G1"; join([a, b], [pick([" o ", " u ", " or "])]); }
      else if (r < 0.62) { category = "negation"; const a = rand() < 0.5 ? concept() : genre(); const b = rand() < 0.5 ? short() : genre(); if (!a || a.label === b.label) continue; b.mode = "excluded"; join([a, b], [pick([" sin ", " pero sin ", ", que no sea ", ", nada de ", " pero no ", " excepto "])]); }
      else if (r < 0.66) { category = "preference"; const a = concept(); const b = rand() < 0.5 ? short() : genre(); if (!a || a.label === b.label) continue; b.mode = "preferred"; join([a, b], [pick([", preferiblemente ", ", de preferencia ", ", mejor si es ", ", ojalá "])]); }
      else if (r < 0.73) { category = "listener"; const l = fromPool(split, "listener|listener"); const c = concept(); if (!l || !c) continue; join([{ text: l.text, cls: "listener", label: "listener", mode: "required", group: null }, c], [pick([", ", " y quiero ", ", ponme ", " pero quiero ", ", necesito "])]); }
      else if (r < 0.79) { category = "unsupported"; const c = rand() < 0.75 ? concept() : null; const kindKey = rand() < 0.55 ? "unsupported|unsupported" : pick([...pools[split].keys()].filter(k => k.startsWith("facet|"))); const u = fromPool(split, kindKey); if (!u) continue;
        const uf: Frag = { text: u.text, cls: u.class === "facet" ? "facet" : "unsupported", label: u.label, mode: "required", group: null }; join(c ? [c, uf] : [uf], [pick([" ", ", ", " y "])]); }
      else if (r < 0.84) { category = "described"; const g = fromPool(split, pick([...pools[split].keys()].filter(k => k.startsWith("genre_description|")))); if (!g) continue; join([{ text: stripLead(stripLead(g.text.replace(/^(quiero|busco|necesito|ponme|dame|recomi[eé]ndame)\s+/iu, ""))), cls: "genre_description", label: g.label, mode: "required", group: null }], []); }
      else if (r < 0.87) { category = "filler"; const f = fromPool(split, "filler|filler"); const c = concept(); if (!f || !c) continue; join(rand() < 0.5 ? [c, { text: f.text, cls: "filler", label: "filler", mode: "required", group: null }] : [{ text: f.text, cls: "filler", label: "filler", mode: "required", group: null }, c], [", "]); }
      else if (r < 0.90) { category = "circumstance"; const f = fromPool(split, "circumstance|circumstance"); const keys = conceptKeys(split).filter(k => k.startsWith("concept|activity:"));
        const a = keys.length ? fromPool(split, pick(keys)) : null; if (!f || !a) continue;
        join([{ text: a.text, cls: "concept", label: a.label, mode: "required", group: null }, { text: f.text, cls: "filler", label: "filler", mode: "required", group: null }], [pick([" ", " ", " con ", " en "])]); }
      else if (r < 0.92) { category = "clarify"; const a = pick(ambiguousPhrases); join([{ text: rand() < 0.5 ? `música ${a}` : `algo ${a}`, cls: "ambiguous", label: "unclear", mode: "required", group: null }], []); }
      else if (r < 0.955) { category = "entity"; const name = pick(artists); if (splitOf(name) !== split) continue; const form = pick([name, `temas de ${name}`, `la banda ${name}`, `canciones de ${name}`]);
        join([{ text: form, cls: "entity", label: name, mode: "required", group: null }], []); }
      else if (r < 0.985) { category = "similarity"; const name = pick(artists); if (splitOf(name) !== split) continue; const aspect = pick(["", "", " en las guitarras", " en la voz", " en la producción"]);
        join([{ text: `${pick(["algo parecido a", "parecido a", "similar a", "al estilo de"])} ${name}${aspect}`, cls: "similarity", label: `similarity:${aspect.includes("guitar") ? "guitars" : aspect.includes("voz") ? "voice" : aspect.includes("produc") ? "production" : "overall"}|${name}`, mode: "required", group: null }], []); }
      else {
        category = "whole_name";
        if (rand() < 0.5) { const g = pick(genreNames); if (!catalog.lookup(g.text).length) continue; join([{ text: g.text, cls: "genre", label: g.label, mode: "required", group: null }], []); kindGold = "music_request"; }
        else { const w = pick(conceptWordTitles); join([{ text: w, cls: "ambiguous", label: "unclear", mode: "required", group: null }], []); kindGold = UNCLEAR; }
      }
      const gold = goldOf(frags, text, kindGold);
      if (!gold) continue;
      out.push({ id: `${split}-${out.length + 1}`, category, text, gold, split, fragments: frags, ...(kindGold ? { kindGold } : {}) });
    }
    return out;
  };
  mkdirSync(output!, { recursive: true });
  const stats: Record<string, number> = { bank: bank.length, kept: kept.length };
  for (const [split, n] of [["train", opt("--train", 6000)], ["val", opt("--val", 900)], ["calib", opt("--calib", 900)]] as const) {
    const cases = build(split, n);
    stats[split] = cases.length;
    writeFileSync(`${output}/query-${split}.json`, JSON.stringify({ version: `crv-query-${split}-0.1.0`, source: "bank-0.2.0 + léxico 0.1.0 + catálogo 2026-10-25", policy: "Generado; desarrollo, entrenamiento o calibración. No es prueba final.", cases }, null, 0));
  }
  console.log(JSON.stringify(stats));
} else if (cmd === "tasks") {
  const dataset = JSON.parse(readFileSync(input!, "utf8")) as { cases: Case[] };
  const lines: string[] = [];
  let dropped = 0;
  for (const c of dataset.cases) {
    const seg = segmentQuery(c.text, lexicon, catalog);
    for (const t of buildQuestions(seg, lexicon)) {
      const gold = expected(c, seg, t.key, t.family, t.spanId, Object.keys(t.question.criteria));
      if (!gold) { dropped++; continue; }
      lines.push(JSON.stringify({ qid: c.id, key: t.key, family: t.family, state: t.state, question: t.question, gold, group: c.fragments.map(f => normalizeQueryText(f.text)).join("|") }));
    }
  }
  writeFileSync(output!, lines.join("\n") + "\n");
  console.log(JSON.stringify({ cases: dataset.cases.length, tasks: lines.length, dropped }));
} else if (cmd === "tasks-human") {
  const dataset = JSON.parse(readFileSync(input!, "utf8")) as { cases: { id: string; text: string; gold: QueryGold; split: string }[] };
  if (dataset.cases.some(c => c.split !== "train_real_human")) { console.error("tasks-human solo admite la partición train_real_human"); process.exit(2); }
  const lines: string[] = [], stats: Record<string, number> = { cases: dataset.cases.length, tasks: 0, dropped: 0 };
  for (const c of dataset.cases) {
    const seg = segmentQuery(c.text, lexicon, catalog);
    const answers = humanAnswers(c.gold, seg);
    for (const t of buildQuestions(seg, lexicon)) {
      const gold = answers(t.key, t.family, t.spanId, Object.keys(t.question.criteria));
      if (!gold) { stats["dropped"]!++; continue; }
      stats["tasks"]!++; stats[`family:${t.family}`] = (stats[`family:${t.family}`] ?? 0) + 1;
      lines.push(JSON.stringify({ qid: c.id, key: t.key, family: t.family, state: t.state, question: t.question, gold, group: normalizeQueryText(c.text) }));
    }
  }
  writeFileSync(output!, lines.join("\n") + "\n");
  console.log(JSON.stringify(stats));
} else { console.error("uso: compose|tasks|tasks-human"); process.exit(2); }

function goldOf(frags: Frag[], text: string, kindGold?: string): QueryGold | null {
  const g: QueryGold = { status: "query_valid", req: [], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 0, alts: [], facet: null };
  const groups = new Map<string, string[]>();
  let clarify = false, described = false;
  for (const f of frags) {
    if (f.cls === "concept" || f.cls === "genre") {
      if (f.group) groups.set(f.group, [...(groups.get(f.group) ?? []), f.label]);
      else (f.mode === "excluded" ? g.exc : f.mode === "preferred" ? g.pref : g.req).push(f.label);
    } else if (f.cls === "listener") g.ctx++;
    else if (f.cls === "unsupported") g.pending++;
    else if (f.cls === "facet") { g.pending++; g.facet = f.label; }
    else if (f.cls === "genre_description") { described = true; g.alts.push(f.label); }
    else if (f.cls === "ambiguous") clarify = true;
    else if (f.cls === "entity") g.ent.push({ role: "target", kind: null, literal: normalizeLiteral(f.label) });
    else if (f.cls === "similarity") { const [c, name] = f.label.split("|"); g.req.push(c!); g.ent.push({ role: "reference", kind: null, literal: normalizeLiteral(name!) }); }
  }
  g.any = [...groups.values()].map(x => [...new Set(x)].sort());
  if (new Set([...g.req, ...g.any.flat()]).size !== g.req.length + g.any.flat().length) return null;
  if (g.req.some(x => g.exc.includes(x))) return null;
  const hasCond = g.req.length + g.exc.length + g.any.length + g.pref.length > 0;
  if (kindGold === "music_request") g.status = "query_valid";
  else if (clarify) { g.status = "clarify"; g.req = []; g.exc = []; g.any = []; g.pref = []; if (kindGold) g.ent = [{ role: "target", kind: null, literal: normalizeLiteral(text) }]; }
  else if (described && !hasCond) g.status = "clarify";
  else if (!hasCond && g.ent.some(e => e.role === "target")) g.status = "entity_lookup";
  else if (hasCond) g.status = g.pending || described ? "partial" : "query_valid";
  else if (g.pending) g.status = "unsupported";
  else g.status = "unrecognized";
  for (const k of ["req", "exc", "pref", "alts"] as const) g[k] = [...new Set(g[k])].sort();
  return g;
}
function normalizeLiteral(t: string) { return t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim(); }

/** Respuesta esperada de una pregunta según el fragmento compuesto que cubre el fragmento segmentado. */
function expected(c: Case, seg: Segmentation, key: string, family: string, spanId: string | null, options: string[]): string | null {
  if (family === "query_kind") return c.kindGold ?? null;
  if (key === DESCRIBE_KEY) { const d = c.fragments.find(f => f.cls === "genre_description"); return d && options.includes(d.label) ? d.label : OTHER; }
  const span = seg.spans.find(s => s.id === spanId);
  if (!span || span.charStart === undefined) return null;
  let best: Frag | null = null, overlap = 0;
  for (const f of c.fragments) {
    const o = Math.min(f.end!, span.charEnd!) - Math.max(f.start!, span.charStart);
    if (o > overlap) { overlap = o; best = f; }
  }
  if (!best) return null;
  const axis = best.label.split(":")[0]!;
  // Resto de un fragmento cuyo significado ya lo cubre otro fragmento del léxico: no pide nada más.
  if (span.kind === "residual" && (best.cls === "concept" || best.cls === "genre" || best.cls === "facet")) {
    const covered = seg.spans.some(o => o.id !== span.id && o.charStart !== undefined && o.candidates.includes(best!.label)
      && Math.min(best!.end!, o.charEnd!) > Math.max(best!.start!, o.charStart));
    if (covered) return family === "dim" ? (options.includes("filler") ? "filler" : null) : family === "pick" || family === "genre_description" || family === "facet_family" ? OTHER : null;
  }
  if (family === "span") {
    if ((best.cls === "concept" || best.cls === "genre") && options.includes(best.label)) return best.label;
    if (best.cls === "ambiguous") return UNCLEAR;
    if (["filler", "unsupported", "listener", "genre_description", "entity"].includes(best.cls)) return NOT_REQUESTED;
    if (best.cls === "facet" && options.includes(best.label)) return best.label;
    return null;
  }
  if (family === "dim") {
    const map: Partial<Record<Cls, string>> = { facet: "technical_facet", genre_description: "genre_description", unsupported: "unsupported", filler: "filler" };
    const d = best.cls === "concept" ? axis : map[best.cls];
    return d && options.includes(d) ? d : null;
  }
  // En los ejes ajenos la respuesta correcta es «other»: el compilador solo lee el eje elegido por dim,
  // pero el modelo debe aprender a no forzar un concepto.
  if (family === "pick") return best.cls === "concept" && key.endsWith(`:${axis}`) ? (options.includes(best.label) ? best.label : null) : OTHER;
  if (family === "genre_description") return best.cls === "genre_description" && options.includes(best.label) ? best.label : OTHER;
  if (family === "facet_family") return best.cls === "facet" && options.includes(best.label) ? best.label : OTHER;
  return null;
}
void catalogKey;

/**
 * Respuestas por fragmento a partir de una etiqueta humana de la consulta completa. La etiqueta
 * no dice qué palabras sostienen cada condición, así que solo se responde lo que queda decidido:
 * un fragmento del léxico con exactamente una condición etiquetada entre sus candidatos; un resto
 * es relleno si no queda nada pendiente ni condición sin fragmento; un único resto se lleva la
 * única condición o el único pendiente sin fragmento. Lo demás se descarta.
 */
function humanAnswers(g: QueryGold, seg: Segmentation) {
  const conds = new Set([...g.req, ...g.exc, ...g.pref, ...g.any.flat()]);
  const lexical = seg.spans.filter(s => ["concept", "genre", "ambiguous", "facet"].includes(s.kind) && s.candidates.length);
  const residuals = seg.spans.filter(s => s.kind === "residual");
  const covered = new Set(lexical.flatMap(s => s.candidates.filter(c => conds.has(c))));
  const uncovered = [...conds].filter(c => !covered.has(c) && !c.startsWith("similarity:") && !c.startsWith("decade:"));
  const describable = ["query_valid", "partial"].includes(g.status);
  // Una faceta pendiente que ya nombra un fragmento del léxico («guitarra fuzz») no queda para un resto.
  const pendingLeft = g.pending - (g.facet && lexical.some(s => s.candidates.includes(g.facet!)) ? 1 : 0);
  // Lo que se lleva un resto, cuando la etiqueta lo decide.
  let residualAnswer: { dim: string; concept: string | null } | null | "filler" = null;
  if (describable && uncovered.length === 0 && pendingLeft <= 0) residualAnswer = "filler";
  else if (describable && residuals.length === 1 && uncovered.length === 1 && pendingLeft <= 0) {
    const c = uncovered[0]!; residualAnswer = { dim: c.startsWith("genre:") ? "genre_description" : c.split(":")[0]!, concept: c };
  } else if (describable && residuals.length === 1 && uncovered.length === 0 && pendingLeft > 0)
    residualAnswer = pendingLeft === g.pending && g.facet ? { dim: "technical_facet", concept: g.facet } : { dim: "unsupported", concept: null };
  else if (["unrecognized", "unsupported"].includes(g.status) && g.pending === 0 && !g.ent.length) residualAnswer = "filler";
  return (key: string, family: string, spanId: string | null, options: string[]): string | null => {
    const pick = (x: string | null) => (x !== null && options.includes(x) ? x : null);
    if (family === "genre_description") {
      if (!describable) return null;
      const genres = uncovered.filter(c => c.startsWith("genre:"));
      return genres.length === 1 ? pick(genres[0]!) : genres.length === 0 && residualAnswer !== null ? OTHER : null;
    }
    const span = seg.spans.find(s => s.id === spanId);
    if (!span) return null;
    if (family === "span") {
      if (g.status === "clarify") return span.candidates.filter(c => g.alts.includes(c)).length >= 2 ? UNCLEAR : null;
      if (g.status === "entity_lookup" || g.status === "unrecognized") return NOT_REQUESTED;
      if (!describable) return null;
      const hits = span.candidates.filter(c => conds.has(c) || c === g.facet);
      return hits.length === 1 ? pick(hits[0]!) : hits.length === 0 && g.pending === 0 ? NOT_REQUESTED : null;
    }
    if (residualAnswer === null) return null;
    const ans = residualAnswer === "filler" ? { dim: "filler", concept: null } : residualAnswer;
    if (family === "dim") return pick(ans.dim);
    if (family === "pick") return ans.concept && key.endsWith(`:${ans.dim}`) ? pick(ans.concept) : OTHER;
    if (family === "facet_family") return ans.dim === "technical_facet" && ans.concept ? pick(ans.concept) : OTHER;
    return null;
  };
}
