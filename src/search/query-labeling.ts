import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { normalizeLiteral } from "./query-interpretation/compiler.js";
import { hashText } from "./review-protocol.js";
import { OperatorError } from "../merge/operator.js";

// Etapa 3, versión 1.6.0: consultas reales etiquetadas por una persona.
// La persona etiqueta a ciegas: el estado nunca incluye lo que el sistema lee
// de la consulta, para que la etiqueta no se ancle en las reglas ni en Laya.
type Db = Pool | PoolClient;
export const LABELING_BATCH = "docs/unified-search/stage3/datasets/query-real-labeling-1.json";
const LEXICON = "docs/unified-search/stage3/query-lexicon.json";

const batchSchema = z.object({
  version: z.string().min(1),
  items: z.array(z.object({ id: z.string().min(1), text: z.string().min(1).max(200), source: z.string().min(1) }).passthrough()).min(1),
}).passthrough();

interface Lexicon {
  concepts: { id: string; dimension: string; labelEs: string; definitionEs: string }[];
  genres: { slug: string; name: string; definition?: string }[];
  facets: { id: string; definition: string }[];
  markers: { aspects: Record<string, string[]>; decades: Record<string, string[]> };
}

export interface LabelOption { id: string; label: string; group: string; hint: string }

const DIMENSION_LABEL: Record<string, string> = { activity: "Actividad", emotion: "Emoción", energy: "Energía", atmosphere: "Atmósfera", theme: "Tema" };
const ASPECT_LABEL: Record<string, string> = { overall: "en general", guitars: "en las guitarras", voice: "en la voz", production: "en la producción", composition: "en la composición", atmosphere: "en la atmósfera" };

async function loadLexicon(root: string): Promise<Lexicon> {
  return JSON.parse(await readFile(path.join(root, LEXICON), "utf8")) as Lexicon;
}

/** Todo lo que una etiqueta puede nombrar: conceptos, géneros, décadas, parecidos y facetas candidatas. */
export function labelOptions(lex: Lexicon): { conditions: LabelOption[]; facets: LabelOption[] } {
  const conditions: LabelOption[] = [
    ...lex.concepts.map(c => ({ id: c.id, label: c.labelEs, group: DIMENSION_LABEL[c.dimension] ?? c.dimension, hint: c.definitionEs })),
    ...lex.genres.map(g => ({ id: `genre:${g.slug}`, label: g.name, group: "Género", hint: g.definition ?? "" })),
    ...Object.keys(lex.markers.decades).map(d => ({ id: `decade:${d}`, label: `Década de ${d.slice(0, 4)}`, group: "Década", hint: "" })),
    ...["overall", ...Object.keys(lex.markers.aspects)].map(a => ({ id: `similarity:${a}`, label: `Parecido ${ASPECT_LABEL[a] ?? a}`, group: "Parecido a una referencia", hint: "Requiere anotar la referencia (artista, disco o canción)." })),
  ];
  const facets = lex.facets.map(f => ({ id: f.id, label: f.id.replace(/^candidate:/u, ""), group: "Faceta sin representar", hint: f.definition }));
  return { conditions, facets };
}

const entitySchema = z.object({ role: z.enum(["target", "reference"]), kind: z.enum(["artist", "album", "track"]).nullable(), literal: z.string().trim().min(1).max(120) }).strict();
export const goldSchema = z.object({
  status: z.enum(["query_valid", "partial", "entity_lookup", "clarify", "unsupported", "contradiction", "unrecognized"]),
  req: z.array(z.string()).default([]), exc: z.array(z.string()).default([]), any: z.array(z.array(z.string()).min(2)).default([]),
  pref: z.array(z.string()).default([]), ctx: z.union([z.literal(0), z.literal(1)]).default(0), ent: z.array(entitySchema).default([]),
  pending: z.number().int().min(0).max(5).default(0), alts: z.array(z.string()).default([]), facet: z.string().nullable().default(null),
}).strict();
export type LabelGold = z.infer<typeof goldSchema>;

/** Reglas de coherencia de las convenciones de etiquetado (STAGE_3.md). */
export function checkGold(gold: LabelGold, options: { conditions: LabelOption[]; facets: LabelOption[] }): string[] {
  const known = new Set(options.conditions.map(o => o.id)), facets = new Set(options.facets.map(o => o.id)), problems: string[] = [];
  const named = [...gold.req, ...gold.exc, ...gold.pref, ...gold.any.flat(), ...gold.alts];
  for (const id of named) if (!known.has(id)) problems.push(`Condición desconocida: ${id}`);
  if (new Set(named).size !== named.length) problems.push("Una condición aparece dos veces");
  if (gold.facet && !facets.has(gold.facet)) problems.push(`Faceta desconocida: ${gold.facet}`);
  const conditions = gold.req.length + gold.exc.length + gold.pref.length + gold.any.length;
  if (gold.status === "query_valid" && (gold.pending || !conditions)) problems.push("Una consulta válida no deja nada pendiente y tiene al menos una condición");
  if (gold.status === "partial" && (!gold.pending || !conditions)) problems.push("Una consulta parcial tiene condiciones y algo pendiente");
  if (gold.status === "unsupported" && (!gold.pending || conditions)) problems.push("«Sin soporte» deja todo pendiente, sin condiciones");
  if (gold.status === "entity_lookup" && !gold.ent.some(e => e.role === "target")) problems.push("Una búsqueda por nombre anota el nombre buscado");
  // «metal y alegre o triste»: una ambigüedad de agrupación se anota vacía, sin lecturas alternativas.
  if (gold.status !== "clarify" && gold.alts.length) problems.push("Las lecturas posibles solo van en consultas ambiguas");
  if (["contradiction", "unrecognized"].includes(gold.status) && conditions) problems.push("Contradicción y no reconocida no llevan condiciones");
  if (named.some(id => id.startsWith("similarity:")) && !gold.ent.some(e => e.role === "reference")) problems.push("Un parecido anota la referencia");
  return problems;
}

async function loadBatch(root: string) {
  return batchSchema.parse(JSON.parse(await readFile(path.join(root, LABELING_BATCH), "utf8")));
}

interface LabelRow { item_id: string; batch_version: string; text_sha256: string; outcome: "labeled" | "skipped"; gold: LabelGold | null; note: string; labeled_at: Date }

export async function queryLabelingState(root: string, db: Db, labeler: string) {
  const [batch, lex] = await Promise.all([loadBatch(root), loadLexicon(root)]);
  const rows = (await db.query<LabelRow>("SELECT * FROM ingest.search_query_labels WHERE labeler=$1", [labeler])).rows;
  const byId = new Map(rows.map(r => [r.item_id, r]));
  const items = batch.items.map(item => {
    const row = byId.get(item.id);
    // Una consulta cuyo texto cambió invalida la etiqueta anterior en vez de heredarla.
    const current = row && row.text_sha256 === hashText(item.text) ? row : undefined;
    return { id: item.id, text: item.text, source: item.source, outcome: current?.outcome ?? null, gold: current?.gold ?? null,
      note: current?.note ?? "", labeledAt: current?.labeled_at.toISOString() ?? null, stale: Boolean(row && !current) };
  });
  return { batchVersion: batch.version, labeler, items, options: labelOptions(lex),
    labeled: items.filter(i => i.outcome === "labeled").length, skipped: items.filter(i => i.outcome === "skipped").length, total: items.length };
}

export const labelInputSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("labeled"), gold: goldSchema, note: z.string().trim().max(1000).default("") }).strict(),
  z.object({ outcome: z.literal("skipped"), note: z.string().trim().max(1000).default("") }).strict(),
]);

export async function saveQueryLabel(root: string, db: Db, labeler: string, id: string, input: unknown) {
  const [batch, lex] = await Promise.all([loadBatch(root), loadLexicon(root)]);
  const item = batch.items.find(i => i.id === id);
  if (!item) throw new OperatorError("not_found", "La consulta no está en el lote vigente");
  const parsed = labelInputSchema.parse(input);
  let gold: LabelGold | null = null;
  if (parsed.outcome === "labeled") {
    const sorted = (xs: string[]) => [...new Set(xs)].sort();
    gold = { ...parsed.gold, req: sorted(parsed.gold.req), exc: sorted(parsed.gold.exc), pref: sorted(parsed.gold.pref), alts: sorted(parsed.gold.alts),
      any: parsed.gold.any.map(sorted), ent: parsed.gold.ent.map(e => ({ ...e, literal: normalizeLiteral(e.literal) })) };
    const problems = checkGold(gold, labelOptions(lex));
    if (problems.length) throw new OperatorError("invalid", problems.join(" · "), { problems });
  }
  await db.query(`INSERT INTO ingest.search_query_labels(item_id,labeler,batch_version,text_sha256,outcome,gold,note)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(item_id,labeler) DO UPDATE SET batch_version=EXCLUDED.batch_version,
    text_sha256=EXCLUDED.text_sha256, outcome=EXCLUDED.outcome, gold=EXCLUDED.gold, note=EXCLUDED.note, labeled_at=now()`,
  [id, labeler, batch.version, hashText(item.text), parsed.outcome, gold ? JSON.stringify(gold) : null, parsed.note]);
  return { gold };
}
