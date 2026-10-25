import type { Database } from "./context.js";
import { ENTITY_SPECS } from "../../merge/specs.js";
import { operationRefs, orderedOperations } from "./schema.js";
import { OPERATION_LABELS, type CatalogDraft, type CatalogOperation, type CatalogRef, type CatalogValue } from "./types.js";

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
const semantic = (op: CatalogOperation) => { const { key: _, label: __, reason: ___, evidenceIds: ____, enabled: _____, ...rest } = op; return JSON.stringify(rest); };
/** Operations that set the same datum; only one of them can be accepted without overwriting the other. */
function slotOf(op: CatalogOperation): string | undefined {
  if (op.op === "create_album") { const title = nameWords(String(op.values["title"] ?? "")); return title.length ? `album|${refSignature(op.artist)}|${title.join(" ")}` : undefined; }
  if (op.op === "replace_fields") return `fields|${refSignature(op.target)}|${Object.keys(op.values).sort().join(",")}`;
  if (op.op === "assign_genre") return `genre|${refSignature(op.target)}|${op.genreSlug}`;
  if (op.op === "add_alias") return `alias|${refSignature(op.target)}|${fold(op.alias)}`;
  return undefined;
}
/** Names that only differ by a dropped given name or nickname word are one new identity within a plan. */
function sameNewIdentity(a: string[], b: string[]): boolean {
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  return small.length >= 3 && small.every(word => large.includes(word));
}
const NOT_A_DOUBT = /no se proponen? cambios|se conservan? sin cambios|ya (?:est[aá]n? |figuran? )?presentes? en la ficha|no aportan? t[eé]rminos adicionales|no documentan? t[eé]rminos nuevos/iu;

export function consolidateDraft(draft: CatalogDraft): { draft: CatalogDraft; stats: CoherenceStats } {
  const operations: CatalogOperation[] = [], unresolved = [...draft.unresolved];
  const renamed = new Map<string, string>(), entities: Array<{ kind: string; parent: string; words: string[]; op: CatalogOperation }> = [];
  const relations = new Map<string, CatalogOperation[]>(), slots = new Map<string, CatalogOperation>();
  const resolve = (key: string) => { let current = key; for (let hop = 0; renamed.has(current) && hop < 20; hop++) current = renamed.get(current)!; return current; };
  let repeated = 0, unsupported = 0;
  const withdrawn = new Set<string>();
  for (const input of draft.operations) {
    const op = structuredClone(input);
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
    const slot = slotOf(op) && `${op.enabled}|${slotOf(op)}`, previous = slot ? slots.get(slot) : undefined;
    if (slot && previous) {
      repeated++;
      if (semantic(previous) === semantic(op)) { previous.evidenceIds = [...new Set([...previous.evidenceIds, ...op.evidenceIds])].slice(0, 8); renamed.set(op.key, previous.key); continue; }
      // The more complete proposal stays where the first one was; the other remains visible as an alternative.
      const [kept, other] = semantic(op).length > semantic(previous).length ? [op, previous] : [previous, op];
      unresolved.push(`Otra propuesta para el mismo dato que «${kept.label}»: ${other.label}${cite(other)}.`);
      if (kept === op) { operations[operations.indexOf(previous)] = op; slots.set(slot, op); renamed.set(previous.key, op.key); } else renamed.set(op.key, previous.key);
      continue;
    }
    if (slot) slots.set(slot, op);
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
  // People who already share a project with the artist: a new identity with the same name is that person.
  const colleagues = root?.kind === "artist" ? (await db.query<{ id: number; name: string }>(
    `SELECT DISTINCT p.id::int,p.name FROM public.persons p WHERE p.id IN (
       SELECT person_id FROM public.artist_members WHERE artist_id=$1
       UNION SELECT c.person_id FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id WHERE al.artist_id=$1
       UNION SELECT c.person_id FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id WHERE al.artist_id=$1)`, [root.id],
  )).rows.map(row => ({ ...row, words: nameWords(row.name) })) : [];
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
      const proposed = nameWords(String(op.values["name"]));
      const matches = colleagues.filter(person => person.words.join(" ") === proposed.join(" ") || sameNewIdentity(person.words, proposed));
      if (matches.length === 1) { existing.set(op.key, matches[0]!.id); stats.registered++; continue; }
      if (matches.length > 1) { ambiguous.add(op.key); unresolved.push(`${op.label}: coincide con varias personas del mismo proyecto (${matches.map(person => `${person.id} ${person.name}`).join(", ")}); elegir cuál antes de vincularla${cite(op)}.`); stats.registered++; continue; }
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
