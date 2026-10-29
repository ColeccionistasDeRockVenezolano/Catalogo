import { sameSocialUrl } from "./schema.js";
import type { CatalogEvidence, CatalogKind, CatalogOperation, CatalogRef, CatalogValue } from "./types.js";
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const generic = new Set([
  "unknown",
  "other",
  "primary",
  "secondary",
  "musician",
  "producer",
  "published",
  "unpublished",
  "high",
  "hq",
  "lq",
]);
const synonyms: Record<string, string[]> = {
  bass: ["bajo", "bajista"],
  drums: ["bateria", "baterista"],
  guitars: ["guitarra", "guitarrista"],
  guitar: ["guitarra", "guitarrista"],
  vocals: ["voz", "vocalista"],
  keyboards: ["teclado", "teclados", "tecladista"],
  percussion: ["percusion", "percusionista"],
  producer: ["produccion", "productor", "produced", "production"],
  backing: ["background", "coros"],
  programming: ["programacion"],
  composed: ["compuesto", "compositor", "composicion"],
  produced: ["produccion", "productor", "producido"],
  mixed: ["mezcla", "mezclado", "mixing"],
  mastered: ["masterizado", "masterizacion", "mastering"],
  engineer: ["ingeniero", "engineered", "grabado"],
  arranged: ["arreglos", "arreglado", "arranger"],
  vinyl: ["vinilo", "lp"],
  cassette: ["casete", "k7", "cinta"],
  // A members list documents membership without an instrument; the planner then uses this generic role.
  integrante: ["miembro", "exmiembro", "exintegrante", "member", "formacion", "alineacion"],
};
/** Publication types are documented by explicit wording, never by track counts. */
const albumTypes: Record<string, string[]> = {
  album: ["album", "lp", "larga duracion", "full length", "disco"],
  ep: ["ep"],
  single: ["single", "sencillo"],
  compilation: ["compilation", "recopilatorio", "compilado", "recopilacion"],
  live: ["en vivo", "live", "directo"],
  demo: ["demo", "maqueta"],
};
const fieldLabels: Record<string, string> = {
  title: "título",
  name: "nombre",
  releaseYear: "año",
  formedYear: "año de formación",
  disbandedYear: "año de separación",
  originCity: "ciudad de origen",
  birthDate: "nacimiento",
  deathDate: "fallecimiento",
  albumType: "tipo de publicación",
  coverUrl: "portada",
  imageUrl: "imagen",
  photoUrl: "foto",
  labelId: "sello",
  biography: "biografía",
  description: "descripción",
};
const narrativeFields = new Set(["biography", "description", "notes", "trivia"]);
const refKinds: Record<string, CatalogKind> = { labelId: "organization", artistId: "artist", personId: "person", albumId: "album", organizationId: "organization", trackId: "track" };
function mentioned(value: string | number, text: string): boolean {
  const normalized = normalize(String(value));
  if (!normalized) return false;
  if (generic.has(normalized)) return normalized === "producer" && (text.includes("producer") || synonyms[normalized]!.some(value => text.includes(value)));
  if (typeof value === "number")
    return new RegExp(`\\b${value}\\b`, "u").test(text);
  if (new RegExp(`\\b${normalized.replace(/ /gu, "\\s+")}\\b`, "u").test(text))
    return true;
  const words = normalized
    .split(" ")
    .filter((w) => w.length >= 3 && !generic.has(w));
  if (!words.length) return false;
  return words.every(
    (word) =>
      text.includes(word) || synonyms[word]?.some((s) => text.includes(s)),
  );
}
// "Producer" stays checkable: it names a concrete credit with its own wording.
const isGeneric = (value: CatalogValue) => typeof value === "string" && normalize(value) !== "producer" && generic.has(normalize(value));
const label = (key: string) => fieldLabels[key] ?? key;
const clip = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);
export interface EvidenceContext {
  /** Names of catalog or planned entities, so a citation must identify both the value and who it belongs to. */
  nameOf?: ((ref: CatalogRef) => string | undefined) | undefined;
  root?: { kind: CatalogKind; id: number } | undefined;
  /** Name and aliases of each genre in the taxonomy: a genre is cited by one of them as a whole phrase. */
  genreTerms?: ReadonlyMap<string, string[]> | undefined;
}
/** Loads the taxonomy's names and aliases for {@link EvidenceContext.genreTerms}. */
export async function loadGenreTerms(db: { query: <R extends object>(sql: string) => Promise<{ rows: R[] }> }): Promise<Map<string, string[]>> {
  const rows = (await db.query<{ slug: string; terms: string[] }>(
    "SELECT g.slug, array_remove(array_agg(DISTINCT a.alias_normalized), NULL) || g.name AS terms FROM ingest.genres g LEFT JOIN ingest.genre_aliases a ON a.genre_id=g.id AND a.kind='genre' GROUP BY g.slug,g.name")).rows;
  return new Map(rows.map((row) => [row.slug, row.terms]));
}
const phrase = (term: string, text: string) => {
  const normalized = normalize(term);
  return normalized.length > 0 && new RegExp(`\\b${normalized.replace(/ /gu, "\\s+")}\\b`, "u").test(text);
};
/** Words scattered over a citation do not name a genre: «Universal Music Latino · Rock» is not «rock latino». */
function genreCited(slug: string, text: string, context: EvidenceContext): boolean {
  const terms = context.genreTerms?.get(slug);
  return terms ? [slug.replace(/-/gu, " "), ...terms].some((term) => phrase(term, text)) : mentioned(slug, text);
}
/** Each sentence of a narrative text needs its own support; one shared word does not validate invented facts. */
/** How sources name each organization type: «compañía productora», «sello», «disquera». */
const organizationTypes: Record<string, string[]> = {
  "production company": ["productora", "production company", "produccion"],
  "record label": ["sello", "disquera", "discografica", "record label", "label"],
  studio: ["estudio", "studio"],
  distributor: ["distribuidora", "distributor"],
};
/** A founding is told as «fundó», «creó su propia compañía» or «fundada por». */
const roleSynonyms: Record<string, string[]> = {
  fundador: ["fundo", "fundada por", "fundado por", "creo su", "crea su", "creo la", "creo el"],
  fundadora: ["fundo", "fundada por", "fundado por", "creo su", "crea su", "creo la", "creo el"],
  founder: ["founded", "founder", "created his", "created her"],
  // Instrument roles are often credited in English («Guitar: …», «Acoustic Bass: …»).
  guitarra: ["guitar"],
  "guitarra electrica": ["electric guitar"],
  "guitarra acustica": ["acoustic guitar"],
  bajo: ["bass"],
  "bajo acustico": ["acoustic bass", "upright bass", "double bass"],
  "bajo electrico": ["electric bass"],
  contrabajo: ["double bass", "upright bass", "acoustic bass"],
  bateria: ["drums", "drummer"],
  baterista: ["drums", "drummer"],
  percusion: ["percussion", "percussionist"],
  teclados: ["keyboards", "keys"],
  voz: ["vocals", "voice", "singer"],
  vocalista: ["vocals", "lead vocals", "singer"],
  cantante: ["vocals", "singer"],
  saxofon: ["sax", "saxophone"],
  trompeta: ["trumpet"],
  trombon: ["trombone"],
  flauta: ["flute"],
  violonchelo: ["cello"],
};
const roleMentioned = (value: string | number, text: string) =>
  mentioned(value, text) || (typeof value === "string" && (roleSynonyms[normalize(value)] ?? []).some((w) => text.includes(w)));
function narrativeGap(value: string, text: string): string | null {
  for (const sentence of value.split(/(?<=[.!?;])\s+/u)) {
    const words = [...new Set(normalize(sentence).split(" ").filter((w) => w.length > 4))];
    const numbers = sentence.match(/\d{3,}/gu) ?? [];
    if (numbers.some((n) => !new RegExp(`\\b${n}\\b`, "u").test(text))) return sentence;
    if (words.length >= 3 && words.filter((w) => text.includes(w)).length / words.length < 0.5) return sentence;
  }
  return null;
}
function fieldGap(key: string, value: CatalogValue, text: string, raw: string, evidence: CatalogEvidence[], context: EvidenceContext): string | null {
  if (value === null) return `vaciar ${label(key)}`;
  if (typeof value === "boolean")
    return value === true &&
      (key === "isVenezuelan"
        ? mentioned("venezuelan", text) || mentioned("venezolano", text)
        : key === "isDeceased"
          ? mentioned("fallecido", text) || mentioned("died", text)
          : false)
      ? null
      : label(key);
  if (narrativeFields.has(key)) {
    const sentence = narrativeGap(String(value), text);
    return sentence ? `${label(key)}: «${clip(sentence)}»` : null;
  }
  if (/url$/iu.test(key))
    return typeof value === "string" && (raw.includes(value) || evidence.some((e) => e.url === value)) ? null : `${label(key)} no citada`;
  if (refKinds[key] && typeof value === "number") {
    const name = context.nameOf?.({ kind: refKinds[key], id: value });
    return name && mentioned(name, text) ? null : `${label(key)}${name ? ` «${name}»` : ""}`;
  }
  if (key === "organizationType" && typeof value === "string") {
    const words = organizationTypes[normalize(value)];
    return (words ? words.some((w) => mentioned(w, text)) : mentioned(value, text)) ? null : `${label(key)} «${value}»`;
  }
  if (key === "albumType" && typeof value === "string") {
    const words = albumTypes[normalize(value)];
    return (words ? words.some((w) => mentioned(w, text)) : mentioned(value, text)) ? null : `${label(key)} «${value}»`;
  }
  if (isGeneric(value)) return null;
  return mentioned(value, text) ? null : `${label(key)} «${value}»`;
}
function refGap(ref: CatalogRef, what: string, text: string, context: EvidenceContext): string | null {
  if (!context.nameOf) return null;
  if ("id" in ref && context.root && ref.kind === context.root.kind && ref.id === context.root.id) return null;
  const name = context.nameOf(ref);
  return name && mentioned(name, text) ? null : `${what}${name ? ` «${name}»` : " sin nombre verificable"}`;
}
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
/**
 * Parts of an operation that its cited excerpts do not support: every field, track,
 * credit, format and relation endpoint needs its own backing. An empty list means
 * the operation is documented; anything else requires an explicit editorial decision.
 */
export function evidenceGaps(
  op: CatalogOperation,
  evidence: CatalogEvidence[],
  context: EvidenceContext = {},
): string[] {
  const cited = evidence.filter((e) => op.evidenceIds.includes(e.id));
  const raw = cited.map((e) => e.quote).join("\n");
  const text = normalize(raw);
  if (!text) return ["sin cita documental"];
  const gaps: Array<string | null> = [];
  const fields = (values: Record<string, CatalogValue>, skip: string[] = []) =>
    Object.entries(values)
      .filter(([key]) => !skip.includes(key))
      .forEach(([key, v]) => gaps.push(fieldGap(key, v, text, raw, cited, context)));
  if (op.op === "create_album") {
    gaps.push(typeof op.values["title"] === "string" && mentioned(op.values["title"], text) ? null : "título");
    fields(op.values, ["title"]);
    if (op.labelEntity) gaps.push(refGap(op.labelEntity, "sello", text, context));
    for (const track of op.tracks) {
      const position = `${track.discNumber > 1 ? `${track.discNumber}-` : ""}${track.trackNumber}`;
      if (!mentioned(track.title, text)) gaps.push(`pista ${position} «${track.title}»`);
      else if (typeof track.durationSeconds === "number" && !raw.includes(duration(track.durationSeconds)))
        gaps.push(`duración de la pista ${position} (${duration(track.durationSeconds)})`);
    }
    for (const credit of op.credits) {
      gaps.push(refGap(credit.target, "crédito de", text, context));
      if (!isGeneric(credit.role) && !mentioned(credit.role, text)) gaps.push(`rol «${credit.role}»`);
    }
    for (const genre of op.genres) if (!mentioned(genre.slug, text)) gaps.push(`género «${genre.slug}»`);
    for (const alias of op.aliases) if (!mentioned(alias, text)) gaps.push(`alias «${alias}»`);
    for (const format of op.formats) if (!mentioned(format.format, text)) gaps.push(`formato «${format.format}»`);
  } else if (op.op === "create_entity") {
    const nameKey = op.kind === "track" || op.kind === "album" ? "title" : "name";
    gaps.push(typeof op.values[nameKey] === "string" && mentioned(op.values[nameKey], text) ? null : label(nameKey));
    // A track added to an existing album is checked as inside a complete album: position by list order, duration as m:ss.
    if (op.kind === "track") {
      const seconds = op.values["durationSeconds"];
      if (typeof seconds === "number" && !raw.includes(duration(seconds))) gaps.push(`duración (${duration(seconds)})`);
      fields(op.values, [nameKey, "discNumber", "trackNumber", "durationSeconds"]);
    } else fields(op.values, [nameKey]);
  } else if (op.op === "replace_fields") fields(op.values);
  else if (op.op === "create_relation" || op.op === "replace_relation") {
    const values = Object.entries(op.values).filter(
      ([key, v]) => ["role", "format", "fromYear", "toYear"].includes(key) && (typeof v === "string" || typeof v === "number") && !isGeneric(v),
    );
    for (const [key, v] of values) if (!(key === "role" ? roleMentioned(v as string | number, text) : mentioned(v as string | number, text))) gaps.push(`${key === "role" ? "rol" : key === "format" ? "formato" : key === "fromYear" ? "desde" : "hasta"} «${v}»`);
    if (op.op === "create_relation") for (const ref of Object.values(op.endpoints)) gaps.push(refGap(ref, "relación con", text, context));
    else if (!values.length) gaps.push("valores de la relación");
  } else if (op.op === "add_alias") gaps.push(mentioned(op.alias, text) ? null : `alias «${op.alias}»`);
  // A profile is supported by citing its own page, its address or its @handle.
  else if (op.op === "add_social_link") {
    const bare = op.url.toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/u, "").replace(/[/?#]+$/u, "");
    // A display name such as «Jeremías Música» does not give the address; only a handle that is the profile's path does.
    const handle = op.handle?.replace(/^@/u, "").toLowerCase();
    const path = bare.split("/").filter(Boolean).at(-1) ?? "";
    const ownHandle = handle && !/\s/u.test(handle) && path === handle ? raw.toLowerCase().includes(handle) : false;
    gaps.push(cited.some((e) => sameSocialUrl(e.url, op.url)) || raw.toLowerCase().includes(bare) || ownHandle ? null : `red ${op.platform} no citada`);
  }
  else if (op.op === "assign_genre" || op.op === "remove_genre") gaps.push(genreCited(op.genreSlug, text, context) ? null : `género «${op.genreSlug}»`);
  // Identity fusion, removal and ordering cannot be established by a generic artist excerpt.
  else gaps.push("requiere decisión editorial");
  return [...new Set(gaps.filter((gap): gap is string => gap !== null))];
}
/** A citation's existence does not establish relevance. Ambiguous editorial acts need explicit review. */
export function hasRelevantEvidence(
  op: CatalogOperation,
  evidence: CatalogEvidence[],
  context: EvidenceContext = {},
): boolean {
  return evidenceGaps(op, evidence, context).length === 0;
}
/** Raised by the executor so previews can list exactly which parts lack support. */
export class EvidenceGapError extends Error {
  constructor(readonly gaps: string[]) {
    super(`Respaldo insuficiente: ${gaps.join("; ")}. Revisa las fuentes o confirma un criterio editorial.`);
  }
}
