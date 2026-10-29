import type { Database } from "./context.js";
import { ENTITY_SPECS } from "../../merge/specs.js";
import { operationRefs, orderedOperations, sameSocialUrl } from "./schema.js";
import { evidenceGaps, loadGenreTerms } from "./evidence.js";
import { OPERATION_LABELS, type CatalogDraft, type CatalogEvidence, type CatalogOperation, type CatalogRef, type CatalogValue } from "./types.js";

/** Joins the lots of one preparation into a draft whose summary, operations and doubts agree. */
export interface CoherenceStats { repeated: number; registered: number; completed: number; doubts: number }
export const addStats = (a: CoherenceStats, b: CoherenceStats): CoherenceStats => ({ repeated: a.repeated + b.repeated, registered: a.registered + b.registered, completed: a.completed + b.completed, doubts: a.doubts + b.doubts });

const INSTRUMENTS: Record<string, string> = {
  guitar: "guitarra", guitars: "guitarra", guitarras: "guitarra", drums: "bateria", drum: "bateria", bass: "bajo",
  vocals: "voz", vocal: "voz", vocalista: "voz", voice: "voz", keyboard: "teclados", keyboards: "teclados", teclado: "teclados",
  lead: "principal", member: "integrante", miembro: "integrante", exmiembro: "integrante", exintegrante: "integrante",
};
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (text: string) => fold(text).split(" ").filter(Boolean).map(word => INSTRUMENTS[word] ?? word);
const refSignature = (ref: CatalogRef) => "key" in ref ? `${ref.kind}:k:${ref.key}` : `${ref.kind}:${ref.id}`;
const filled = (value: CatalogValue | undefined) => value !== null && value !== undefined && value !== "";
/** A generic role or one whose words are contained in the other describes the same participation. */
function rolesAgree(a: CatalogValue | undefined, b: CatalogValue | undefined): boolean {
  if (!filled(a) || !filled(b)) return true;
  const left = new Set(words(String(a)).filter(w => w !== "integrante")), right = new Set(words(String(b)).filter(w => w !== "integrante"));
  if (!left.size || !right.size) return true;
  return [...left].every(w => right.has(w)) || [...right].every(w => left.has(w));
}
const richerRole = (a: CatalogValue | undefined, b: CatalogValue | undefined) => !filled(a) ? b : !filled(b) ? a : words(String(b)).length > words(String(a)).length ? b : a;
/** Two documented periods that do not overlap are separate stages of the same membership. */
function separateStages(a: Record<string, CatalogValue>, b: Record<string, CatalogValue>): boolean {
  const [af, at, bf, bt] = [a["fromYear"], a["toYear"], b["fromYear"], b["toYear"]];
  if (![af, at, bf, bt].every(v => typeof v === "number")) return false;
  return (at as number) < (bf as number) || (bt as number) < (af as number);
}
function mergeValues(kept: Record<string, CatalogValue>, extra: Record<string, CatalogValue>): { values: Record<string, CatalogValue>; conflicts: string[] } {
  const values = { ...kept }, conflicts: string[] = [];
  for (const [field, value] of Object.entries(extra)) {
    if (!filled(value)) continue;
    if (!filled(values[field])) { values[field] = value; continue; }
    if (field === "role") { if (rolesAgree(values[field], value)) values[field] = richerRole(values[field], value)!; else conflicts.push(`${field}: «${String(values[field])}» / «${String(value)}»`); continue; }
    if (JSON.stringify(values[field]) !== JSON.stringify(value)) conflicts.push(`${field}: ${JSON.stringify(values[field])} / ${JSON.stringify(value)}`);
  }
  return { values, conflicts };
}
const cite = (op: CatalogOperation) => op.evidenceIds.length ? ` (${op.evidenceIds.join(", ")})` : "";

const TITLE_NOISE = new Set(["single", "sencillo", "ep", "lp", "disco", "album"]);
const nameWords = (text: string) => [...new Set(words(text))].filter(word => !TITLE_NOISE.has(word)).sort();
const semantic = (op: CatalogOperation) => {
  const { key: _, label: __, reason: ___, evidenceIds: ____, enabled: _____, ...rest } = op;
  if (rest.op === "add_social_link") return JSON.stringify({ op: rest.op, target: rest.target, platform: rest.platform, url: rest.url.toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/u, "").replace(/^twitter\.com\//u, "x.com/").replace(/[/?#]+$/u, "") });
  return JSON.stringify(rest);
};
/** Operations that set the same datum; only one of them can be accepted without overwriting the other. */
function slotOf(op: CatalogOperation): string | undefined {
  if (op.op === "create_album") { const title = nameWords(String(op.values["title"] ?? "")); return title.length ? `album|${refSignature(op.artist)}|${title.join(" ")}` : undefined; }
  // A narrative text is one datum even when one proposal also fills notes: two rewrites compete.
  if (op.op === "replace_fields") { const narrative = ["biography", "description"].find(field => field in op.values); return `fields|${refSignature(op.target)}|${narrative ?? Object.keys(op.values).sort().join(",")}`; }
  if (op.op === "assign_genre") return `genre|${refSignature(op.target)}|${op.genreSlug}`;
  if (op.op === "add_alias") return `alias|${refSignature(op.target)}|${fold(op.alias)}`;
  // The record holds one profile per platform: the same address joins, another one competes.
  if (op.op === "add_social_link") return `social|${refSignature(op.target)}|${op.platform}`;
  return undefined;
}
/** Every datum an operation sets: replacements compete field by field, so one that also fills another field still collides. */
function slotsOf(op: CatalogOperation): string[] {
  // Two corrections of the same relation compete date by date and role by role («fin 1994» against «fin 2005»).
  // «isCurrent» follows from the dates, so it does not make two different corrections collide.
  if (op.op === "replace_relation") return Object.keys(op.values).filter(field => field !== "isCurrent").map(field => `relation|${op.kind}|${op.id}|${field}`);
  if (op.op !== "replace_fields") { const slot = slotOf(op); return slot ? [slot] : []; }
  return Object.keys(op.values).map(field => `fields|${refSignature(op.target)}|${field}`);
}
/** Names that only differ by a dropped given name or nickname word are one new identity within a plan. */
function sameNewIdentity(a: string[], b: string[]): boolean {
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  return small.length >= 3 && small.every(word => large.includes(word));
}
const NOT_A_DOUBT = /no se proponen? cambios|se conservan? sin cambios|ya (?:est[aá]n? |figuran? )?presentes? en la ficha|no aportan? t[eé]rminos adicionales|no documentan? t[eé]rminos nuevos/iu;

const FIELD_NAMES: Record<string, string> = { organizationType: "tipo de organización", country: "país", status: "estado", nationality: "nacionalidad", birthCity: "ciudad de nacimiento", realName: "nombre real", isVenezuelan: "venezolano", originCity: "ciudad de origen", currentCity: "ciudad actual", birthDate: "fecha de nacimiento", deathDate: "fecha de fallecimiento", notes: "notas", formedYear: "año de formación", yearsActive: "años de actividad" };
const VALID_URL = /^https?:\/\/[\x21-\x7e]+$/u;
/**
 * One field per replacement, as the contract asks: a proposal that also sets another field must not
 * displace, or be displaced by, the proposal for a different datum. A narrative text keeps its notes.
 */
function splitFields(op: CatalogOperation): CatalogOperation[] {
  if (op.op !== "replace_fields") return [op];
  const fields = Object.keys(op.values);
  if (fields.length < 2 || fields.some(field => field === "biography" || field === "description")) return [op];
  return fields.map(field => ({ ...op, key: `${op.key.slice(0, 39 - Math.min(field.length, 12))}_${field.slice(0, 12)}`.slice(0, 40), label: `Completar ${FIELD_NAMES[field] ?? field}: ${String(op.values[field])}`.slice(0, 160), values: { [field]: op.values[field]! } }));
}
export function consolidateDraft(draft: CatalogDraft): { draft: CatalogDraft; stats: CoherenceStats } {
  const operations: CatalogOperation[] = [], unresolved = [...draft.unresolved];
  const renamed = new Map<string, string>(), entities: Array<{ kind: string; parent: string; words: string[]; op: CatalogOperation }> = [];
  const relations = new Map<string, CatalogOperation[]>(), slots = new Map<string, CatalogOperation>();
  const resolve = (key: string) => { let current = key; for (let hop = 0; renamed.has(current) && hop < 20; hop++) current = renamed.get(current)!; return current; };
  let repeated = 0, unsupported = 0;
  const withdrawn = new Set<string>();
  for (const input of draft.operations.flatMap(splitFields)) {
    const op = structuredClone(input);
    // Citation ids are for the reviewer, not the record: a text that only lists them adds nothing.
    // Cleaned before grouping, so an empty text cannot displace a useful one for the same field.
    if (op.op === "replace_fields") {
      const texts = TEXT_FIELDS.filter(field => typeof op.values[field] === "string" && CITATION_ID.test(String(op.values[field])));
      if (texts.some(field => withoutCitations(String(op.values[field])).split(/\s+/u).filter(word => /\p{L}{3,}/u.test(word)).length < 8)) {
        unresolved.push(`${op.label}: el texto solo enumera identificadores de citas, sin datos para la ficha${cite(op)}.`.slice(0, 700)); unsupported++; withdrawn.add(op.key); continue;
      }
      for (const field of texts) op.values[field] = withoutCitations(String(op.values[field]));
    }
    if (op.op === "add_social_link" && !VALID_URL.test(op.url)) { unresolved.push(`${op.label}: «${op.url}» no es una dirección válida del perfil${cite(op)}.`.slice(0, 700)); unsupported++; withdrawn.add(op.key); continue; }
    for (const ref of operationRefs(op)) if ("key" in ref) ref.key = resolve(ref.key);
    // The catalog itself is not documentary proof: a proposal without a citation stays a doubt.
    if (!op.evidenceIds.length) { unresolved.push(`${op.label}: sin cita que la respalde. ${op.reason}`.slice(0, 700)); unsupported++; withdrawn.add(op.key); continue; }
    if (operationRefs(op).some(ref => "key" in ref && withdrawn.has(ref.key))) { unresolved.push(`${op.label}: depende de una propuesta sin cita${cite(op)}.`); unsupported++; withdrawn.add(op.key); continue; }
    if (op.op === "create_entity") {
      const name = op.values["name"] ?? op.values["title"];
      const parent = op.parent ? refSignature(op.parent) : "";
      const current = filled(name) ? nameWords(String(name)) : [];
      // A disabled proposal stays apart: an active one merged into it would lose its dependents.
      const previous = current.length ? entities.find(item => item.kind === op.kind && item.parent === parent && item.op.enabled === op.enabled && (item.words.join(" ") === current.join(" ") || sameNewIdentity(item.words, current)))?.op : undefined;
      if (previous && previous.op === "create_entity") {
        const merged = mergeValues(previous.values, op.values);
        previous.values = merged.values;
        previous.evidenceIds = [...new Set([...previous.evidenceIds, ...op.evidenceIds])].slice(0, 8);
        if (merged.conflicts.length) unresolved.push(`${previous.label}: otra propuesta trae ${merged.conflicts.join("; ")}${cite(op)}.`);
        renamed.set(op.key, previous.key); repeated++; continue;
      }
      if (current.length) entities.push({ kind: op.kind, parent, words: current, op });
    }
    if (op.op === "create_relation") {
      const signature = `${op.enabled}|${op.kind}|${Object.entries(op.endpoints).map(([name, ref]) => `${name}=${refSignature(ref)}`).sort().join("|")}`;
      const siblings = relations.get(signature) ?? [];
      const same = siblings.find(other => other.op === "create_relation" && !separateStages(other.values, op.values));
      if (same && same.op === "create_relation") {
        const merged = mergeValues(same.values, op.values);
        if (merged.conflicts.length) unresolved.push(`${same.label}: otra fuente indica ${merged.conflicts.join("; ")}${cite(op)}; se conservan los valores de la propuesta y la discrepancia queda por revisar.`);
        else same.values = merged.values;
        same.evidenceIds = [...new Set([...same.evidenceIds, ...op.evidenceIds])].slice(0, 8);
        renamed.set(op.key, same.key); repeated++; continue;
      }
      relations.set(signature, [...siblings, op]);
    }
    const own = slotsOf(op).map(slot => `${op.enabled}|${slot}`), previous = own.map(slot => slots.get(slot)).find(Boolean);
    if (previous) {
      repeated++;
      if (semantic(previous) === semantic(op)) { previous.evidenceIds = [...new Set([...previous.evidenceIds, ...op.evidenceIds])].slice(0, 8); renamed.set(op.key, previous.key); continue; }
      // The more complete proposal stays where the first one was; the other remains visible as an alternative.
      const [kept, other] = semantic(op).length > semantic(previous).length ? [op, previous] : [previous, op];
      unresolved.push(`Otra propuesta para el mismo dato que «${kept.label}»: ${other.label}${cite(other)}.`);
      if (kept === op) {
        operations[operations.indexOf(previous)] = op; renamed.set(previous.key, op.key);
        for (const [slot, holder] of slots) if (holder === previous) slots.set(slot, op);
        own.forEach(slot => slots.set(slot, op));
      } else renamed.set(op.key, previous.key);
      continue;
    }
    own.forEach(slot => slots.set(slot, op));
    operations.push(op);
  }
  for (const op of operations) for (const ref of operationRefs(op)) if ("key" in ref) ref.key = resolve(ref.key);
  const meaningful = unresolved.filter(item => /https?:/u.test(item) || !NOT_A_DOUBT.test(item));
  const doubts = collapseUnresolved(meaningful);
  let ordered = operations;
  // A replacement may sit before a creation it now depends on; dependencies go first again.
  // Ordering only covers active proposals; disabled ones keep their place after them.
  try { ordered = [...orderedOperations({ ...draft, operations }), ...operations.filter(op => !op.enabled)]; } catch { /* the preview reports the unresolved dependency */ }
  return { draft: { ...draft, operations: ordered, unresolved: doubts }, stats: { repeated, registered: unsupported, completed: 0, doubts: unresolved.length - doubts.length } };
}

const ABSENCE = /ninguna (?:de las )?citas?|no hay (?:cita|evidencia|fuente)|sin (?:cita|respaldo|evidencia)|evidence vac[ií]o|las citas[^.;:]{0,80}no (?:mencionan|contienen|incluyen|lo nombran)|no (?:lo |la )?mencionan?|fragmentos de navegaci[oó]n/iu;
const properNames = (text: string) => new Set([...text.matchAll(/\p{Lu}[\p{Ll}]+(?:\s+(?:de\s+|del\s+|la\s+)?\p{Lu}[\p{Ll}]+)+/gu)].map(match => fold(match[0])));
/**
 * Each lot reads only part of the citations, so «my citations do not mention it» is not a doubt when
 * the plan proposes that subject from another lot; the remaining absences keep one line per subject.
 */
export function finalizeDoubts(draft: CatalogDraft, stats: CoherenceStats): CatalogDraft {
  const proposed = new Set(draft.operations.flatMap(op => [...properNames(op.label)]));
  const genres = draft.operations.flatMap(op => op.op === "assign_genre" ? [fold(op.genreSlug), fold(op.label.replace(/^[^:]*:/u, ""))] : []).filter(term => term.length > 1);
  const subjects = new Map<string, string>(), kept: string[] = [];
  for (const text of draft.unresolved) {
    // A lot with a trimmed taxonomy cannot tell that a term is missing when another lot assigns it.
    if (/taxonom/iu.test(text) && genres.some(term => ` ${fold(text)} `.includes(` ${term} `))) { stats.doubts++; continue; }
    if (!ABSENCE.test(text) || /^Otra propuesta|no se puede crear|espera a elegir|coincide con varias/u.test(text)) { kept.push(text); continue; }
    const names = [...properNames(text)];
    if (names.some(name => proposed.has(name))) { stats.doubts++; continue; }
    const subject = names.slice(0, 2).sort().join("|") || text;
    const previous = subjects.get(subject);
    if (previous === undefined) { subjects.set(subject, text); kept.push(text); continue; }
    stats.doubts++;
    if (text.length > previous.length) { kept[kept.indexOf(previous)] = text; subjects.set(subject, text); }
  }
  return { ...draft, unresolved: linkDoubts(kept, draft.operations) };
}

/** A doubt about a work or name that another lot did propose points to that proposal instead of contradicting it. */
function linkDoubts(items: string[], operations: CatalogOperation[]): string[] {
  const named = operations.flatMap(op => {
    const name = op.op === "create_album" ? op.values["title"] : op.op === "create_entity" ? op.values["name"] ?? op.values["title"] : op.op === "add_alias" ? op.alias : undefined;
    const key = filled(name) ? nameWords(String(name)).join(" ") : "";
    return key.length >= 4 ? [{ key, op }] : [];
  });
  return items.map(text => {
    if (text.startsWith("Otra propuesta para el mismo dato")) return text;
    const quoted = [...text.matchAll(/[«'"“‘]([^»'"”’]{2,120})[»'"”’]/gu)].map(match => nameWords(match[1]!).join(" "));
    const match = named.find(item => quoted.includes(item.key));
    return match ? `[Ver «${match.op.label}»] ${text}` : text;
  });
}

/** Near-identical doubts from different lots are one doubt; the most detailed wording is kept. */
export function collapseUnresolved(items: string[]): string[] {
  const tokens = (text: string) => new Set(fold(text.replace(/\bE\d+\b/gu, " ")).split(" ").filter(word => word.length > 2));
  const kept: Array<{ text: string; set: Set<string> }> = [];
  for (const text of [...new Set(items)].sort((a, b) => b.length - a.length)) {
    const set = tokens(text);
    const twin = kept.find(other => { let shared = 0; for (const word of set) if (other.set.has(word)) shared++; return set.size > 0 && shared / (set.size + other.set.size - shared) >= 0.75; });
    if (!twin) kept.push({ text, set });
  }
  const first = new Map<string, number>();
  items.forEach((text, index) => { if (!first.has(text)) first.set(text, index); });
  return kept.map(item => item.text).sort((a, b) => first.get(a)! - first.get(b)!);
}

/** Catalog values and proposed values compared as editors read them: dates by day, text without accents. */
function sameValue(current: unknown, proposed: CatalogValue): boolean {
  const plain = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : value === null || value === undefined ? "" : fold(String(value));
  return plain(current) === plain(proposed);
}
/** The content of a proposed album, as separate proposals on the existing record that has none. */
async function fillExistingAlbum(db: Database, op: Extract<CatalogOperation, { op: "create_album" }>, existing: { id: number; title: string }): Promise<CatalogOperation[]> {
  const album = { kind: "album" as const, id: existing.id }, row = (await db.query<Record<string, unknown>>("SELECT * FROM public.albums WHERE id=$1", [existing.id])).rows[0] ?? {};
  const common = { reason: op.reason, evidenceIds: op.evidenceIds, enabled: op.enabled };
  const key = (suffix: string) => `${op.key.slice(0, 39 - suffix.length)}${suffix}`;
  const result: CatalogOperation[] = [];
  for (const [field, value] of Object.entries(op.values)) {
    const column = field.replace(/[A-Z]/gu, letter => `_${letter.toLowerCase()}`);
    if (field !== "title" && filled(value) && column in row && (row[column] === null || row[column] === "")) result.push({ ...common, key: key(`_${field}`.slice(0, 14)), label: `Completar ${field} de «${existing.title}»: ${String(value)}`.slice(0, 160), op: "replace_fields", target: album, values: { [field]: value } });
  }
  for (const track of op.tracks) result.push({ ...common, key: key(`_t${track.discNumber}_${track.trackNumber}`), label: `Añadir pista ${track.discNumber}.${track.trackNumber} a «${existing.title}»: ${track.title}`.slice(0, 160), op: "create_entity", kind: "track", parent: album,
    values: Object.fromEntries(Object.entries(track).filter(([, value]) => value !== undefined)) as Record<string, CatalogValue> });
  op.genres.forEach((genre, index) => result.push({ ...common, key: key(`_g${index}`), label: `Añadir género a «${existing.title}»: ${genre.slug}`.slice(0, 160), op: "assign_genre", target: album, genreSlug: genre.slug, role: genre.role }));
  op.formats.forEach((format, index) => result.push({ ...common, key: key(`_f${index}`), label: `Añadir formato a «${existing.title}»: ${format.format}`.slice(0, 160), op: "create_relation", kind: "album_format", endpoints: { albumId: album },
    values: Object.fromEntries(Object.entries(format).filter(([, value]) => value !== undefined)) as Record<string, CatalogValue> }));
  op.credits.forEach((credit, index) => result.push({ ...common, key: key(`_c${index}`), label: `Añadir crédito en «${existing.title}»: ${credit.role}`.slice(0, 160), op: "create_relation", kind: "album_credit",
    endpoints: { albumId: album, [`${credit.target.kind}Id`]: credit.target }, values: { role: credit.role, ...(credit.creditType ? { creditType: credit.creditType } : {}) } }));
  op.aliases.forEach((alias, index) => result.push({ ...common, key: key(`_a${index}`), label: `Añadir título alternativo a «${existing.title}»: ${alias}`.slice(0, 160), op: "add_alias", target: album, alias, aliasType: "alternate_title", isPrimary: false }));
  return result;
}
const HOLDERS = ["personId", "artistId", "organizationId"];
const REQUIRED_ENDPOINTS: Record<string, string[][]> = {
  artist_membership: [["artistId"], ["personId"]], person_organization: [["personId"], ["organizationId"]],
  album_credit: [["albumId"], HOLDERS], track_credit: [["trackId"], HOLDERS], album_format: [["albumId"]],
};
/** A relation already in the catalog is not proposed again: it is completed, or its difference becomes a doubt. */
export async function settleRegisteredRelations(db: Database, draft: CatalogDraft, stats: CoherenceStats, root?: { kind: string; id: number }): Promise<CatalogDraft> {
  const operations: CatalogOperation[] = [], unresolved = [...draft.unresolved];
  // People who already share a project with the artist: a new identity with the same name, real name
  // or alias is that person. A solo project's only member also answers to the artist's own names.
  const colleagues = root?.kind === "artist" ? (await db.query<{ id: number; names: string[] }>(
    `WITH people AS (
       SELECT person_id FROM public.artist_members WHERE artist_id=$1
       UNION SELECT c.person_id FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id WHERE al.artist_id=$1
       UNION SELECT c.person_id FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id WHERE al.artist_id=$1),
     solo AS (SELECT min(person_id) AS person_id FROM public.artist_members WHERE artist_id=$1 HAVING count(DISTINCT person_id)=1)
     SELECT p.id::int, array_remove(array[p.name,p.real_name]
              || coalesce((SELECT array_agg(pa.alias) FROM ingest.person_aliases pa WHERE pa.person_id=p.id),'{}')
              || CASE WHEN p.id=(SELECT person_id FROM solo) THEN array[(SELECT name FROM public.artists WHERE id=$1)]
                   || coalesce((SELECT array_agg(aa.alias) FROM ingest.artist_aliases aa WHERE aa.artist_id=$1),'{}') ELSE '{}' END, NULL) AS names
       FROM public.persons p WHERE p.id IN (SELECT person_id FROM people)`, [root.id],
  )).rows.map(row => ({ id: row.id, name: row.names[0] ?? String(row.id), words: row.names.map(nameWords).filter(item => item.length) })) : [];
  const existing = new Map<string, number>(), albums = new Map<string, number>(), ambiguous = new Set<string>();
  const keys = new Set(draft.operations.map(op => op.key)), known = new Map<string, boolean>();
  const missingReference = async (op: CatalogOperation): Promise<string | null> => {
    for (const ref of operationRefs(op)) {
      if ("key" in ref) { if (!keys.has(ref.key)) return `remite a una alta que no está en este plan (${ref.key})`; continue; }
      const spec = ENTITY_SPECS[ref.kind as keyof typeof ENTITY_SPECS], signature = `${ref.kind}:${ref.id}`;
      if (!spec) continue;
      if (!known.has(signature)) known.set(signature, Boolean((await db.query(`SELECT 1 FROM ${spec.table} WHERE id=$1`, [ref.id])).rowCount));
      if (!known.get(signature)) return `la ficha ${ref.kind} ${ref.id} ya no existe en el catálogo`;
    }
    return null;
  };
  for (const op of draft.operations) {
    for (const ref of operationRefs(op)) {
      const id = "key" in ref ? (ref.kind === "album" ? albums.get(ref.key) : existing.get(ref.key)) : undefined;
      if (id !== undefined) { delete (ref as { key?: string }).key; Object.assign(ref, { id }); }
    }
    if (op.op === "create_entity" && op.kind === "person" && filled(op.values["name"])) {
      const proposed = [op.values["name"], op.values["realName"]].filter(filled).map(name => nameWords(String(name)));
      const matches = colleagues.filter(person => person.words.some(known => proposed.some(words => known.join(" ") === words.join(" ") || sameNewIdentity(known, words))));
      if (matches.length === 1) { existing.set(op.key, matches[0]!.id); stats.registered++; continue; }
      if (matches.length > 1) { ambiguous.add(op.key); unresolved.push(`${op.label}: coincide con varias personas del mismo proyecto (${matches.map(person => `${person.id} ${person.name}`).join(", ")}); elegir cuál antes de vincularla${cite(op)}.`); stats.registered++; continue; }
    }
    // An organization already in the catalog is that organization; a partial name match needs a choice.
    if (op.op === "create_entity" && op.kind === "organization" && filled(op.values["name"]) && nameWords(String(op.values["name"])).length) {
      const proposed = nameWords(String(op.values["name"]));
      const known = (await db.query<{ id: number; name: string }>(
        `SELECT DISTINCT o.id::int,o.name FROM public.organizations o LEFT JOIN ingest.organization_aliases a ON a.organization_id=o.id
          WHERE translate(lower(o.name),'áàäâéèëêíìïîóòöôúùüûñç','aaaaeeeeiiiioooouuuunc') LIKE $1
             OR translate(lower(a.alias),'áàäâéèëêíìïîóòöôúùüûñç','aaaaeeeeiiiioooouuuunc') LIKE $1`, [`%${[...proposed].sort((x, y) => y.length - x.length)[0]!.replace(/[%_]/gu, "")}%`],
      )).rows.map(row => ({ ...row, words: nameWords(row.name) }));
      const exact = known.filter(org => org.words.join(" ") === proposed.join(" "));
      if (exact.length === 1) { existing.set(op.key, exact[0]!.id); stats.registered++; continue; }
      const similar = exact.length > 1 ? exact : known.filter(org => org.words.length && (org.words.every(word => proposed.includes(word)) || proposed.every(word => org.words.includes(word))));
      if (similar.length) { ambiguous.add(op.key); unresolved.push(`${op.label}: el catálogo ya tiene ${similar.slice(0, 5).map(org => `${org.id} ${org.name}`).join(", ")}; elegir la organización antes de crear otra${cite(op)}.`.slice(0, 700)); stats.registered++; continue; }
    }
    // A record deleted since the preparation, or a creation that only another lot knew, cannot be referenced.
    const gone = await missingReference(op);
    if (gone) { ambiguous.add(op.key); unresolved.push(`${op.label}: ${gone}${cite(op)}.`); stats.registered++; continue; }
    const blocked = operationRefs(op).find(ref => "key" in ref && ambiguous.has(ref.key));
    if (blocked) { ambiguous.add(op.key); unresolved.push(`${op.label}: depende de una propuesta que quedó en dudas${cite(op)}.`); stats.registered++; continue; }
    if (op.op === "create_album" && "id" in op.artist) {
      const title = nameWords(String(op.values["title"] ?? "")).join(" "), year = op.values["releaseYear"];
      const existing = (await db.query<{ id: number; title: string; release_year: number | null }>("SELECT id::int,title,release_year FROM public.albums WHERE artist_id=$1", [op.artist.id])).rows
        .find(row => nameWords(row.title).join(" ") === title && (typeof year !== "number" || row.release_year === null || Math.abs(row.release_year - year) <= 1));
      if (existing) albums.set(op.key, existing.id);
      if (existing && !Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.tracks WHERE album_id=$1", [existing.id])).rows[0]?.n)) {
        // An empty existing record receives the documented content instead of a second copy of the album.
        operations.push(...await fillExistingAlbum(db, op, existing));
        stats.completed++; continue;
      }
      if (existing) {
        unresolved.push(`${op.label}: el disco ya existe (id ${existing.id}, «${existing.title}», ${existing.release_year ?? "sin año"}); lo documentado (${op.tracks.length} pistas, ${op.credits.length} créditos${typeof year === "number" && year !== existing.release_year ? `, año ${year}` : ""}) debe completarse sobre esa ficha${cite(op)}.`);
        stats.registered++; continue;
      }
    }
    if ((op.op === "replace_fields" || op.op === "add_alias") && "id" in op.target) {
      const spec = ENTITY_SPECS[op.target.kind as keyof typeof ENTITY_SPECS];
      const row = spec ? (await db.query<Record<string, unknown>>(`SELECT * FROM ${spec.table} WHERE id=$1`, [op.target.id])).rows[0] : undefined;
      if (row && op.op === "replace_fields" && Object.entries(op.values).every(([field, value]) => {
        const column = field.replace(/[A-Z]/gu, letter => `_${letter.toLowerCase()}`);
        return column in row && sameValue(row[column], value);
      })) { stats.registered++; continue; }
      if (row && spec && op.op === "add_alias") {
        const aliases = (await db.query<{ alias: string }>(`SELECT alias FROM ${spec.aliasTable} WHERE ${spec.aliasTargetColumn}=$1`, [op.target.id])).rows.map(item => item.alias);
        if ([String(row[spec.identityColumn] ?? ""), ...aliases].some(name => fold(name) === fold(op.alias))) { stats.registered++; continue; }
      }
    }
    if (op.op === "create_relation") {
      const missing = (REQUIRED_ENDPOINTS[op.kind] ?? []).filter(group => !group.some(name => op.endpoints[name]));
      if (missing.length) { unresolved.push(`${op.label}: no se puede crear porque falta ${missing.map(group => group.join(" o ")).join(" y ")}${cite(op)}.`); stats.registered++; continue; }
    }
    if (op.op !== "create_relation" || Object.values(op.endpoints).some(ref => "key" in ref)) { operations.push(op); continue; }
    const id = (name: string) => { const ref = op.endpoints[name]; return ref && "id" in ref ? ref.id : null; };
    if (op.kind === "artist_membership" && id("artistId") && id("personId")) {
      const rows = (await db.query<{ id: number; role: string | null; from_year: number | null; to_year: number | null; is_current: boolean | null }>(
        "SELECT id::int,role,from_year,to_year,is_current FROM public.artist_members WHERE artist_id=$1 AND person_id=$2 ORDER BY id", [id("artistId"), id("personId")],
      )).rows;
      if (!rows.length) { operations.push(op); continue; }
      const proposed = op.values, fields: Array<[string, keyof typeof rows[number]]> = [["fromYear", "from_year"], ["toYear", "to_year"], ["isCurrent", "is_current"]];
      const covering = rows.find(row => rolesAgree(row.role, proposed["role"]) && fields.every(([field, column]) => !filled(proposed[field]) || row[column] === null || row[column] === proposed[field]));
      if (covering) {
        const additions = Object.fromEntries(fields.filter(([field, column]) => filled(proposed[field]) && covering[column] === null).map(([field]) => [field, proposed[field]!]));
        if (Object.keys(additions).length) {
          operations.push({ op: "replace_relation", kind: op.kind, id: covering.id, values: additions, key: op.key, label: `${op.label} (completa la membresía registrada ${covering.id})`, reason: op.reason, evidenceIds: op.evidenceIds, enabled: op.enabled });
          stats.completed++;
        } else stats.registered++;
        continue;
      }
      unresolved.push(`${op.label}: ya hay ${rows.length === 1 ? "una membresía registrada" : `${rows.length} membresías registradas`} (${rows.map(row => `id ${row.id}: ${row.role ?? "sin rol"}, ${row.from_year ?? "?"}–${row.to_year ?? (row.is_current ? "actual" : "?")}`).join("; ")}); la fuente indica ${[proposed["role"], `${proposed["fromYear"] ?? "?"}–${proposed["toYear"] ?? (proposed["isCurrent"] ? "actual" : "?")}`].filter(filled).join(", ")}${cite(op)}. Revisar si es otra etapa o una corrección.`);
      stats.registered++; continue;
    }
    const target = op.kind === "track_credit" ? ["track_credits", "track_id", id("trackId")] as const : op.kind === "album_credit" ? ["album_credits", "album_id", id("albumId")] as const : null;
    const holder = (["personId", "artistId", "organizationId"] as const).find(name => id(name));
    if (target?.[2] && holder) {
      const column = { personId: "person_id", artistId: "artist_id", organizationId: "organization_id" }[holder];
      const roles = (await db.query<{ role: string }>(`SELECT role FROM public.${target[0]} WHERE ${target[1]}=$1 AND ${column}=$2`, [target[2], id(holder)])).rows;
      if (roles.some(row => rolesAgree(row.role, op.values["role"]))) { stats.registered++; continue; }
    }
    operations.push(op);
  }
  return { ...draft, operations, unresolved };
}

const HANDLE_LINK = /(?:instagram\.com|facebook\.com|tiktok\.com\/@?|twitter\.com|x\.com|threads\.net\/@?)\/([\w.]{3,40})/giu;
const NOT_OFFICIAL = /\b(fans?|fan ?club|club de fans|fanpage|tienda|store|shop|sello|disquera|prensa)\b/u;
/** An official site carries the artist's name in its domain or is called official by the citation; portals and fan sites are not. */
function officialSite(url: string, text: string, quotes: string, names: string[]): boolean {
  if (NOT_OFFICIAL.test(text) || NOT_OFFICIAL.test(fold(url))) return false;
  const host = (url.toLowerCase().match(/^https?:\/\/([^/]+)/u)?.[1] ?? "").replace(/^www\./u, "").replace(/[^a-z0-9]/gu, "");
  return names.some(name => name.replace(/ /gu, "").length > 2 && host.includes(name.replace(/ /gu, ""))) || /\b(sitio|pagina|web|website) oficial|official (site|website|page)\b/u.test(fold(quotes));
}
const COVER = /\b(portadas?|caratulas?|cover|covers|artwork)\b/u;
const IMAGE_COLUMNS: Record<string, string> = { "artist.pictureUrl": "picture_url", "artist.logoUrl": "logo_url", "album.coverUrl": "cover_url", "person.pictureUrl": "picture_url" };
const plainCase = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const ALIAS_CUE = /\b(conocid[oa]s? como|apodad[oa]|apodo|alias|tambien (llamad[oa]|conocid[oa])|aka|seudonimo|nombre artistico|abreviad[oa])\b/u;
const PLACE_FIELDS = ["originCity", "birthCity", "currentCity", "deathCity"];
const BIRTH = /\b(naci\w*|nacid[oa]s?|nacimiento|natal|born)\b/u;
/** @handles and profile paths the cited pages name: a handle is a social profile, not a name variant. */
function handlesIn(quotes: string): Set<string> {
  const found = new Set<string>();
  for (const match of quotes.matchAll(/@([\p{L}\p{N}_.]{3,40})/gu)) found.add(fold(match[1]!));
  for (const match of quotes.matchAll(HANDLE_LINK)) found.add(fold(match[1]!));
  return found;
}
const TEXT_FIELDS = ["notes", "biography", "description"];
const CITATION_ID = /\b[EH]\d{1,5}\b/u;
/** Removes «(E14, E28/E1590)» and bare ids from a record text, with the punctuation they leave behind. */
export function withoutCitations(text: string): string {
  return text
    .replace(/\s*[([]\s*(?:[EH]\d{1,5}\s*(?:[,;/]|\by\b)?\s*)+[)\]]/gu, "")
    .replace(/\b[EH]\d{1,5}\b(?:\s*(?:[,;/]|\by\b)\s*\b[EH]\d{1,5}\b)*/gu, "")
    .replace(/\s+([,.;:])/gu, "$1").replace(/([,;:])(?:\s*[,;:])+/gu, "$1").replace(/[,;:]\s*\./gu, ".").replace(/ {2,}/gu, " ").trim();
}
const SONG = /\b(sencillos?|singles?|temas?|cancion|canciones|corte|track)\b/u;
/**
 * A genre is the artist's only when some citation says it of their music. A citation that is a cut
 * of a longer passage about a single («un sencillo refrescante que tiene como base rítmica la guaracha»)
 * is read with that passage.
 */
function songScoped(slug: string, cited: CatalogEvidence[], evidence: CatalogEvidence[]): boolean {
  const term = fold(slug.replace(/-/gu, " ")), compact = term.replace(/ /gu, "");
  const names = (text: string) => { const folded = fold(text); return folded.includes(term) || folded.replace(/ /gu, "").includes(compact); };
  const relevant = cited.filter(item => names(item.quote));
  if (!relevant.length) return false;
  return relevant.every(item => {
    const own = fold(item.quote);
    return [item, ...evidence.filter(other => other.id !== item.id && fold(other.quote).includes(own))].some(passage => SONG.test(fold(passage.quote)));
  });
}
/**
 * Each datum goes to its record and field. Proposals that put a handle in the aliases, an unofficial
 * site in the website, a cover in the artist's photo or a birthplace in the project's origin, that
 * end a membership without a date or confirm a genre the record already has (or a broader parent of
 * a more specific one) become doubts with their reason, or are dropped as already registered.
 */
export async function enforceScope(db: Database, draft: CatalogDraft, evidence: CatalogEvidence[], stats: CoherenceStats, root?: { kind: string; id: number }): Promise<CatalogDraft> {
  const operations: CatalogOperation[] = [], unresolved = [...draft.unresolved];
  const byId = new Map(evidence.map(item => [item.id, item]));
  const quotesOf = (op: CatalogOperation) => op.evidenceIds.map(id => byId.get(id)).filter((item): item is CatalogEvidence => !!item);
  const taxonomy = new Map((await db.query<{ slug: string; parent: string | null }>(
    "SELECT g.slug,p.slug AS parent FROM ingest.genres g LEFT JOIN ingest.genres p ON p.id=g.parent_genre_id")).rows.map(row => [row.slug, row.parent]));
  const ancestors = (slug: string) => { const result: string[] = []; for (let current = taxonomy.get(slug); current && result.length < 10; current = taxonomy.get(current)) result.push(current); return result; };
  const currentGenres = new Map<string, Set<string>>();
  const genresOf = async (ref: CatalogRef) => {
    if (!("id" in ref) || (ref.kind !== "artist" && ref.kind !== "album")) return new Set<string>();
    const signature = refSignature(ref);
    if (!currentGenres.has(signature)) currentGenres.set(signature, new Set((await db.query<{ slug: string }>(
      `SELECT g.slug FROM ingest.${ref.kind}_genres x JOIN ingest.genres g ON g.id=x.genre_id WHERE x.${ref.kind}_id=$1 AND x.status='confirmed' AND x.superseded_by_id IS NULL`, [ref.id])).rows.map(row => row.slug)));
    return currentGenres.get(signature)!;
  };
  const proposedGenres = new Map<string, Set<string>>();
  for (const op of draft.operations) if (op.op === "assign_genre" && op.enabled) proposedGenres.set(refSignature(op.target), new Set([...(proposedGenres.get(refSignature(op.target)) ?? []), op.genreSlug]));
  const rootNames = root?.kind === "artist" ? (await db.query<{ name: string }>(
    "SELECT name FROM public.artists WHERE id=$1 UNION SELECT alias FROM ingest.artist_aliases WHERE artist_id=$1", [root.id])).rows.map(row => fold(row.name)) : [];
  const doubt = (op: CatalogOperation, why: string) => { unresolved.push(`${op.label}: ${why}${cite(op)}.`.slice(0, 700)); stats.registered++; };
  for (const input of draft.operations) {
    // A citation id lost while lots were combined must not block a proposal that keeps other valid citations.
    const known = input.evidenceIds.filter(id => byId.has(id));
    const op = known.length && known.length < input.evidenceIds.length ? { ...input, evidenceIds: known } : input;
    if (!op.enabled) { operations.push(op); continue; }
    const cited = quotesOf(op), quotes = cited.map(item => item.quote).join("\n"), text = fold(`${op.label} ${op.reason}`);
    if (op.op === "add_alias" && rootNames.length) {
      // «Jeremías (ESP)» or «Jeremías (apodo…)» only adds a remark to a name the record already has.
      const bare = fold(op.alias.replace(/\s*[([].*$/u, ""));
      if (bare !== fold(op.alias) && rootNames.includes(bare)) { doubt(op, "solo añade una aclaración entre paréntesis a un nombre que la ficha ya tiene"); continue; }
      // Initials name someone only when a source says so: «Single M.J.» is another artist's byline.
      if (fold(op.alias).replace(/\s/gu, "").length <= 3 && !ALIAS_CUE.test(fold(quotes))) { doubt(op, "unas iniciales sin una fuente que diga que también se le llama así"); continue; }
    }
    // In a group, a member's own name is not another name of the band («Asier Cazalis» for Caramelos de Cianuro).
    if (op.op === "add_alias" && op.target.kind === "artist" && "id" in op.target) {
      const members = (await db.query<{ name: string; forms: string | null }>(
        `SELECT p.name, concat_ws('|', p.real_name, (SELECT string_agg(a.alias, '|') FROM ingest.person_aliases a WHERE a.person_id=p.id)) AS forms
           FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1`, [op.target.id])).rows;
      const people = new Set(members.map(member => member.name));
      const member = people.size >= 2 ? members.find(row => [row.name, ...(row.forms ?? "").split("|")].some(form => form && fold(form) === fold(op.alias))) : undefined;
      if (member) { doubt(op, `es el nombre de un integrante (${member.name}), no otro nombre del grupo`); continue; }
    }
    if (op.op === "add_alias") {
      const handles = handlesIn(quotes);
      if (handles.has(fold(op.alias)) || (!/\s/u.test(op.alias.trim()) && /\b(instagram|facebook|tiktok|twitter|usuario|handle|redes?)\b/u.test(text))) {
        doubt(op, "es un usuario de red social, no un nombre; corresponde a una red del artista"); continue;
      }
    }
    if (op.op === "add_social_link" && "id" in op.target) {
      const registered = (await db.query<{ url: string }>("SELECT url FROM public.social_links WHERE artist_id=$1 AND platform=$2", [op.target.id, op.platform])).rows[0];
      if (registered && sameSocialUrl(registered.url, op.url)) { stats.registered++; continue; }
      if (registered) { doubt(op, `la ficha ya tiene ${op.platform}: ${registered.url}; decidir cuál es la oficial`); continue; }
    }
    if (op.op === "add_social_link" && op.platform === "website" && !officialSite(op.url, text, quotes, rootNames)) { doubt(op, `${op.url} no es el sitio oficial del artista`); continue; }
    if (op.op === "replace_fields") {
      const missingPlace = PLACE_FIELDS.find(field => typeof op.values[field] === "string" && !fold(quotes).includes(fold(String(op.values[field])).split(" ")[0] ?? ""));
      if (missingPlace) { doubt(op, `las citas no nombran ${String(op.values[missingPlace])}`); continue; }
      const website = op.values["websiteUrl"];
      if (typeof website === "string" && !officialSite(website, text, quotes, rootNames)) { doubt(op, `${website} no es el sitio oficial del artista`); continue; }
      const picture = ["pictureUrl", "photoUrl", "imageUrl"].find(field => typeof op.values[field] === "string");
      // A record that already has its image keeps it: a new one is a candidate to compare in Imágenes, not a silent replacement.
      const image = (["pictureUrl", "logoUrl", "coverUrl"] as const).find(field => typeof op.values[field] === "string");
      const column = image && IMAGE_COLUMNS[`${op.target.kind}.${image}`];
      if (column && "id" in op.target && (await db.query<{ current: string | null }>(`SELECT ${column} AS current FROM public.${op.target.kind === "album" ? "albums" : op.target.kind === "person" ? "persons" : "artists"} WHERE id=$1`, [op.target.id])).rows[0]?.current) {
        doubt(op, `la ficha ya tiene ${image === "coverUrl" ? "portada" : image === "logoUrl" ? "logo" : "foto"}; la nueva (${String(op.values[image!])}) va como candidata en Imágenes para compararla`); continue;
      }
      if (picture && (op.target.kind === "artist" || op.target.kind === "person") && (COVER.test(text) || cited.some(item => COVER.test(fold(item.label ?? ""))))) {
        doubt(op, "es la portada de un disco, no una foto del artista; va como candidata de portada de ese disco"); continue;
      }
      const city = op.values["originCity"];
      if (typeof city === "string" && op.target.kind === "artist" && root?.kind === "artist") {
        // «nació en Londres» or a biographical heading «(Londres, 19 de septiembre de 1973)».
        const place = plainCase(city).split(/[\s,]+/u)[0] ?? "", plain = plainCase(quotes);
        const hits = place.length > 2 ? [...plain.matchAll(new RegExp(`\\b${place}\\b`, "gu"))] : [];
        const birth = (index: number) => BIRTH.test(fold(plain.slice(Math.max(0, index - 80), index))) || /^[^)\n]{0,50}\b(1[89]\d\d|20\d\d)\s*\)/u.test(plain.slice(index));
        if (hits.length && hits.every(hit => birth(hit.index!))) { doubt(op, `las citas solo dan ${city} como lugar de nacimiento; el origen del proyecto es otro dato`); continue; }
      }
      // The first record does not establish when a project began.
      if ((filled(op.values["formedYear"]) || filled(op.values["yearsActive"])) && /\b(primer (trabajo|disco|album|lp|sencillo|cd)|debut)\b/u.test(fold(quotes)) && !/\b(form[oó]|fundad|se form|inici[oó] su carrera|comenz[oó] su carrera)\b/u.test(plainCase(quotes))) {
        doubt(op, "la cita fecha el primer disco, que no prueba el inicio del proyecto"); continue;
      }
    }
    if (op.op === "replace_relation" && op.kind === "artist_membership" && op.values["isCurrent"] === false && !filled(op.values["toYear"])) {
      doubt(op, "dejaría la membresía como pasada sin una fecha de fin documentada"); continue;
    }
    if (op.op === "assign_genre") {
      if (op.target.kind === "artist" && songScoped(op.genreSlug, cited, evidence)) { doubt(op, "las citas lo dicen de un sencillo o una canción, no de la música del artista"); continue; }
      if (!taxonomy.has(op.genreSlug)) { doubt(op, `el término «${op.genreSlug}» no existe en la taxonomía`); continue; }
      const current = await genresOf(op.target);
      if (current.has(op.genreSlug)) { stats.registered++; continue; }
      const specific = [...current, ...(proposedGenres.get(refSignature(op.target)) ?? [])].find(slug => slug !== op.genreSlug && ancestors(slug).includes(op.genreSlug));
      if (specific) { doubt(op, `es la rama general de «${specific}», que la ficha ya tiene o se propone`); continue; }
    }
    operations.push(op);
  }
  return documentedOnly({ ...draft, operations, unresolved }, evidence, stats, root, await loadGenreTerms(db));
}

/**
 * The same support check the executor applies before accepting: a creation keeps its documented
 * fields and drops the auxiliary ones its citations do not state; any other proposal with an
 * unsupported part, and whatever depends on it, becomes a doubt naming that part.
 */
function documentedOnly(draft: CatalogDraft, evidence: CatalogEvidence[], stats: CoherenceStats, root: { kind: string; id: number } | undefined, genreTerms: Map<string, string[]>): CatalogDraft {
  const context = { genreTerms, ...(root ? { root: root as { kind: CatalogRef["kind"]; id: number } } : {}) };
  const operations: CatalogOperation[] = [], unresolved = [...draft.unresolved], withdrawn = new Set<string>();
  for (const input of draft.operations) {
    if (!input.enabled) { operations.push(input); continue; }
    if (operationRefs(input).some(ref => "key" in ref && withdrawn.has(ref.key))) {
      unresolved.push(`${input.label}: depende de una propuesta sin respaldo suficiente${cite(input)}.`.slice(0, 700)); withdrawn.add(input.key); stats.registered++; continue;
    }
    let op = input, gaps = evidenceGaps(op, evidence, context);
    if (gaps.length && op.op === "create_entity" && op.kind !== "album" && op.kind !== "track") {
      const creation = op, nameKey = "name" in creation.values ? "name" : "title";
      const unsupported = Object.keys(creation.values).filter(field => field !== nameKey && evidenceGaps({ ...creation, values: { [nameKey]: creation.values[nameKey]!, [field]: creation.values[field]! } }, evidence, context).length);
      if (unsupported.length) {
        op = { ...creation, values: Object.fromEntries(Object.entries(creation.values).filter(([field]) => !unsupported.includes(field))) };
        gaps = evidenceGaps(op, evidence, context);
        if (!gaps.length) unresolved.push(`${op.label}: se propone sin ${unsupported.map(field => FIELD_NAMES[field] ?? field).join(", ")}, que las citas no indican${cite(op)}.`.slice(0, 700));
      }
    }
    if (gaps.length) { unresolved.push(`${op.label}: las citas no respaldan ${gaps.join("; ")}${cite(op)}.`.slice(0, 700)); withdrawn.add(op.key); stats.registered++; continue; }
    operations.push(op);
  }
  return { ...draft, operations, unresolved };
}

/** The summary is derived from what the plan contains, so lots cannot contradict each other. */
export function coherentSummary(draft: CatalogDraft, stats: CoherenceStats, lots: number): string {
  const counts = new Map<string, number>(), active = draft.operations.filter(op => op.enabled), disabled = draft.operations.length - active.length;
  for (const op of active) counts.set(OPERATION_LABELS[op.op], (counts.get(OPERATION_LABELS[op.op]) ?? 0) + 1);
  const parts = [
    active.length
      ? `${active.length} ${active.length === 1 ? "propuesta" : "propuestas"}: ${[...counts].map(([label, count]) => `${label.toLocaleLowerCase("es")} ${count}`).join(", ")}.`
      : "Sin propuestas aplicables.",
    disabled ? `${disabled} ${disabled === 1 ? "desactivada" : "desactivadas"} por revisión anterior.` : "",
    `${draft.unresolved.length} ${draft.unresolved.length === 1 ? "duda queda" : "dudas quedan"} para revisión${lots > 1 ? ` (preparado en ${lots} lotes)` : ""}.`,
    stats.repeated ? `Se unieron ${stats.repeated} cambios repetidos entre lotes.` : "",
    stats.registered ? `${stats.registered} ya estaban en el catálogo, no eran viables o no tenían cita; pasaron a dudas con su motivo.` : "",
    stats.completed ? `${stats.completed} completan una relación registrada.` : "",
    stats.doubts ? `Se agruparon o retiraron ${stats.doubts} dudas repetidas o ya resueltas.` : "",
  ];
  const summary = parts.filter(Boolean).join(" ");
  return summary.length <= 1500 ? summary : `${summary.slice(0, 1499)}…`;
}

/** Labels of proposals that still set the same datum as an earlier one; a coherent plan has none. */
export function remainingDuplicates(draft: CatalogDraft): string[] {
  const seen = new Map<string, CatalogOperation>(), repeated: string[] = [];
  for (const op of draft.operations.filter(item => item.enabled)) {
    const slot = op.op === "create_relation"
      ? `${op.kind}|${Object.entries(op.endpoints).map(([name, ref]) => `${name}=${refSignature(ref)}`).sort().join("|")}`
      : op.op === "create_entity" ? `${op.kind}|${nameWords(String(op.values["name"] ?? op.values["title"] ?? op.key)).join(" ")}` : slotOf(op);
    if (!slot) continue;
    const previous = seen.get(slot);
    if (previous && !(op.op === "create_relation" && previous.op === "create_relation" && separateStages(previous.values, op.values))) repeated.push(`${previous.label} / ${op.label}`);
    else seen.set(slot, op);
  }
  return repeated;
}
