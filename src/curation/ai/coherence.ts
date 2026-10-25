import type { CatalogDecision, CatalogDraft, CatalogOperation, CatalogPreviewItem } from "./types.js";

/**
 * Deterministic account of what a plan actually contains, plus the claims of the model's
 * summary that no operation or open question backs. A summary that promises an absent
 * change must never read as a finished proposal (plan 20/20, etapa 3, M07).
 */
export interface PlanOutcome {
  text: string;
  issues: string[];
}
const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
type Category = "album" | "track" | "credit" | "genre" | "alias" | "format" | "label" | "image" | "biography" | "date" | "origin" | "merge";
const nouns: Record<Category, RegExp> = {
  album: /\b(discos?|albumes|albums?|eps?|sencillos?|lps?|demos?|reediciones|reedicion)\b/u,
  track: /\b(pistas?|canciones|cancion|tracklist|repertorio)\b/u,
  credit: /\b(creditos?|integrantes?|miembros?|membresias?|musicos?|formacion)\b/u,
  genre: /\b(generos?|subgeneros?)\b/u,
  alias: /\b(alias|variantes? de nombre|seudonimos?)\b/u,
  format: /\b(formatos?)\b/u,
  label: /\b(sellos?|disqueras?)\b/u,
  image: /\b(portadas?|fotos?|fotografias?|imagen|imagenes|retratos?)\b/u,
  biography: /\b(biografias?|descripcion|resena)\b/u,
  date: /\b(ano de (formacion|separacion|publicacion|lanzamiento)|fechas? de|nacimiento|fallecimiento)\b/u,
  origin: /\b(ciudad|origen)\b/u,
  merge: /\b(fusion|fusiona\w*)\b/u,
};
const categoryLabels: Record<Category, string> = {
  album: "discos", track: "pistas", credit: "créditos o integrantes", genre: "géneros", alias: "alias", format: "formatos",
  label: "sellos", image: "imágenes", biography: "biografía o descripción", date: "fechas", origin: "origen", merge: "fusiones",
};
const fieldCategory: Record<string, Category> = {
  coverUrl: "image", imageUrl: "image", photoUrl: "image", biography: "biography", description: "biography",
  releaseYear: "date", formedYear: "date", disbandedYear: "date", birthDate: "date", deathDate: "date",
  originCity: "origin", labelId: "label",
};
function categories(op: CatalogOperation): Category[] {
  const fields = (values: Record<string, unknown>) => Object.keys(values).map((key) => fieldCategory[key]).filter((c): c is Category => !!c);
  switch (op.op) {
    case "create_album":
      return ["album", ...fields(op.values),
        ...(op.tracks.length ? ["track" as const] : []), ...(op.credits.length ? ["credit" as const] : []),
        ...(op.genres.length ? ["genre" as const] : []), ...(op.aliases.length ? ["alias" as const] : []),
        ...(op.formats.length ? ["format" as const] : []), ...(op.labelEntity ? ["label" as const] : [])];
    case "create_entity":
      return [...(op.kind === "album" ? ["album" as const] : op.kind === "track" ? ["track" as const] : op.kind === "organization" ? ["label" as const] : op.kind === "person" ? ["credit" as const] : []), ...fields(op.values)];
    case "replace_fields": return fields(op.values);
    case "add_alias": return ["alias"];
    case "create_relation": case "replace_relation": case "remove_relation":
      return [op.kind === "album_format" ? "format" : op.kind === "person_organization" ? "label" : "credit"];
    case "assign_genre": case "remove_genre": return ["genre"];
    case "reorder_tracks": return ["track"];
    case "merge_entities": return ["merge"];
    default: return [];
  }
}
/** How many units of a category one operation contributes, so "añade 12 pistas" can be checked. */
function units(op: CatalogOperation, category: Category): number {
  if (op.op === "create_album")
    return category === "track" ? op.tracks.length : category === "credit" ? op.credits.length : category === "genre" ? op.genres.length
      : category === "alias" ? op.aliases.length : category === "format" ? op.formats.length : 1;
  if (op.op === "reorder_tracks" && category === "track") return op.positions.length;
  return 1;
}
const promise = /\b(anad\w*|agreg\w*|incorpor\w*|crea[rn]?|creamos|cread[oa]s?|corrig\w*|corrige[n]?|actualiz\w*|cambia[rn]?|asign\w*|fusion\w*|propon\w*|propuest\w*)\b/gu;
const withheld = /\b(no|sin|ya|ningun\w*|pendientes?|queda\w*|falta\w*|requiere\w*|dudas?|insuficiente|imposible|descart\w*|omit\w*)\b/u;
/** A merge keeps the dropped record's content, so it accounts for those nouns. */
const mergeCovers: Category[] = ["album", "track", "image", "credit", "alias", "format", "genre"];
/** "créditos del álbum" names the context, not a promised album. */
const modifier = (before: string) => /\b(de|del|en)( (la|las|el|los|ambos|ambas|sus?))?$/u.test(before.trim());
const numberWords: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const plural: Record<string, [string, string]> = {
  create_album: ["disco completo", "discos completos"], create_entity: ["ficha nueva", "fichas nuevas"], replace_fields: ["cambio de campos", "cambios de campos"],
  add_alias: ["alias", "alias"], create_relation: ["relación nueva", "relaciones nuevas"], replace_relation: ["relación corregida", "relaciones corregidas"],
  remove_relation: ["relación retirada", "relaciones retiradas"], assign_genre: ["género", "géneros"], remove_genre: ["género rechazado", "géneros rechazados"],
  reorder_tracks: ["orden de pistas", "órdenes de pistas"], merge_entities: ["fusión", "fusiones"], remove_entity: ["retirada de ficha", "retiradas de fichas"],
};
const count = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const quoted = /[«"“]([^»"”]{2,80})[»"”]/gu;

export function planOutcome(
  draft: CatalogDraft,
  items: CatalogPreviewItem[],
  decisions: Record<string, CatalogDecision> = {},
): PlanOutcome {
  const enabled = draft.operations.filter((op) => op.enabled);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const planError = items.find((item) => item.key === "plan" && item.error)?.error;
  const ready: CatalogOperation[] = [], blocked: Array<[CatalogOperation, string]> = [], unchanged: CatalogOperation[] = [];
  let accepted = 0, rejected = 0;
  for (const op of enabled) {
    const decision = decisions[op.key]?.decision;
    if (decision === "accepted") { accepted++; continue; }
    if (decision === "rejected") { rejected++; continue; }
    const item = byKey.get(op.key);
    if (item?.error) blocked.push([op, item.error]);
    else if (item && item.before !== null && same(item.before, item.after)) unchanged.push(op);
    else ready.push(op);
  }
  const parts: string[] = [];
  if (ready.length) {
    const kinds = new Map<string, number>();
    for (const op of ready) kinds.set(op.op, (kinds.get(op.op) ?? 0) + 1);
    parts.push(`${count(ready.length, ["cambio listo", "cambios listos"])} para decidir (${[...kinds].map(([op, n]) => count(n, plural[op] ?? [op, op])).join(", ")})`);
  }
  if (blocked.length) {
    const reasons = [...new Set(blocked.map(([, error]) => error.split(/[.:]/u)[0]!.trim()))];
    parts.push(`${count(blocked.length, ["bloqueado", "bloqueados"])}: ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? "…" : ""}`);
  }
  if (unchanged.length) parts.push(`${count(unchanged.length, ["sin efecto", "sin efecto"])}: el catálogo ya contiene ese dato`);
  if (accepted) parts.push(count(accepted, ["aceptado", "aceptados"]));
  if (rejected) parts.push(count(rejected, ["rechazado", "rechazados"]));
  if (draft.unresolved.length) parts.push(`${count(draft.unresolved.length, ["duda pendiente", "dudas pendientes"])} con lo que falta para resolverla${draft.unresolved.length === 1 ? "" : "s"}`);
  let text: string;
  if (planError) text = `No se pudo validar la propuesta: ${planError}`;
  else if (!enabled.length)
    text = draft.unresolved.length
      ? `Sin cambios propuestos: ${parts.join(" · ")}.`
      : "Sin cambios propuestos ni dudas: las fuentes revisadas no aportaron datos nuevos con respaldo para esta ficha.";
  else text = `${parts.join(" · ")}.`;

  const issues: string[] = [];
  const pool = fold(JSON.stringify(enabled.map(({ reason: _reason, evidenceIds: _ids, ...op }) => op)));
  const open = fold(draft.unresolved.join("\n"));
  for (const sentence of draft.summary.split(/(?<=[.;!?])\s+|\n+/u)) {
    const folded = fold(sentence);
    const verbs = [...folded.matchAll(promise)];
    if (!verbs.length || withheld.test(folded)) continue;
    if (!enabled.length) { issues.push(`El resumen anuncia cambios («${sentence.trim().slice(0, 120)}»), pero la propuesta no contiene operaciones activas.`); continue; }
    // Only nouns that follow a promising verb closely are its objects.
    const window = verbs.map((verb) => folded.slice(verb.index, verb.index + 110)).join(" | ");
    for (const [category, noun] of Object.entries(nouns) as Array<[Category, RegExp]>) {
      const match = noun.exec(window);
      if (!match || modifier(window.slice(0, match.index))) continue;
      const available = enabled.filter((op) => categories(op).includes(category) || (op.op === "merge_entities" && mergeCovers.includes(category)));
      if (!available.length) { issues.push(`El resumen anuncia ${categoryLabels[category]} («${sentence.trim().slice(0, 120)}»), pero ninguna operación lo propone.`); continue; }
      const before = window.slice(0, match.index).trim().split(" ").pop() ?? "";
      const claimed = /^\d{1,3}$/u.test(before) ? Number(before) : numberWords[before];
      const total = available.reduce((sum, op) => sum + units(op, category), 0);
      if (claimed && claimed > total) issues.push(`El resumen anuncia ${claimed} ${categoryLabels[category]}, pero las operaciones solo proponen ${total}.`);
    }
    for (const [, name] of sentence.matchAll(quoted)) {
      const key = fold(name!);
      if (!pool.includes(key) && !open.includes(key)) issues.push(`El resumen menciona «${name}», que no figura en ninguna operación ni duda.`);
    }
  }
  return { text, issues: [...new Set(issues)] };
}
/** Same change regardless of which preparation proposed it or how it was worded. */
export function operationSignature(op: CatalogOperation): string {
  const { key: _key, label: _label, reason: _reason, evidenceIds: _evidence, enabled: _enabled, ...change } = op;
  return fold(canonical(change));
}
/** Key order differs between stored jsonb and parsed drafts. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
