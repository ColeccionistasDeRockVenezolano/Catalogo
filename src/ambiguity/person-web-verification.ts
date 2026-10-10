import { moduleLogger } from "../logger/index.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { compareCatalog, catalogSignature, type ComparisonCitation, type ComparedPerson, type PersonComparison } from "../review/person-comparison.js";
import { loadPersonFacts, type PersonFacts } from "../review/person-candidates.js";
import { getPool } from "../db/client.js";
import { createDeepSeekGateway, DeepSeekValidationError, type DeepSeekGateway } from "../ai/gateway.js";
import { eraSplit, lifeIssues, type EraSplit } from "../curation/person-timeline.js";
import { eraConflictBetween, loadPersonTimelines } from "../merge/era-guard.js";
import { WebSearchBroker, type WebPage } from "./web-search.js";
import { metalArchivesArtistUrls } from "./archive-records.js";
import { discogsPages, type DiscogsArtistPage } from "./discogs-credits.js";

const verificationLogger = moduleLogger("person-web-verification");
const debugVerification = (...details: unknown[]) => verificationLogger.debug({ details }, "detalle de verificación");

const FACT_KINDS = ["identity", "alias", "birth", "death", "age", "family", "full_name", "credit"] as const;
const VERIFICATION_RULES_VERSION = "identity-comparison-v3";
export type FactKind = typeof FACT_KINDS[number];
// El modelo manda null o textos largos en lo opcional: se tolera y se recorta; lo que importa lo verifica el código.
const yearField = z.union([z.number(), z.string(), z.null()]).optional().transform((value) => {
  const year = typeof value === "string" ? Number(value.match(/\d{4}/u)?.[0]) : value ?? undefined;
  return year && year > 1850 && year < 2100 ? Math.trunc(year) : undefined;
});

const optionalText = z.string().nullish().transform((text) => text?.trim().slice(0, 120) || undefined);

const evidenceItemSchema = z.object({
  source: z.number().int().nonnegative().nullish(), index: z.number().int().nonnegative().nullish(),
  quote: z.string().nullish(), text: z.string().nullish(),
  // Qué hecho prueba la cita y de qué ficha habla: lo comprueba el código, no el modelo.
  ficha: z.enum(["a", "b", "both"]).nullish().catch(undefined),
  kind: z.enum(FACT_KINDS).nullish().catch(undefined),
  supports: z.enum(["same", "different", "mixed"]).nullish().catch(undefined),
  year: yearField, fullName: optionalText,
  age: z.union([z.number(), z.string(), z.null()]).optional().transform((value) => {
    const age = typeof value === "string" ? Number(value.match(/\d{1,2}/u)?.[0]) : value ?? undefined;
    return age && age >= 5 && age <= 40 ? Math.trunc(age) : undefined;
  }),
}).passthrough().transform((item): EvidenceItem => ({ source: item.source ?? item.index ?? -1, quote: (item.quote ?? item.text ?? "").slice(0, 600),
  supports: item.supports ?? undefined,
  ...(item.ficha ? { ficha: item.ficha } : {}), ...(item.kind ? { kind: item.kind } : {}),
  ...(item.year ? { year: item.year } : {}), ...(item.fullName ? { fullName: item.fullName } : {}), ...(item.age ? { age: item.age } : {}) }));
const groupSchema = z.object({
  label: z.string().nullish().transform((text) => (text ?? "").slice(0, 160)), projects: z.array(z.string()).nullish().transform((list) => (list ?? []).slice(0, 40)),
  source: z.number().int().nonnegative().nullish(), quote: z.string().nullish().transform((text) => text?.slice(0, 600)),
  fullName: optionalText, birthYear: yearField, deathYear: yearField,
}).passthrough();
/** Lista tolerante: un elemento mal formado se descarta, no tumba la respuesta entera. */
function lenient<T extends z.ZodTypeAny>(schema: T, max: number) {
  return z.array(z.unknown()).nullish().transform((list) => (list ?? []).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data as z.output<T>] : [];
  }).slice(0, max));
}

export const webVerdictSchema = z.object({
  verdict: z.enum(["same", "different", "mixed", "unknown"]),
  rationale: z.string().min(1).transform((text) => text.slice(0, 1500)),
  evidence: lenient(evidenceItemSchema, 16),
  // Solo para fichas mezcladas: cada persona con los proyectos de la ficha que le tocan.
  groups: lenient(groupSchema, 4).optional(),
  // Dudas en cualquier forma (texto, lista de textos o de objetos): solo se muestran, no deciden nada.
  uncertainties: z.unknown().transform((value) => (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value])
    .slice(0, 8).map((item) => (typeof item === "string" ? item : JSON.stringify(item) ?? "").slice(0, 300))),
}).strict();
export type WebVerdict = z.infer<typeof webVerdictSchema>;
interface EvidenceItem { source: number; quote: string; supports?: "same" | "different" | "mixed" | undefined;
  ficha?: "a" | "b" | "both"; kind?: FactKind; year?: number; fullName?: string; age?: number; }

export interface VerifiedEvidence { url: string; title: string; quote: string; supports: "same" | "different" | "mixed"; }
export interface VerificationView {
  comparison?: PersonComparison | null;
  id: number; reviewId: number | null; personId: number | null; dossierHash: string; status: string; verdict: WebVerdict["verdict"];
  rationale: string; evidence: VerifiedEvidence[]; sources: Array<{ url: string; title: string; contentHash: string }>;
  createdAt: string; reviewedBy: string | null; reviewNote: string | null;
}

export interface PersonProject { name: string; album?: string | null; year: number | null; role: string;
  /** Cómo acreditó la fuente a la persona en ese disco («José "Cheo" Navarro», «Rudy»). */
  credited?: string[]; }
export interface PersonContext { id: number; name: string; birthDate: string | null; deathDate: string | null; projects: PersonProject[];
  sourceUrls: string[]; }

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[“”„«»]/gu, '"').replace(/[‘’´`]/gu, "'")
    .replace(/\s+/gu, " ").trim().toLocaleLowerCase("es");
}

/**
 * El crédito dice que estuvo ahí ese año: algún rol que no es solo de autor. Una canción vieja se graba
 * tarde, pero «Guitar & Tiple, composer» sí lo pone en el estudio.
 */
function performed(role: string): boolean {
  return role.split(/,\s*/u).some((part) => part.trim() && !/compos|letr|writer|lyric|autor/iu.test(part));
}

/**
 * Créditos que solo se hacen en vida y al publicar: mezcla, masterización, producción, grabación, arreglos o
 * entrar a una banda. Después de morir alguien sigue saliendo como intérprete (Héctor Cabrera, m. 2003, canta
 * en una recopilación de 2007), pero no mezcla un disco nuevo (James Brown, m. 2006, no mezcló a Caramelos en 2010).
 */
export function aliveOnly(role: string): boolean {
  return /mix|mezcl|master|produc|record|grab|engineer|ingenier|arreg|arrang|remix|integrante/iu.test(role);
}

/** Edad mínima para figurar en un crédito (la misma de person-timeline). */
const MIN_ACTIVE_AGE = 12;
// Sin «son»: en español es el verbo ser o el género (pasó con Famasloop). 
const POSSESSIVE = new Set(["su", "sus", "his", "her", "their"]);
const FAMILY = /\b(padre|hijo|hija|madre|hermano|hermana|sobrino|sobrina|abuelo|nieto|father|daughter|brother|sister)\b/u;
const SCHOOL = /\b(colegial|intercolegial|colegio|liceo|bachillerato|secundaria|high school|estudiantes de (primaria|secundaria|bachillerato))\b/u;
const LIFE_FACT = /\b(colegial|intercolegial|colegio|liceo|bachillerato|nacio|nacido|nacida|born|murio|fallecio|died|padre|hijo|hermano|father|son of|(con|a los|tenia) ([5-9]|[1-3]\d) anos)\b/u;
const DISCOGS_PAGE = /^https?:\/\/(www\.)?discogs\.com\//u;
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "di", "van", "von", "jr", "sr"]);

/** Distancia de edición con trasposición de dos letras como un solo error («Quinteor» → «Quintero»). */
function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

// Hipocorísticos frecuentes: «Chu» es Jesús, «Cheo» es José. Lista corta a propósito; lo demás se
// compara por igualdad, una errata o un prefijo («Joseíto» empieza por «José»).
const HYPOCORISTICS: Record<string, string[]> = {
  jose: ["cheo", "pepe", "pepito", "chepe"], jesus: ["chu", "chucho", "chuy", "chuito"], antonio: ["tono", "tony", "toni"],
  francisco: ["pacho", "paco", "pancho", "frank", "kiko", "chico"], rodolfo: ["rudy", "fito"], alejandro: ["alex", "jando"],
  manuel: ["manolo", "manu"], guillermo: ["memo", "willy"], ignacio: ["nacho"], roberto: ["beto", "bobby"], eduardo: ["lalo", "eddy", "eddie"],
  enrique: ["kike", "quique"], alfredo: ["freddy", "fredy"], gregorio: ["goyo"], luis: ["lucho"], rafael: ["rafa", "felo"],
};

/** Nombres de pila de un nombre: el primero y el apodo entre comillas («José "Cheo" Rodríguez» → jose, cheo). */
function givenNames(name: string): string[] {
  const nickname = normalize(name).match(/"([^"]+)"|'([^']+)'/u);
  const first = nameTokens(name.replace(/["“”«»][^"“”«»]*["“”«»]/gu, " "))[0];
  return [first, ...(nickname ? nameTokens(nickname[1] ?? nickname[2] ?? "") : [])].filter((token): token is string => Boolean(token));
}

/** Dos nombres de pila que pueden ser de la misma persona. */
function sameGiven(a: string, b: string): boolean {
  if (a === b || levenshtein(a, b) <= 1) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return Object.entries(HYPOCORISTICS).some(([full, short]) => [full, ...short].includes(a) && [full, ...short].includes(b));
}

/** El nombre (de un grupo, de un pariente) puede ser una forma del nombre de la ficha: Carlos «Nené» Quintero no es Jesús «Chu» Quintero. */
export function givenCompatible(name: string, fichaName: string): boolean {
  const mine = givenNames(fichaName); const theirs = givenNames(name);
  if (!mine.length || !theirs.length || nameTokens(name).length < 2) return true;
  // «Romero Bello»: empieza por un apellido de la ficha, no trae nombre de pila que comparar.
  if (nameTokens(fichaName).slice(1).includes(nameTokens(name)[0]!)) return true;
  return theirs.some((token) => mine.some((other) => sameGiven(token, other)));
}

/**
 * La cita habla de dos parientes que se llaman como las fichas: «José Romero Bello … father of arpa player Joseito
 * Romero» sí; «Neguito Borjas … brother of Heberto Beto Borjas» no (un hermano con otro nombre no es la pregunta),
 * ni «Carlos Nené Quintero … his brother Jesús Chú Quintero» (solo uno de los dos puede ser la ficha).
 * Cuenta las menciones «nombre(s) + apellido de la ficha» cuyo nombre de pila es compatible con el de la ficha:
 * hacen falta dos, y una de ellas justo después de la palabra de parentesco.
 */
export function namesakeFamily(quote: string, names: readonly string[]): boolean {
  return namesakeRelative(quote, names) !== null;
}

/**
 * El nombre propio del pariente de la cita, lo que lo distingue del otro: «father of arpa player Joseito Romero»
 * → «joseito»; «hijo del maestro Ezequiel Serrano» → «» (se llama igual; los créditos no lo distinguen).
 * null si la cita no habla de dos parientes que se llamen como las fichas.
 */
export function namesakeRelative(quote: string, names: readonly string[]): string | null {
  const tokens = plain(quote).trim().split(" ");
  const surnames = new Set(names.map((name) => nameTokens(name).at(-1)).filter((token): token is string => Boolean(token)));
  // Hasta tres palabras antes del apellido pueden ser el nombre («arpa player Joseito Romero» → joseito romero).
  const window = (at: number) => [2, 3, 4].map((size) => at + 1 >= size ? tokens.slice(at + 1 - size, at + 1) : [])
    .find((part) => part.length && !part.slice(0, -1).some((token) => surnames.has(token))
      && names.some((name) => givenCompatible(part.join(" "), name)));
  const mentions = tokens.flatMap((token, at) => surnames.has(token) && window(at) ? [at] : []);
  if (mentions.length < 2) return null;
  for (let at = 0; at < tokens.length; at += 1) {
    if (!FAMILY.test(tokens[at]!)) continue;
    // «father of … Joseito Romero» (el pariente va después) o «Tony Casas, su hijo» (justo antes del posesivo).
    const after = mentions.find((mention) => mention > at && mention - at <= 8);
    const before = POSSESSIVE.has(tokens[at - 1] ?? "") ? mentions.find((mention) => mention < at - 1 && at - 1 - mention <= 2) : undefined;
    const relative = after ?? before;
    if (relative === undefined) continue;
    const others = new Set(mentions.filter((mention) => mention !== relative).flatMap((mention) => window(mention) ?? []));
    return (window(relative) ?? []).slice(0, -1).filter((token) => !others.has(token) && token !== tokens[at]).join(" ");
  }
  return null;
}

/**
 * Cita con su contexto: el sujeto de la página (en un perfil, «father of arpa player Joseito Romero» habla de
 * quien da título a la página) y lo que la página dice justo antes («Antonio Toño Casas fundó Wahala. Tony
 * Casas, su hijo…»: el «su» es de la frase anterior).
 */
function withSubject(item: { quote: string; title?: string; page?: WebPage }): string {
  const title = (item.title ?? item.page?.title ?? "").split(/\s[|–—-]\s/u)[0] ?? "";
  const content = item.page ? plain(item.page.content) : "";
  const at = content.indexOf(plain(item.quote).trim());
  const before = at > 0 ? content.slice(Math.max(0, at - 200), at) : "";
  return `${title}. ${before} ${item.quote}`;
}

/** Apellidos y segundos nombres: lo que sigue al primer nombre, sin el apodo entre comillas. */
function surnames(name: string): string[] {
  const tokens = normalize(name).replace(/"[^"]*"|'[^']*'|\([^)]*\)/gu, " ").split(/[^\p{L}]+/u)
    .filter((token) => token.length > 1 && !PARTICLES.has(token));
  return tokens.slice(1);
}

/**
 * Dos nombres completos que no pueden ser de la misma persona: ninguno contiene los
 * apellidos del otro, ni siquiera con una errata de una letra. «Neguito Borjas» cabe en
 * «Abdenago de Jesús Borjas Urdaneta» y «Grego» es errata de «Greco»; «José Romero Bello»
 * y «José Pedro Romero Ignacio» no caben uno en el otro.
 */
export function incompatibleNames(x: string, y: string): boolean {
  const a = surnames(x); const b = surnames(y);
  if (!a.length || !b.length) return false;
  const has = (list: string[], token: string) => list.some((other) => levenshtein(other, token) <= 1);
  return !a.every((token) => has(b, token)) && !b.every((token) => has(a, token));
}

function mentionsAny(text: string, projects: readonly string[]): boolean {
  const haystack = normalize(text);
  return projects.some((project) => project !== "Various Artists" && normalize(project).length >= 3 && haystack.includes(normalize(project)));
}

export interface SamePolicyContext {
  names: [string, string]; sharedProjects: string[]; projectsA?: string[]; projectsB?: string[];
  /** Títulos de los discos de cada ficha: «Dubdelic» liga a Rafael Greco con Patafunk. */
  albumsA?: string[]; albumsB?: string[];
  /** Años de los créditos fechados de cada ficha (sin composiciones ni recopilatorios). */
  yearsA?: number[]; yearsB?: number[]; eraConflict?: string | null;
  /** Años de créditos que solo se hacen en vida (mezcla, producción…): los únicos que cuentan después de morir. */
  aliveYearsA?: number[]; aliveYearsB?: number[];
  /** Años de nacimiento guardados en las fichas. */
  birthA?: number | null; birthB?: number | null;
}
interface CheckedEvidence extends VerifiedEvidence { item: EvidenceItem; page: WebPage; }

/**
 * La página donde está literalmente la cita. El modelo a veces da el índice equivocado
 * (cita bien la frase de la página 4 y dice «1»): se busca primero donde dijo y luego en las demás.
 */
function pageWithQuote(pages: readonly WebPage[], source: number | null | undefined, quote: string | null | undefined): WebPage | undefined {
  if (!quote || normalize(quote).length < 8) return undefined;
  const needle = normalize(quote);
  const stated = source === null || source === undefined ? undefined : pages[source];
  if (stated && normalize(stated.content).includes(needle)) return stated;
  return pages.find((page) => normalize(page.content).includes(needle));
}

function checkEvidence(proposal: WebVerdict, pages: WebPage[]): CheckedEvidence[] {
  const out: CheckedEvidence[] = [];
  for (const item of proposal.evidence) {
    const page = pageWithQuote(pages, item.source, item.quote);
    if (!page) continue;
    const supports = item.supports ?? (proposal.verdict === "unknown" ? "same" : proposal.verdict);
    out.push({ url: page.url, title: page.title, quote: item.quote, supports, item, page });
  }
  return out;
}

/** La cita (o su página) habla de esta ficha: nombra uno de sus proyectos. */
function about(evidence: CheckedEvidence, projects: readonly string[]): boolean {
  return mentionsAny(evidence.quote, projects) || mentionsAny(evidence.page.content, projects);
}

/** Formas de buscar el nombre en una página: completo sin comillas, apodo + apellido, nombre + último apellido. */
export function nameForms(name: string): string[] {
  const tokens = nameTokens(name);
  const forms = new Set([tokens.join(" "), plain(searchName(name)).trim()]);
  if (tokens.length >= 3) forms.add(`${tokens[0]} ${tokens.at(-1)}`);
  // Nombre, segundo nombre y dos apellidos: se le conoce por el paterno («Édgar Enrique Quintero Castillo» → «edgar quintero»).
  if (tokens.length >= 4) forms.add(`${tokens[0]} ${tokens.at(-2)}`);
  // Un nombre de una sola palabra («Kenny», «Piti») se busca tal cual si no es muy corto.
  return [...forms].filter((form) => form.split(" ").length >= 2 || (tokens.length === 1 && form.length >= 4));
}

/** Texto para buscar coincidencias: sin acentos, comillas ni puntuación («Carlos "Nené" Quintero» → carlos nene quintero). */
function plain(value: string): string {
  return ` ${normalize(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

const GENERIC_ALBUM = /^(vol(umen)? \d+|grandes exitos|exitos|en vivo|live|greatest hits|lo mejor de .*|\d+ exitos.*|navidad|homenaje.*|sencillo|single|ep|demo|exitos de .*)$/u;
/** Artistas y títulos de disco: un título suelto cuenta si es distintivo (≥ 8 letras o varias palabras). */
function projectTerms(projects: readonly string[], albums: readonly string[]): string[] {
  const artists = projects.filter((name) => name !== "Various Artists").map((name) => plain(name).trim()).filter((term) => term.length >= 3);
  const titles = albums.map((title) => plain(title).trim())
    .filter((term) => !GENERIC_ALBUM.test(term) && (term.length >= 8 || term.split(" ").length >= 2) && term.length >= 5);
  return [...new Set([...artists, ...titles])];
}

export interface PageLink { url: string; snippet: string; }
/**
 * El código, no el modelo, busca en el texto guardado si el nombre aparece cerca de un
 * proyecto (±250 caracteres): «Rafael Greco … Dubdelic». Devuelve la primera coincidencia por página.
 */
export function findLinks(pages: readonly WebPage[], forms: readonly string[], terms: readonly string[], extra: readonly string[] = []): PageLink[] {
  const links: PageLink[] = [];
  const hit = (window: string, list: readonly string[]) => list.some((term) => window.includes(` ${term} `));
  for (const page of pages) {
    const text = plain(page.content);
    // En Sincopa y similares el título es «Artista - Disco»: la página entera es de ese proyecto.
    const title = plain(page.title);
    let found: PageLink | null = null;
    for (const form of forms) {
      const needle = ` ${form} `;
      for (let at = text.indexOf(needle); at >= 0 && !found; at = text.indexOf(needle, at + needle.length - 1)) {
        const window = ` ${text.slice(Math.max(0, at - 250), at + needle.length + 250)} `;
        const near = (list: readonly string[]) => hit(window, list) || hit(title, list);
        if (near(terms) && (!extra.length || near(extra))) {
          found = { url: page.url, snippet: text.slice(Math.max(0, at - 100), at + needle.length + 100).trim() };
        }
      }
      if (found) break;
    }
    if (found) links.push(found);
  }
  return links;
}

/**
 * Edad citada en un año («con 15 años», «mejor banda colegial»): el nacimiento más temprano posible, o null.
 * Lo lee el código en la cita, sin importar cómo la etiquetó el modelo. El año sale de la cita, del año que dio
 * el modelo si está en la cita, o del título o la dirección de la página (la nota del festival de 2012).
 */
function earliestBirth(item: CheckedEvidence): number | null {
  const quote = normalize(item.quote);
  // Edad, no duración: «con 15 años», «a los 15 años», «15 years old», «at age 15»; no «lasted 21 years» ni «durante 20 años».
  const age = Number((/\b(?:con|a los|de|tenia|tenian|cumplidos) ([5-9]|[1-3]\d) anos\b/u.exec(quote)
    ?? /\b([5-9]|[1-3]\d) (?:years? old|anos de edad)\b/u.exec(quote) ?? /\bat (?:the )?age (?:of )?([5-9]|[1-3]\d)\b/u.exec(quote))?.[1]) || null;
  if (!age && !SCHOOL.test(quote)) return null;
  const inQuote = item.quote.match(/\b(19[3-9]\d|20[0-4]\d)\b/u)?.[0];
  const stated = item.item.year && item.quote.includes(String(item.item.year)) ? item.item.year : null;
  const inPage = `${item.page.title} ${item.page.url}`.match(/\b(19[3-9]\d|20[0-4]\d)\b/u)?.[0];
  const year = stated ?? (inQuote ? Number(inQuote) : inPage ? Number(inPage) : null);
  if (!year) return null;
  return age ? year - age - 1 : year - 19;
}

const STRONG_SCHOOL = /\b(colegial|colegiales|intercolegial|banda del colegio|banda escolar|estudiantes de bachillerato|liceistas|high school band)\b/u;

/**
 * Datos de edad que el código encuentra solo, en el texto guardado, junto a un proyecto de una sola ficha:
 * «mejor banda colegial "Niuno Niotro"» (año de la página: la nota del festival de 2012) o «con 15 años» con su
 * año en la misma frase. No depende de que el modelo lo cite ni de cómo lo etiquete.
 */
function pageAgeFacts(pages: readonly WebPage[], projects: { a: string[]; b: string[] }): Array<{ side: "a" | "b"; birth: number; quote: string; url: string }> {
  const facts: Array<{ side: "a" | "b"; birth: number; quote: string; url: string }> = [];
  for (const page of pages) {
    if (DISCOGS_PAGE.test(page.url)) continue;
    const text = plain(page.content);
    const pageYear = `${page.title} ${page.url}`.match(/\b(19[3-9]\d|20[0-4]\d)\b/u)?.[0];
    for (const side of ["a", "b"] as const) {
      const other = side === "a" ? "b" : "a";
      for (const term of projectTerms(projects[side].filter((name) => !projects[other].includes(name)), [])) {
        for (let at = text.indexOf(` ${term} `); at >= 0; at = text.indexOf(` ${term} `, at + term.length)) {
          const window = text.slice(Math.max(0, at - 200), at + term.length + 200);
          if (projectTerms(projects[other], []).some((otherTerm) => window.includes(` ${otherTerm} `))) continue;
          const inWindow = window.match(/\b(19[3-9]\d|20[0-4]\d)\b/u)?.[0];
          const age = Number(/\b(?:con|a los|de|tenia|tenian) ([5-9]|1\d) anos\b/u.exec(window)?.[1]) || null;
          let birth: number | null = null;
          if (age && inWindow) birth = Number(inWindow) - age - 1;
          else if (STRONG_SCHOOL.test(window) && (inWindow ?? pageYear)) birth = Number(inWindow ?? pageYear) - 19;
          if (birth) { facts.push({ side, birth, quote: window.trim(), url: page.url }); break; }
        }
      }
    }
  }
  return facts;
}

/** Contradicción comprobable entre las dos fichas, o null. Rol, género o década distintos no cuentan. */
function contradiction(evidence: CheckedEvidence[], context: SamePolicyContext, pages: readonly WebPage[] = [], pseudonym = false): string | null {
  const projects = { a: context.projectsA ?? [], b: context.projectsB ?? [] };
  const years = { a: context.yearsA ?? [], b: context.yearsB ?? [] };
  const names = { a: context.names[0], b: context.names[1] };
  if (context.eraConflict) return context.eraConflict;
  // El veto de fusiones no cuenta «menor de 12 años»; aquí sí: nadie toca el saxo al año de nacer.
  for (const [side, birth] of [["a", context.birthA], ["b", context.birthB]] as const) {
    const other = side === "a" ? "b" : "a";
    const early = birth ? years[other].filter((credit) => credit < birth + MIN_ACTIVE_AGE) : [];
    if (birth && early.length) return `${names[side]} nació en ${birth} según su ficha y la otra tiene créditos de ${Math.min(...early)}`;
  }
  // Solo una lleva «Hijo» o «Jr.» y una misma frase nombra a los dos por separado («Vocals: Hernán Gamboa y Hernán
  // Gamboa Jr.»): la fuente distingue a dos personas. Sin marca de alias («Jr., conocido como…» sería el mismo).
  if (generation(names.a) !== generation(names.b)) {
    const sentences = [...evidence.map((item) => item.quote),
      ...pages.filter((page) => !DISCOGS_PAGE.test(page.url)).flatMap((page) => page.content.split(/(?<=[.;!?])\s+|\n+/u))];
    const both = sentences.find((sentence) => sentence.length <= 400 && !ALIAS_MARKER.test(plain(sentence)) && namesBoth(sentence, names.a, names.b));
    if (both) return `una misma frase nombra por separado a ${names.a} y a ${names.b}: «${both.trim()}»`;
  }
  // Con una cita de seudónimo («Emidio Falconi a.k.a Baffa») los apellidos distintos son lo esperable.
  if (!pseudonym && incompatibleNames(names.a, names.b)) return `apellidos distintos en las fichas: ${names.a} / ${names.b}`;
  const surname = (name: string) => nameTokens(name).at(-1) ?? "";
  const family = evidence.find((item) => namesakeFamily(withSubject(item), [names.a, names.b]) && about(item, projects.a) && about(item, projects.b)
    && [names.a, names.b].some((name) => nameTokens(item.quote).includes(surname(name))));
  if (family) return `relación familiar citada: «${family.quote}»`;
  for (const side of ["a", "b"] as const) {
    const other = side === "a" ? "b" : "a";
    for (const item of evidence) {
      const year = item.item.year;
      if (item.item.kind !== "birth" || item.item.ficha !== side || !year || !item.quote.includes(String(year)) || !about(item, projects[side])) continue;
      const early = years[other].filter((credit) => credit < year + MIN_ACTIVE_AGE);
      if (early.length) return `${names[side]} nació en ${year} y la otra ficha tiene créditos de ${Math.min(...early)}`;
    }
  }
  for (const side of ["a", "b"] as const) {
    const other = side === "a" ? "b" : "a";
    for (const item of evidence) {
      const year = item.item.year;
      if (item.item.ficha !== side || !year || !about(item, projects[side])) continue;
      // Nadie mezcla ni produce después de morir (un año de gracia); cantar en una recopilación póstuma sí se puede.
      if (item.item.kind === "death" && item.quote.includes(String(year))) {
        const late = (other === "a" ? context.aliveYearsA ?? [] : context.aliveYearsB ?? []).filter((credit) => credit > year + 1);
        if (late.length) return `${names[side]} murió en ${year} y la otra ficha tiene créditos de ${Math.max(...late)}`;
      }
    }
  }
  for (const fact of pageAgeFacts(pages, projects)) {
    const other = fact.side === "a" ? "b" : "a";
    const early = years[other].filter((credit) => credit < fact.birth + MIN_ACTIVE_AGE);
    if (early.length) return `${names[fact.side]} no pudo nacer antes de ${fact.birth} («${fact.quote}», ${fact.url}) y la otra ficha tiene créditos de ${Math.min(...early)}`;
  }
  // Edad documentada en un año: «con 15 años», o banda colegial (a lo sumo 19 años). La cita tiene que nombrar
  // un proyecto de una sola de las fichas; esa es la ficha de la que habla.
  for (const item of evidence) {
    const birth = earliestBirth(item);
    if (!birth) continue;
    const sides = (["a", "b"] as const).filter((side) => mentionsAny(item.quote, projects[side]));
    if (sides.length !== 1) continue;
    const side = sides[0]!; const other = side === "a" ? "b" : "a";
    const early = years[other].filter((credit) => credit < birth + MIN_ACTIVE_AGE);
    if (early.length) return `${names[side]} no pudo nacer antes de ${birth} («${item.quote}») y la otra ficha tiene créditos de ${Math.min(...early)}`;
  }
  const fullName = (side: "a" | "b") => evidence.filter((item) => item.item.kind === "full_name" && item.item.ficha === side && item.item.fullName
    && normalize(item.quote).includes(normalize(item.item.fullName)) && about(item, projects[side])
    && !incompatibleNames(item.item.fullName, names[side]));
  for (const left of fullName("a")) {
    const right = fullName("b").find((item) => incompatibleNames(left.item.fullName!, item.item.fullName!));
    if (right) return `nombres completos distintos: ${left.item.fullName} / ${right.item.fullName}`;
  }
  return null;
}

function nameTokens(name: string): string[] {
  return normalize(name).replace(/["'()]/gu, " ").split(/[^\p{L}]+/u).filter((token) => token.length > 1 && !PARTICLES.has(token));
}

/** Prefijos de escena que no son parte del nombre: «Dj Baffa» es «Baffa» en «Emidio Falconi a.k.a Baffa». */
const STAGE_PREFIX = new Set(["dj", "mc", "dr", "lil"]);
/** Marca de seudónimo en una cita: «a.k.a», «conocida por el nombre artístico», «Real Name:». */
const ALIAS_MARKER = /\b(a\s?k\s?a|aka|alias|conocid[oa]s? (como|por)|known as|nombre artistico|nombre real|real name|seudonimo|pseudonym|stage name|apodad[oa]|bajo el nombre)\b/u;

/** «Hijo», «Jr.», «Junior», «II»: la fuente distingue a dos generaciones con ese nombre. */
const GENERATION = /\b(jr|hijo|hija|junior|ii|iii|sr|padre)\b/u;
function generation(name: string): string | null {
  return GENERATION.exec(plain(name))?.[1] ?? null;
}

/** Los dos nombres, cada uno por su lado: «Juan Vicente Torrealba hijo» no nombra también al padre. */
function namesBoth(quote: string, a: string, b: string): boolean {
  const text = plain(quote); const x = plain(a).trim(); const y = plain(b).trim();
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return text.includes(` ${long} `) && text.replaceAll(` ${long} `, " ").includes(` ${short} `);
}

/** La cita junta las dos formas del nombre («Carlos "Nené" Quintero»), tolerando una errata por palabra. */
function aliasBridge(quote: string, names: [string, string]): boolean {
  // Las palabras que distinguen un nombre del otro deben estar tal cual: «Rafael Greco» no une a «Grego».
  const words = new Set(nameTokens(quote));
  const [a, b] = names.map((name) => nameTokens(name).filter((token) => !STAGE_PREFIX.has(token))) as [string[], string[]];
  const distinct = [...a.filter((token) => !b.includes(token)), ...b.filter((token) => !a.includes(token))];
  return distinct.length > 0 && [...a, ...b].every((token) => words.has(token));
}

/**
 * Decide con hechos verificados, no con la conclusión del modelo (DeepSeek flash encuentra
 * buenas citas pero concluye mal: «Neguito» con su nombre completo citado y aun así «unknown»).
 *   · same: nombres compatibles, sin parentesco ni veto de épocas, y la web liga a la persona
 *     con un proyecto de la OTRA ficha (proyecto común), o una cita une las dos formas del nombre
 *     y la web liga cada ficha con lo suyo. Con nombres idénticos solo vale si el modelo lo afirma
 *     y una misma página liga ambos proyectos.
 *   · different: la web liga cada ficha con lo suyo y hay una contradicción (épocas, apellidos,
 *     parentesco, nacimiento o nombre completo).
 */
export function validateWebVerdict(proposal: WebVerdict, pages: WebPage[], context?: SamePolicyContext): { verdict: WebVerdict["verdict"]; evidence: VerifiedEvidence[]; rationale: string } {
  const checked = checkEvidence(proposal, pages);
  const evidence: VerifiedEvidence[] = checked.map(({ url, title, quote, supports }) => ({ url, title, quote, supports }));
  const claimed = proposal.verdict;
  if (!context) {
    // Sin fichas a la vista solo se acepta lo más fuerte: dos sitios que digan lo mismo.
    const sites = new Set(checked.filter((item) => item.supports === claimed).map((item) => siteKey(item.url)));
    const verdict = claimed !== "unknown" && claimed !== "different" && sites.size >= 2 ? claimed : "unknown";
    return { verdict, evidence, rationale: verdict === "unknown" && claimed !== "unknown" ? `Sin cita comprobable para la conclusión. ${proposal.rationale}` : proposal.rationale };
  }
  const projectsA = context.projectsA ?? []; const projectsB = context.projectsB ?? [];
  const termsA = projectTerms(projectsA, context.albumsA ?? []); const termsB = projectTerms(projectsB, context.albumsB ?? []);
  const formsA = nameForms(context.names[0]); const formsB = nameForms(context.names[1]);
  const sameName = normalize(nameTokens(context.names[0]).join(" ")) === normalize(nameTokens(context.names[1]).join(" "));
  const linkA = findLinks(pages, formsA, termsA); const linkB = findLinks(pages, formsB, termsB);
  const hasA = linkA.length > 0; const hasB = linkB.length > 0;
  const family = checked.find((item) => namesakeFamily(withSubject(item), context.names)
    && context.names.some((name) => nameTokens(item.quote).includes(nameTokens(name).at(-1) ?? "")));
  // Solo una lleva «Hijo» o «Jr.»: el nombre ya dice que hay dos generaciones. No se fusiona (tampoco basta para
  // separar: «Emilio Estefan Jr.» y «Emilio Estefan» son el mismo).
  const generations = generation(context.names[0]) !== generation(context.names[1]);
  const compatible = !incompatibleNames(context.names[0], context.names[1]) && !generations;
  // Nombre artístico y nombre real: los apellidos no casan, pero una cita dice que es el mismo con una marca de alias.
  const pseudonym = !compatible && !generations ? checked.find((item) => ALIAS_MARKER.test(plain(item.quote)) && aliasBridge(item.quote, context.names)) : undefined;
  const sites = new Set([...linkA, ...linkB].map((link) => siteKey(link.url)).concat(checked.map((item) => siteKey(item.url))));

  // Misma persona.
  let same: string | null = null;
  if (pseudonym && !context.eraConflict && !family && (hasA || hasB)) same = "Una fuente documenta que un nombre es seudónimo del otro.";
  if (compatible && !context.eraConflict && !family) {
    const directCommonProject = !sameName && checked.some((item) => context.sharedProjects.some((project) => {
      const quote = normalize(item.quote);
      return quote.length > 0 && namesBoth(item.quote, context.names[0], context.names[1]) && mentionsAny(`${item.quote} ${item.page.content}`, [project]);
    }));
    const cross = sameName ? [] : [...findLinks(pages, formsB.filter((form) => !formsA.includes(form)), termsA.filter((term) => !termsB.includes(term))),
      ...findLinks(pages, formsA.filter((form) => !formsB.includes(form)), termsB.filter((term) => !termsA.includes(term)))];
    const alias = !sameName && checked.find((item) => aliasBridge(item.quote, context.names));
    // Discogs junta homónimos en un mismo artista («Francisco González» ingeniero y guitarrista de Recoveco):
    // con el mismo nombre, que Discogs liste los dos proyectos no prueba nada.
    const bothProjects = findLinks(pages.filter((page) => !DISCOGS_PAGE.test(page.url)), [...new Set([...formsA, ...formsB])], termsA.filter((term) => !termsB.includes(term)),
      termsB.filter((term) => !termsA.includes(term)));
    const shared = context.sharedProjects.map((project) => plain(project).trim());
    const sharedLink = sameName || !shared.length ? [] : findLinks(pages, [...new Set([...formsA, ...formsB])], shared);
    if (directCommonProject) same = "una cita une los dos nombres y el proyecto común";
    else if (sharedLink.length) same = "Los nombres son compatibles y una fuente confirma el proyecto común.";
    else if (cross.length) same = "Una fuente vincula una forma del nombre con un proyecto de la otra ficha.";
    else if (alias && hasA && hasB) same = "Una cita verificada vincula las dos formas del nombre; hay fuentes para ambas trayectorias.";
    else if (sameName && claimed === "same" && bothProjects.some((link) => {
      const page = pages.find((p) => p.url === link.url);
      return page?.origin !== "search_snippet" && /^https?:\/\/(?:www\.)?metal-archives\.com\/artists\/[^/]+\/\d+/u.test(link.url)
        && /real(?:\s*\/?\s*full)?\s+name/iu.test(page?.content ?? "");
    })) same = "Un perfil individual del músico documenta los proyectos de ambas fichas.";
    else if (sameName && claimed === "same" && bothProjects.length && sites.size >= 2) same = "Una fuente menciona los proyectos de ambas fichas bajo este nombre y otra fuente respalda la atribución.";
  }
  // Personas distintas.
  // La web debe confirmar a las dos personas, cada una con lo suyo; las fechas solas no bastan.
  const found = hasA && hasB ? contradiction(checked, context, pages, Boolean(pseudonym)) : null;
  let verdict: WebVerdict["verdict"] = "unknown";
  let reason: string;
  if (same && found) reason = `Hay pruebas en los dos sentidos (${found}); queda para revisión. `;
  else if (same) { verdict = "same"; reason = same; }
  else if (found) { verdict = "different"; reason = found; }
  else if (context.eraConflict && claimed === "same") reason = `Las épocas lo impiden: ${context.eraConflict}. `;
  else if (generations) reason = "Solo un nombre lleva «Hijo» o «Jr.»: puede ser el padre o el hijo; no se propone fusión. ";
  else if (family && claimed === "same") reason = `Una cita habla de parentesco («${family.quote}»): no se propone fusión. `;
  else if (!hasA || !hasB) reason = "La web no liga a cada ficha con sus propios proyectos. ";
  else reason = "Rol, género o época distintos no prueban dos personas, y no aparece un proyecto común en la web. ";
  // La explicación pública describe la regla que ganó. La narración libre del
  // modelo puede contradecir el veredicto que el código calculó.
  const rationale = verdict === "unknown" ? reason.trim() : reason;
  return { verdict, evidence, rationale };
}

/** Hueco de ≥ 20 años entre los créditos activos de la ficha, sin un artista en común a los dos lados. */
export function projectEraSplit(person: PersonContext): { gap: number; before: PersonProject[]; after: PersonProject[] } | null {
  const dated = person.projects.filter((item) => item.year !== null && item.name !== "Various Artists" && performed(item.role));
  const years = [...new Set(dated.map((item) => item.year!))].sort((x, y) => x - y);
  let gap = 0; let cut = 0;
  for (let index = 0; index + 1 < years.length; index += 1) {
    if (years[index + 1]! - years[index]! > gap) { gap = years[index + 1]! - years[index]!; cut = years[index]!; }
  }
  if (gap < 20) return null;
  const before = dated.filter((item) => item.year! <= cut); const after = dated.filter((item) => item.year! > cut);
  if (before.some((item) => after.some((other) => other.name === item.name))) return null;
  return { gap, before, after };
}

/** El disco es de ese grupo: su artista, o una recopilación cuyo título lo nombra («Tsee Mud... Bacro... LSD (1968-1971)»). */
function inGroup(project: PersonProject, projects: readonly string[]): boolean {
  if (projects.includes(project.name)) return true;
  return project.name === "Various Artists" && Boolean(project.album) && mentionsAny(project.album!, projects);
}

/**
 * Ficha mezclada. Vale con una de tres pruebas, todas verificadas en el texto guardado:
 *   · grupos del modelo con proyectos reales de la ficha, sin pisarse, de dos sitios, y con
 *     nombres completos o nacimientos incompatibles entre ellos;
 *   · una cita de parentesco cuya página toca proyectos de dos grupos (Toño y Tony Casas);
 *   · un hueco de ≥ 20 años sin artista común en el que la web liga el nombre con cada época
 *     en sitios distintos y ninguna página une las dos (la misma regla que en los pares).
 */
export function validateMixedGroups(proposal: WebVerdict, pages: WebPage[], person: PersonContext, options: { eraSplit?: boolean } = {}): { verdict: WebVerdict["verdict"]; evidence: VerifiedEvidence[]; rationale: string; groups: Array<{ label: string; projects: string[] }> } {
  const own = new Map(person.projects.map((project) => [normalize(project.name), project.name]));
  const groups = (proposal.groups ?? []).flatMap((group) => {
    const page = pageWithQuote(pages, group.source, group.quote);
    if (!page || !group.quote) return [];
    const projects = [...new Set(group.projects.map((name) => own.get(normalize(name))).filter((name): name is string => Boolean(name)))];
    if (!projects.length || !mentionsAny(`${group.quote} ${page.content}`, projects)) return [];
    // El nombre completo tiene que ser una forma del nombre de la ficha: «Leopoldo Betancourt» (el pianista del disco) no es otro Alfredo Gil.
    if (group.fullName && incompatibleNames(group.fullName, person.name)) return [];
    // Y el de pila, del nombre completo o del rótulo («Carlos "Nené" Quintero, percusionista…»): un hermano con otro nombre no mezcla la ficha.
    // Solo si el rótulo es un nombre con el apellido de la ficha: «Violinista de sesión» no es un nombre.
    const named = group.fullName ?? group.label.split(/[,(:;–-]/u)[0]!.trim();
    const surname = nameTokens(person.name).at(-1);
    if (named && surname && nameTokens(named).includes(surname) && !givenCompatible(named, person.name)) return [];
    const fullName = group.fullName && normalize(group.quote).includes(normalize(group.fullName)) ? group.fullName : undefined;
    const birthYear = group.birthYear && group.quote.includes(String(group.birthYear)) ? group.birthYear : undefined;
    const deathYear = group.deathYear && (group.quote.includes(String(group.deathYear)) || normalize(page.content).includes(String(group.deathYear))) ? group.deathYear : undefined;
    return [{ label: group.label, projects, page, quote: group.quote, fullName, birthYear, deathYear }];
  });
  const aliveYearsOf = (projects: string[]) => person.projects
    .filter((project) => projects.includes(project.name) && project.year !== null && aliveOnly(project.role)).map((project) => project.year!);
  const yearsOf = (projects: string[]) => person.projects
    .filter((project) => projects.includes(project.name) && project.year !== null && performed(project.role))
    .map((project) => project.year!);
  let proof: string | null = null;
  let parts: Array<{ label: string; projects: string[] }> = [];
  for (const left of groups) {
    for (const right of groups) {
      if (left === right || proof) continue;
      if (left.projects.some((project) => right.projects.includes(project))) continue;
      if (siteKey(left.page.url) === siteKey(right.page.url)) continue;
      if (left.fullName && right.fullName && incompatibleNames(left.fullName, right.fullName)) proof = `nombres completos distintos: ${left.fullName} / ${right.fullName}`;
      const early = left.birthYear ? yearsOf(right.projects).filter((year) => year < left.birthYear! + MIN_ACTIVE_AGE) : [];
      if (!proof && early.length) proof = `${left.label} nació en ${left.birthYear} y hay créditos de ${Math.min(...early)}`;
      // Nadie mezcla ni produce después de morir (un año de gracia); cantar en una recopilación póstuma sí se puede.
      const late = left.deathYear ? aliveYearsOf(right.projects).filter((year) => year > left.deathYear! + 1) : [];
      if (!proof && late.length) proof = `${left.label} murió en ${left.deathYear} y hay créditos de ${Math.max(...late)}`;
      if (proof) parts = [left, right].map(({ label, projects }) => ({ label, projects }));
    }
  }
  const checked = checkEvidence(proposal, pages);
  if (process.env["CRV_DEBUG_VERIFY"]) debugVerification("[grupos]", JSON.stringify({ groups: groups.map((g) => ({ label: g.label, projects: g.projects, url: g.page.url, death: g.deathYear, birth: g.birthYear, full: g.fullName })),
    family: checked.filter((item) => FAMILY.test(normalize(item.quote))).map((item) => [item.quote.slice(0, 120), namesakeRelative(withSubject(item), [person.name])]) }));
  if (!proof && groups.length >= 2) {
    const family = checked.find((item) => namesakeFamily(withSubject(item), [person.name]) && nameTokens(item.quote).includes(nameTokens(person.name).at(-1) ?? "")
      && groups.filter((group) => about(item, group.projects)).length >= 2);
    if (family) { proof = `relación familiar citada: «${family.quote}»`; parts = groups.map(({ label, projects }) => ({ label, projects })); }
  }
  // La fuente nombra al pariente («tuvo un hijo, José (Joseíto Romero), arpista») y los créditos de otro grupo
  // están firmados con ese nombre: la ficha junta al de la página con su pariente.
  if (!proof && groups.length >= 2) {
    for (const item of checked) {
      const relative = namesakeRelative(withSubject(item), [person.name]);
      if (!relative) continue;
      const subject = groups.find((group) => about(item, group.projects));
      const signed = groups.find((group) => group !== subject && person.projects.some((project) => inGroup(project, group.projects)
        && (project.credited ?? []).some((credited) => plain(credited).includes(` ${relative} `))));
      if (!subject || !signed) continue;
      proof = `${subject.label}: la fuente nombra a su pariente «${relative}», y así firman los créditos de ${signed.label}`;
      parts = [subject, signed].map(({ label, projects }) => ({ label, projects }));
      break;
    }
  }
  const split = options.eraSplit === false ? null : projectEraSplit(person);
  if (!proof && split) {
    const forms = nameForms(person.name);
    const termsOf = (side: PersonProject[]) => projectTerms([...new Set(side.map((item) => item.name))], side.flatMap((item) => item.album ? [item.album] : []));
    const before = termsOf(split.before); const after = termsOf(split.after);
    const linkBefore = findLinks(pages, forms, before); const linkAfter = findLinks(pages, forms, after);
    const bridge = findLinks(pages, forms, before, after);
    const sites = new Set([...linkBefore, ...linkAfter].map((link) => siteKey(link.url)));
    if (linkBefore.length && linkAfter.length && !bridge.length && sites.size >= 2) {
      const range = (side: PersonProject[]) => `${Math.min(...side.map((item) => item.year!))}–${Math.max(...side.map((item) => item.year!))}`;
      proof = `épocas separadas por ${split.gap} años (${range(split.before)} / ${range(split.after)}) sin artista común; la web confirma cada una por separado («${linkBefore[0]!.snippet}» · «${linkAfter[0]!.snippet}») y ninguna página las une`;
      parts = [{ label: `época ${range(split.before)}`, projects: [...new Set(split.before.map((item) => item.name))] },
        { label: `época ${range(split.after)}`, projects: [...new Set(split.after.map((item) => item.name))] }];
    }
  }
  const evidence: VerifiedEvidence[] = [...groups.map((group) => ({ url: group.page.url, title: group.page.title, quote: group.quote, supports: "mixed" as const })),
    ...checked.map(({ url, title, quote, supports }) => ({ url, title, quote, supports }))];
  if (proof) return { verdict: "mixed", evidence, groups: parts, rationale: proof };
  const reason = proposal.verdict !== "mixed" ? "" : groups.length < 2
    ? "Las citas no identifican a dos personas con proyectos de la ficha. "
    : "Falta una contradicción entre las personas (nombre completo, nacimiento o parentesco) citada en dos sitios. ";
  return { verdict: "unknown", evidence, groups: [], rationale: reason || "Las páginas disponibles no permiten distinguir a dos personas en esta ficha." };
}

/**
 * Alguna página liga el nombre con proyectos de los dos lados («Cheo Rodríguez … Guaco … Desorden
 * Público»): entonces es una carrera larga y no se parte, aunque las fechas digan otra cosa.
 */
function bridged(pages: readonly WebPage[], name: string, left: PersonProject[], right: PersonProject[]): PageLink | undefined {
  const termsOf = (side: PersonProject[]) => projectTerms([...new Set(side.map((item) => item.name))], side.flatMap((item) => item.album ? [item.album] : []));
  // Discogs no cuenta como puente: junta homónimos bajo un mismo artista. Tampoco una página que habla de
  // parentesco con ese apellido: «Antonio Casas, percusión… la cosa quedó en familia» es el padre en el disco del hijo.
  const forms = nameForms(name);
  const family = (page: WebPage) => {
    const text = plain(page.content);
    return forms.some((form) => {
      for (let at = text.indexOf(` ${form} `); at >= 0; at = text.indexOf(` ${form} `, at + form.length)) {
        const window = text.slice(Math.max(0, at - 300), at + form.length + 300);
        if (FAMILY.test(window) || /\ben familia\b/u.test(window)) return true;
      }
      return false;
    });
  };
  return findLinks(pages.filter((page) => !DISCOGS_PAGE.test(page.url) && !family(page)), forms, termsOf(left), termsOf(right))[0];
}

/**
 * Créditos que la fuente dio con el nombre de otra persona: otro apellido («José "Cheo" Navarro» en una ficha
 * de José «Cheo» Rodríguez) o el nombre de pila del dueño del disco («Rudy» en un disco de Rudy Márquez, en la
 * ficha de Rudy Pagliuca). Devuelve el nombre más frecuente y sus proyectos, y el resto de la ficha.
 */
export function foreignCredits(person: PersonContext): { name: string; foreign: PersonProject[]; own: PersonProject[] } | null {
  const ownerOf = new Map<string, string>();
  const resolve = (credited: string, project: PersonProject): string | null => {
    const tokens = nameTokens(credited);
    // «Hernán Gamboa Jr.» en la ficha de Hernán Gamboa: la fuente acreditó al hijo.
    if (tokens.length >= 2) return incompatibleNames(credited, person.name) || generation(credited) !== generation(person.name) ? credited : null;
    const owner = nameTokens(project.name);
    if (tokens.length === 1 && owner.length >= 2 && sameGiven(tokens[0]!, owner[0]!) && incompatibleNames(project.name, person.name)) {
      ownerOf.set(tokens[0]!, project.name);
      return project.name;
    }
    return null;
  };
  const foreignOf = (project: PersonProject): string | null => {
    const names = project.credited ?? [];
    const resolved = names.map((name) => resolve(name, project));
    return names.length && resolved.every((name) => name !== null) ? resolved[0]! : null;
  };
  const counts = new Map<string, number>();
  for (const project of person.projects) {
    const name = foreignOf(project);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const name = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  if (!name) return null;
  // El mismo nombre de pila suelto en otros discos («Rudy» en Los Dangers) va con el dueño que se resolvió.
  const bare = [...ownerOf.entries()].filter(([, owner]) => owner === name).map(([token]) => token);
  const isForeign = (project: PersonProject) => foreignOf(project) === name
    || (bare.length > 0 && (project.credited ?? []).length > 0 && (project.credited ?? []).every((credited) => bare.includes(nameTokens(credited).join(" "))));
  const foreign = person.projects.filter(isForeign);
  const own = person.projects.filter((project) => !isForeign(project) && project.name !== "Various Artists");
  return foreign.length && own.length ? { name, foreign, own } : null;
}

/**
 * La página de archivo del músico (Metal Archives), ya ligada a la ficha por nombre y banda en
 * personContext: su año de nacimiento y los proyectos de la ficha que nombra. Lo lee el código.
 */
export function archiveRecord(pages: readonly WebPage[], person: PersonContext): { url: string; birth: number | null; projects: string[] } | null {
  for (const page of pages) {
    if (!/metal-archives\.com\/artists\//u.test(page.url) || !person.sourceUrls.includes(page.url)) continue;
    const born = /Age:\s*\d+\s*\(born[^)]*?(\d{4})\)/u.exec(page.content)?.[1];
    const projects = [...new Set(person.projects.map((item) => item.name))].filter((name) => mentionsAny(page.content, [name]));
    return { url: page.url, birth: born ? Number(born) : null, projects };
  }
  return null;
}

function siteKey(rawUrl: string): string {
  const labels = new URL(rawUrl).hostname.replace(/^www\./u, "").split(".");
  const suffix = labels.slice(-2).join(".");
  return labels.length >= 3 && ["co.uk", "com.ve", "org.ve", "com.br"].includes(suffix)
    ? labels.slice(-3).join(".") : suffix;
}

export async function personContext(id: number): Promise<PersonContext> {
  const pool = getPool();
  const person = (await pool.query<{ name: string; birth_date: string | null; death_date: string | null }>(
    "SELECT name,birth_date::text,death_date::text FROM public.persons WHERE id=$1", [id])).rows[0];
  if (!person) throw new Error(`Persona ${id} no encontrada`);
  // Un renglón por disco (o membresía) con sus roles unidos: el modelo ve de quién es el disco y qué hizo la persona.
  const projects = await pool.query<PersonProject>(`
    WITH credits AS (
      SELECT ar.name, a.title AS album, a.release_year AS year, c.role, cl.raw_value#>>'{}' AS credited FROM public.album_credits c
        JOIN public.albums a ON a.id=c.album_id JOIN public.artists ar ON ar.id=a.artist_id
        LEFT JOIN ingest.claims cl ON cl.album_credit_id=c.id AND cl.field='credited_name' AND cl.status <> 'rejected' WHERE c.person_id=$1
      UNION ALL SELECT ar.name, a.title, a.release_year, c.role, cl.raw_value#>>'{}' FROM public.track_credits c
        JOIN public.tracks t ON t.id=c.track_id JOIN public.albums a ON a.id=t.album_id JOIN public.artists ar ON ar.id=a.artist_id
        LEFT JOIN ingest.claims cl ON cl.track_credit_id=c.id AND cl.field='credited_name' AND cl.status <> 'rejected' WHERE c.person_id=$1
      UNION ALL SELECT ar.name, NULL, m.from_year, 'integrante: ' || m.role, NULL FROM public.artist_members m JOIN public.artists ar ON ar.id=m.artist_id WHERE m.person_id=$1)
    SELECT name, album, year, string_agg(DISTINCT role, ', ') AS role,
           COALESCE(array_agg(DISTINCT credited) FILTER (WHERE credited IS NOT NULL), '{}') AS credited FROM credits
     GROUP BY name, album, year ORDER BY year NULLS LAST, name`, [id]);
  // Fuentes propias de la ficha y, después, las páginas guardadas de las bandas de las que es integrante
  // (una ficha separada a mano pierde el enlace a sus fuentes, pero la página de la banda la nombra).
  // Los volcados JSON de blogs (feeds, wp-json) van al final: son muchas entradas mezcladas en una página.
  const urls = await pool.query<{ url: string }>(`
    SELECT url FROM (
      SELECT DISTINCT ON (url) url, rank FROM (
        SELECT COALESCE(rp.canonical_url,rp.url) AS url, 0 AS rank FROM ingest.claims c JOIN ingest.raw_pages rp ON rp.id=c.raw_page_id
         WHERE c.person_id=$1 AND c.status <> 'rejected'
        UNION ALL
        SELECT rp.url, 1 FROM public.artist_members m JOIN public.artists ar ON ar.id=m.artist_id
          JOIN ingest.raw_pages rp ON rp.url ILIKE 'https://www.metal-archives.com/bands/' || replace(ar.name, ' ', '\\_') || '/%'
         WHERE m.person_id=$1
        UNION ALL
        SELECT COALESCE(rp.canonical_url,rp.url), CASE WHEN rp.url LIKE '%alt=json%' THEN 3 ELSE 2 END FROM public.artist_members m
          JOIN ingest.claims c ON c.artist_id=m.artist_id AND c.field='name' AND c.status <> 'rejected'
          JOIN ingest.raw_pages rp ON rp.id=c.raw_page_id
         WHERE m.person_id=$1) all_urls ORDER BY url, rank) ranked
    ORDER BY (url ~ '(alt=json|/wp-json/|/feeds/)'), rank, url LIMIT 12`, [id]);
  // La página del músico en Metal Archives va primero: dice nacimiento y bandas de esa persona y no de otra.
  const archive = metalArchivesArtistUrls(person.name, projects.rows.map((item) => item.name));
  return { id, name: person.name, birthDate: person.birth_date, deathDate: person.death_date,
    projects: projects.rows, sourceUrls: [...new Set([...archive, ...urls.rows.map((row) => row.url)])].slice(0, 12) };
}

/**
 * Selección opcional para herramientas que necesitan un resumen de 40 registros. La investigación del par
 * utiliza la trayectoria completa; esta función se conserva para consumidores de resúmenes. En una ficha
 * con 240 créditos (Hernán Gamboa) los del hijo, de 2007, no aparecían nunca. Van siempre las membresías y los
 * discos firmados con una forma rara del nombre («Hernán Gamboa Jr.», «Joseito Romero»), que es donde está la mezcla.
 */
export function pickProjects(rows: readonly PersonProject[], name: string, limit = 40): PersonProject[] {
  if (rows.length <= limit) return [...rows];
  const counts = new Map<string, number>();
  for (const row of rows) for (const form of new Set((row.credited ?? []).map((credited) => plain(credited).trim()))) counts.set(form, (counts.get(form) ?? 0) + 1);
  const own = plain(name).trim();
  const rare = (row: PersonProject) => (row.credited ?? []).some((credited) => {
    const form = plain(credited).trim();
    return form !== own && (counts.get(form) ?? 0) <= rows.length / 4;
  });
  const picked = new Set<PersonProject>();
  for (const row of rows) if (picked.size < limit / 4 && !row.album) picked.add(row);
  for (const row of rows) if (picked.size < limit / 2 && rare(row)) picked.add(row);
  const rest = rows.filter((row) => !picked.has(row));
  const room = limit - picked.size;
  // El resto, a intervalos regulares desde el primero hasta el último (los dos extremos entran).
  for (let index = 0; index < room; index += 1) picked.add(rest[Math.round(index * (rest.length - 1) / Math.max(1, room - 1))]!);
  return rows.filter((row) => picked.has(row));
}

async function pairForReview(reviewId: number): Promise<[PersonContext, PersonContext]> {
  const row = (await getPool().query<{ kind: string; status: string; person_a_id: string | null; person_b_id: string | null }>(
    "SELECT kind::text,status::text,person_a_id::text,person_b_id::text FROM ingest.review_queue WHERE id=$1", [reviewId])).rows[0];
  if (!row || !["open", "in_progress"].includes(row.status) || !["person_duplicate", "possible_duplicate", "person_match"].includes(row.kind)
    || !row.person_a_id || !row.person_b_id) throw new Error("La revisión no es un par abierto de personas");
  return Promise.all([personContext(Number(row.person_a_id)), personContext(Number(row.person_b_id))]);
}

/** Nombre para una frase exacta: «Abdenago "Neguito" Borjas» se busca como «Neguito Borjas». */
export function searchName(name: string): string {
  const nickname = name.match(/["“«]([^"”»]+)["”»]/u)?.[1]?.trim();
  const plain = name.replace(/["“”«»]/gu, "").replace(/\s+/gu, " ").trim();
  if (!nickname) return plain;
  const last = plain.split(" ").at(-1);
  return last && normalize(last) !== normalize(nickname) ? `${nickname} ${last}` : nickname;
}

/** El proyecto con más créditos de la ficha (no el más viejo: ese suele ser el crédito enganchado por error). */
function mainProject(person: PersonContext, except?: string): PersonProject | undefined {
  const counts = new Map<string, number>();
  for (const item of person.projects) if (item.name !== "Various Artists" && item.name !== except) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return person.projects.find((item) => item.name === best);
}

export function searchQueries(a: PersonContext, b: PersonContext): string[] {
  const queryFor = (person: PersonContext) => {
    const project = mainProject(person);
    if (!project) return [`"${searchName(person.name)}" Venezuela músico`];
    const base = `"${searchName(person.name)}" "${project.name.replace(/"/gu, "")}"`;
    const role = project.role.replace(/^integrante:\s*/u, "").split(/[|,&]/u)[0]?.trim() || "músico";
    // Primero la frase sola: con «Venezuela» al lado los buscadores tiraban el nombre del proyecto.
    return [base, `${base} ${role}${project.year ? ` ${Math.floor(project.year / 10) * 10}` : ""}`];
  };
  const shared = a.projects.map((item) => item.name).filter((name) => b.projects.some((item) => item.name === name));
  const sameName = normalize(a.name) === normalize(b.name);
  const firstA = mainProject(a)?.name;
  const firstB = mainProject(b, firstA)?.name;
  const nameA = searchName(a.name); const nameB = searchName(b.name);
  const nameQuery = !sameName
    ? [normalize(nameA) === normalize(nameB) ? `"${nameA}" "${firstA ?? "Venezuela"}" "${firstB ?? "música"}"`
      : `"${nameA}" "${nameB}" ${shared[0] ? `"${shared[0]}"` : "Venezuela música"}`]
    : firstA && firstB ? [`"${nameA}" "${firstA}" "${firstB}" Venezuela`] : [];
  const qa = queryFor(a); const qb = queryFor(b);
  // Con nombres distintos, cada nombre con el proyecto de la otra ficha: «Rafael Greco» «Patafunk» encuentra
  // lo que «Rafael Grego» no encuentra. Con el mismo nombre esa búsqueda sería la misma de cada lado.
  const cross = normalize(nameA) === normalize(nameB) ? [] : [firstB && `"${nameA}" "${firstB.replace(/"/gu, "")}"`, firstA && `"${nameB}" "${firstA.replace(/"/gu, "")}"`]
    .filter((query): query is string => Boolean(query));
  // Si un lado empieza 10 años o más después que el otro, la pregunta que decide es la edad: ¿era un
  // colegial? («mejor banda colegial "Niuno Niotro"»). Se busca la banda con colegio, liceo o edad.
  const start = (person: PersonContext) => Math.min(...activeYears(person), Infinity);
  const later = start(a) - start(b) >= 10 ? a : start(b) - start(a) >= 10 ? b : null;
  const laterProject = later ? mainProject(later)?.name : undefined;
  const age = laterProject ? [`"${laterProject.replace(/"/gu, "")}" colegio OR liceo OR edad`] : [];
  const extra = [a, b].flatMap((person) => [...new Set(person.projects.map((p) => p.name))]
    .filter((name) => name !== "Various Artists").slice(0, 3).map((name) => `"${searchName(person.name)}" "${name.replace(/"/gu, "")}"`));
  return [...new Set([...nameQuery, qa[0]!, qb[0]!, ...cross, ...age, qa[1]!, qb[1]!, ...extra])].slice(0, 10);
}

/** Sitios que sin sesión ni JavaScript no traen texto: ocupaban lugares de las 8 páginas (Facebook sí trae los posts públicos). */
const NO_TEXT_HOSTS = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|x\.com|twitter\.com|tiktok\.com|threads\.(net|com))$/u;

/** Las páginas de Discogs (cortas) van además de las 8 de la web. */
function addDiscogs(pages: WebPage[], discogs: DiscogsArtistPage[]): void {
  for (const { page } of discogs) if (!pages.some((old) => old.url === page.url)) pages.push(page);
}

/** Fuentes de una ficha (o de un lado de una ficha) y con qué juzgar si una página habla de ella. */
interface SourceSide { urls: string[]; name: string; projects: PersonProject[]; }

async function collectPages(broker: WebSearchBroker, sides: SourceSide[], queries: string[]): Promise<WebPage[]> {
  // Las fuentes propias son copias guardadas (raw_pages, Metal Archives): se leen todas y entran
  // primero las que nombran a la persona junto a uno de sus proyectos, hasta 2 por lado (3 en total si hay uno solo).
  const read = async (url: string) => { try { return await broker.page(url); } catch { return null; } };
  const perSide = sides.length === 1 ? 3 : 2;
  const sourceUrls: string[] = [];
  const chosen: WebPage[] = [];
  for (const side of sides) {
    let taken = 0;
    const terms = projectTerms([...new Set(side.projects.map((item) => item.name))], side.projects.flatMap((item) => item.album ? [item.album] : []));
    const own = (await Promise.all(side.urls.slice(0, 12).map(read))).filter((page): page is WebPage => page !== null);
    // Qué proyectos liga cada página con el nombre; se elige primero la que cubre más proyectos aún no cubiertos
    // (Rawayana y Wahala, no tres páginas de Rawayana).
    const forms = nameForms(side.name);
    const covers = new Map(own.map((page) => [page, new Set(terms.filter((term) => findLinks([page], forms, [term]).length))]));
    const covered = new Set<string>();
    const order: WebPage[] = [];
    while (order.length < own.length) {
      const best = own.filter((page) => !order.includes(page))
        .sort((x, y) => [...covers.get(y)!].filter((term) => !covered.has(term)).length - [...covers.get(x)!].filter((term) => !covered.has(term)).length
          || covers.get(y)!.size - covers.get(x)!.size)[0]!;
      order.push(best);
      for (const term of covers.get(best)!) covered.add(term);
    }
    for (const page of order) {
      if (taken >= perSide) break;
      if (!chosen.some((old) => old.url === page.url)) { chosen.push(page); taken += 1; }
    }
    sourceUrls.push(...side.urls);
  }
  const fetchBatch = async (urls: string[]) => Promise.all(urls.map(async (url) => {
    try { return await broker.page(url); } catch { return null; }
  }));
  const searches = await Promise.allSettled(queries.map((query) => broker.search(query)));
  const discovered: string[] = [];
  const byHost = new Map<string, number>();
  const resultGroups = searches.map((search) => search.status === "fulfilled" ? search.value : []);
  // Primero los resultados cuyo resumen trae un dato de vida (edad, colegio, nacimiento, muerte, parentesco)
  // junto al nombre o un proyecto de la ficha: son los que pueden decidir.
  // El dato tiene que estar a ±150 caracteres del proyecto (mejor) o del nombre.
  const projectLabels = sides.flatMap((side) => projectTerms([...new Set(side.projects.map((item) => item.name))], []));
  const nameLabels = sides.flatMap((side) => nameForms(side.name));
  const near = (text: string, labels: string[]) => labels.some((label) => {
    const at = text.indexOf(` ${label} `);
    return at >= 0 && LIFE_FACT.test(text.slice(Math.max(0, at - 150), at + label.length + 150));
  });
  const ranked = resultGroups.flat().map((hit) => {
    const text = plain(`${hit.title} ${hit.snippet}`);
    return { hit, score: near(text, projectLabels) ? 2 : near(text, nameLabels) ? 1 : 0 };
  }).filter((item) => item.score > 0).sort((x, y) => y.score - x.score);
  for (const { hit } of ranked) {
    let host: string;
    try { host = new URL(hit.url).hostname.replace(/^www\./u, ""); } catch { continue; }
    if (NO_TEXT_HOSTS.test(host) || sourceUrls.includes(hit.url) || discovered.includes(hit.url) || discovered.length >= 3) continue;
    discovered.push(hit.url);
    byHost.set(host, (byHost.get(host) ?? 0) + 1);
  }
  for (let rank = 0; rank < 12; rank += 1) {
    for (const hits of resultGroups) {
      const hit = hits[rank];
      if (!hit) continue;
      if (sourceUrls.includes(hit.url) || discovered.includes(hit.url)) continue;
      let host: string;
      try { host = new URL(hit.url).hostname.replace(/^www\./u, ""); } catch { continue; }
      if (NO_TEXT_HOSTS.test(host)) continue;
      if ((byHost.get(host) ?? 0) >= 2) continue;
      discovered.push(hit.url);
      byHost.set(host, (byHost.get(host) ?? 0) + 1);
    }
  }
  const pages = [...chosen];
  if (process.env["CRV_DEBUG_VERIFY"]) debugVerification("[páginas]", { queries, chosen: chosen.map((page) => page.url), discovered });
  const fetched = await fetchBatch(discovered.slice(0, 8));
  const snippetOf = new Map(resultGroups.flat().filter((hit) => hit.snippet).map((hit) => [hit.url, `${hit.title}. ${hit.snippet}`] as const));
  for (const page of fetched) {
    if (!page || pages.some((old) => old.url === page.url)) continue;
    // Sin JavaScript, SoundCloud o Facebook no traen el texto que el buscador sí vio («Migajas - Niuno Niotro
    // by Francisco Gonzalez»): ese resumen se suma a la página.
    const snippet = snippetOf.get(page.url);
    const extra = snippet && !plain(page.content).includes(plain(snippet).trim()) ? ` ${snippet}` : "";
    pages.push(extra ? { ...page, origin: "search_snippet" as const, content: `${page.content}${extra}`, contentHash: createHash("sha256").update(`${page.content}${extra}`).digest("hex") } : page);
    if (pages.length >= 8) break;
  }
  // Lo que el buscador citó de páginas que no se pueden leer (Spotify, Apple Music, Deezer sin JavaScript):
  // el resumen es texto de esa página («Patafunk feat. Soultwins, Rafael Greco»). Entran aparte, hasta 4, solo si
  // nombran a una de las personas junto a uno de sus proyectos.
  const snippets: WebPage[] = [];
  for (const hits of resultGroups) {
    for (const hit of hits) {
      if (snippets.length >= 4 || pages.some((old) => old.url === hit.url) || snippets.some((old) => old.url === hit.url) || !hit.snippet) continue;
      const content = `${hit.title}. ${hit.snippet}`;
      const page: WebPage = { url: hit.url, title: hit.title, content, origin: "search_snippet", contentHash: createHash("sha256").update(content).digest("hex"), fetchedAt: new Date().toISOString() };
      if (sides.some((side) => findLinks([page], nameForms(side.name), projectTerms([...new Set(side.projects.map((item) => item.name))],
        side.projects.flatMap((item) => item.album ? [item.album] : []))).length)) snippets.push(page);
    }
  }
  return [...pages.slice(0, 8), ...snippets];
}

async function timelineSignal(personId: number): Promise<{ split: EraSplit | null; life: string[] }> {
  const loaded = (await loadPersonTimelines(getPool(), [personId], { colleagues: false })).get(personId);
  if (!loaded) return { split: null, life: [] };
  const albums = [...loaded.albums];
  const onAlbum = new Map<number, Set<number>>();
  if (albums.length) {
    const { rows } = await getPool().query<{ album_id: string; person_id: string }>(`
      SELECT album_id::text,person_id::text FROM public.album_credits WHERE album_id = ANY($1::bigint[]) AND person_id IS NOT NULL
      UNION SELECT t.album_id::text,c.person_id::text FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id
       WHERE t.album_id = ANY($1::bigint[]) AND c.person_id IS NOT NULL`, [albums]);
    for (const row of rows) {
      const id = Number(row.album_id);
      const group = onAlbum.get(id) ?? new Set<number>();
      group.add(Number(row.person_id));
      onAlbum.set(id, group);
    }
  }
  const colleagues = (ids: number[]) => new Set(ids.flatMap((id) => [...(onAlbum.get(id) ?? [])]));
  return { split: eraSplit(loaded.timeline, colleagues), life: lifeIssues(loaded.timeline).map((issue) => issue.detail) };
}

const DOSSIER_RULES = "Cada ficha es una PERSONA del catálogo de música venezolana. En `credits`, `artist` es el artista o banda DUEÑO del disco, `album` el disco, `year` su año y `role` lo que hizo la persona en él. El artista NO es la persona: si una ficha solo tiene un crédito en un disco de Ilan Chester, esa ficha no es Ilan Chester, es alguien que participó en ese disco. Las formas distintas de un nombre suelen ser la misma persona: apodo o hipocorístico (Nené = Carlos, Rudy = Rodolfo, Fito = Rodolfo, Joseíto = José, Cheo = José, Neguito = Abdenago), nombre completo frente a nombre artístico, o una errata de una letra (Grego/Greco).";
const EVIDENCE_FORMAT = "Cita frases LITERALES copiadas exactas de la página (8 a 300 caracteres), con su índice. Cada evidence es {source: índice de página, quote: frase literal, supports: same|different|mixed, ficha: a|b|both, kind: identity|alias|birth|death|age|family|full_name|credit, year: año (kind birth o death: el que aparece en la cita; kind age: el año en que tenía esa edad), age: edad en ese año (solo kind age, tal como la dice la cita), fullName: nombre completo tal como aparece en la cita (solo kind full_name)}.";
const PAIR_INSTRUCTIONS = `Decide si dos fichas son la misma persona. ${DOSSIER_RULES} Usa SOLO las páginas numeradas.
- same: las páginas muestran que es UNA persona con esas formas de nombre (kind alias o identity) y la vinculan con proyectos de las DOS fichas (kind credit).
- different: SOLO con una contradicción documentada: (birth) un año de nacimiento incompatible con los créditos de la otra ficha; (death) un año de muerte anterior a créditos de la otra ficha; (age) una edad en un año dado («con 15 años», «banda colegial», «estudiantes de bachillerato») incompatible con créditos de la otra ficha; (family) una relación padre/hijo u otro parentesco entre dos personas con ese nombre; (full_name) nombres completos distintos documentados para cada ficha, que no sean apodo ni errata. Un rol, género, ciudad o década distintos NO prueban dos personas: un músico puede tocar salsa y rock, o ser músico e ingeniero. Cita además, para cada ficha, una frase que la ligue con uno de sus proyectos.
- mixed: solo si UNA de las fichas junta créditos de dos personas documentadas.
- unknown: si no hay pruebas de ese tipo. Abstenerse es correcto.
${EVIDENCE_FORMAT} No propongas mover créditos. Devuelve EXACTAMENTE JSON {verdict, rationale, evidence, uncertainties}.`;
const MIXED_INSTRUCTIONS = `Una ficha de persona puede estar mezclando a dos o más personas con el mismo nombre. ${DOSSIER_RULES} Usa SOLO las páginas numeradas.
Responde mixed SOLO si las páginas prueban personas distintas: nombres completos distintos (no apodo ni errata), un año de nacimiento incompatible con parte de los créditos, un parentesco (padre/hijo) entre dos personas con ese nombre, o —si timeline.split marca dos épocas sin artista común— páginas que muestran a la persona en cada época por separado. Una carrera larga, cambios de género o de rol NO prueban mezcla: muchos músicos tocan 50 años en estilos distintos. Si no hay esa prueba, responde unknown.
Si es mixed, llena groups: una entrada por persona con {label: quién es, projects: nombres EXACTOS de artistas de credits que le corresponden, source: índice de página, quote: frase literal que identifique a esa persona con uno de esos proyectos, fullName: su nombre completo si la cita lo trae, birthYear: año de nacimiento si la cita lo trae, deathYear: año de muerte si la página lo trae}. Cada grupo con su propia página y sin repetir proyectos.
${EVIDENCE_FORMAT} No propongas mover créditos. Devuelve EXACTAMENTE JSON {verdict, rationale, evidence, groups, uncertainties}.`;

/**
 * Una llamada a DeepSeek flash. Si la respuesta no se puede leer (JSON roto, una comilla sin escapar), se
 * pide una vez más con la marca `retry`; si vuelve a fallar, la propuesta es «unknown», no un error.
 */
async function ask(gateway: DeepSeekGateway, schemaVersion: string, instructions: string, input: Record<string, unknown>): Promise<{ proposal: WebVerdict; runId: number | null }> {
  for (const retry of [0, 1]) {
    try {
      const result = await gateway.propose({ taskKind: "hard_entity_resolution", modelClass: "fast", schemaVersion,
        responseSchema: webVerdictSchema, instructions, input: retry ? { ...input, retry } : input });
      return { proposal: result.proposal, runId: result.runId ?? null };
    } catch (error) {
      if (!(error instanceof DeepSeekValidationError)) throw error;
    }
  }
  return { proposal: { verdict: "unknown", rationale: "La respuesta de DeepSeek no se pudo leer dos veces.", evidence: [], uncertainties: [] }, runId: null };
}

/** Expediente para el modelo: ficha y créditos sin ids ni URL internas. */
function dossierPerson(person: PersonContext) {
  return { name: person.name, birthDate: person.birthDate, deathDate: person.deathDate,
    credits: person.projects.map((item) => ({ artist: item.name, album: item.album ?? null, year: item.year, role: item.role })) };
}

/** Años en que la ficha figura activa: sin composiciones (una canción vieja se graba tarde) ni recopilatorios. */
function activeYears(person: PersonContext): number[] {
  return person.projects.filter((item) => item.year !== null && item.name !== "Various Artists" && performed(item.role))
    .map((item) => item.year!);
}

function pagesForModel(pages: WebPage[]) {
  return pages.map((page, index) => ({ index, url: page.url, title: page.title, text: page.content.slice(0, 10000) }));
}

/** Extrae un tramo literal, conservando grafía y signos de la página. */
function comparisonCitation(page: WebPage, name: string, project?: string): ComparisonCitation {
  const text = page.content;
  const positions: number[] = []; let folded = "";
  for (let index = 0; index < text.length; index++) {
    const chars = text[index]!.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
    for (const char of chars) {
      const normalized = /[\p{L}\p{N}]/u.test(char) ? char : " ";
      if (normalized === " " && folded.endsWith(" ")) continue;
      folded += normalized; positions.push(index);
    }
  }
  const target = plain(name).trim();
  let at = folded.indexOf(target);
  if (project) {
    for (let candidate = at; candidate >= 0; candidate = folded.indexOf(target, candidate + target.length)) {
      const nearby = folded.slice(Math.max(0, candidate - 250), candidate + target.length + 400);
      if (mentionsAny(nearby, [project]) || mentionsAny(page.title, [project])) { at = candidate; break; }
    }
  }
  const start = at >= 0 ? positions[at] ?? 0 : 0;
  return { url: page.url, title: page.title, quote: text.slice(start, start + 650).trim(), origin: page.origin ?? "page" };
}

/** Las pruebas de cada lado se contrastan antes de evaluar la conexión del par. */
export function buildPersonComparison(a: PersonContext, b: PersonContext, pages: WebPage[],
  validated: { verdict: WebVerdict["verdict"]; evidence: VerifiedEvidence[]; rationale: string }, facts: [PersonFacts, PersonFacts]): PersonComparison {
  const report = compareCatalog(facts[0], facts[1]);
  report.conclusion = validated.verdict;
  report.rationale = validated.rationale;
  const evaluate = (person: PersonContext, base: ComparedPerson): ComparedPerson => {
    const projects = person.projects.map((project) => {
      const forms = nameForms(person.name);
      const linked = findLinks(pages, forms, projectTerms([project.name], project.album ? [project.album] : []));
      const relevant = [...new Map(pages.filter((page) => linked.some((link) => link.url === page.url)).map((page) => [page.url, page])).values()]
        .sort((x, y) => Number(person.sourceUrls.includes(y.url)) - Number(person.sourceUrls.includes(x.url)));
      const evidence = relevant.map((page) => comparisonCitation(page, person.name, project.album ?? project.name));
      const text = evidence.map((cite) => plain(`${cite.title} ${cite.quote}`)).join(" ");
      const albumChecked = Boolean(project.album && mentionsAny(text, [project.album]));
      const specific = !project.album || albumChecked;
      const roleWords = plain(project.role).trim().replace(/^integrante /u, "").split(" ").filter((word) => word.length > 2);
      const roleTerms: Record<string, string[]> = { bass: ["bass", "bajo", "bajista"], bajo: ["bass", "bajo", "bajista"],
        guitar: ["guitar", "guitarra", "guitarrista"], guitarra: ["guitar", "guitarra", "guitarrista"], vocals: ["vocals", "voz", "vocalista"], drums: ["drums", "bateria", "baterista"] };
      const checks = { project: evidence.length > 0,
        album: albumChecked,
        year: specific && project.year !== null && text.includes(` ${project.year} `),
        role: specific && roleWords.some((word) => (roleTerms[word] ?? [word]).some((term) => text.includes(` ${term} `))) };
      const coverage = checks.project ? (project.album
        ? 0.3 + (checks.album ? 0.3 : 0) + (checks.year ? 0.2 : 0) + (checks.role ? 0.2 : 0)
        : 0.5 + (checks.year ? 0.25 : 0) + (checks.role ? 0.25 : 0)) : 0;
      const strength = evidence.some((cite) => cite.origin === "page") ? 1 : evidence.length ? 0.25 : 0;
      return { name: project.name, album: project.album ?? null, year: project.year, role: project.role, evidence, checks, coverage: coverage * strength };
    });
    const evidence = [...new Map(projects.flatMap((project) => project.evidence).map((cite) => [`${cite.url}:${cite.quote}`, cite])).values()];
    return { ...base, projects, evidence,
      chronology: { birthYear: person.birthDate ? Number(person.birthDate.slice(0, 4)) : archiveRecord(pages, person)?.birth ?? null,
        activeYears: [...new Set(activeYears(person))].sort((x,y)=>x-y),
        aliveOnlyYears: [...new Set(person.projects.filter((p) => p.year !== null && aliveOnly(p.role)).map((p) => p.year!))].sort((x,y)=>x-y) },
      missing: [...base.missing, ...projects.filter((project) => (project.coverage ?? 0) < 1)
        .map((project) => `Respaldo incompleto: ${project.name}${project.album ? ` · ${project.album}` : ""}`)] };
  };
  report.a = evaluate(a, report.a); report.b = evaluate(b, report.b);
  // Proyectos exclusivos de ambos lados, o alias explícito documentado, conectan las trayectorias.
  const uniqueA = a.projects.map((p) => p.name).filter((name) => !b.projects.some((p) => p.name === name));
  const uniqueB = b.projects.map((p) => p.name).filter((name) => !a.projects.some((p) => p.name === name));
  const direct = uniqueA.length && uniqueB.length ? findLinks(pages.filter((p) => !DISCOGS_PAGE.test(p.url)),
    [...new Set([...nameForms(a.name), ...nameForms(b.name)])], projectTerms(uniqueA, []), projectTerms(uniqueB, [])) : [];
  const aliases = validated.evidence.filter((cite) => aliasBridge(cite.quote, [a.name, b.name]));
  const cross = normalize(a.name) !== normalize(b.name) ? [...findLinks(pages, nameForms(a.name), projectTerms(uniqueB, [])),
    ...findLinks(pages, nameForms(b.name), projectTerms(uniqueA, []))] : [];
  const urls = new Set([...direct, ...cross, ...aliases].map((item) => item.url));
  report.bridge = validated.verdict === "same" ? pages.filter((page) => urls.has(page.url)).map((page) => comparisonCitation(page, a.name)) : [];
  const coverage = (person: ComparedPerson) => person.projects.length ? person.projects.reduce((sum, p) => sum + (p.coverage ?? 0), 0) / person.projects.length : 0;
  const bridgeStrength = report.bridge.some((cite) => cite.origin === "page") ? 1 : report.bridge.length ? 0.25 : 0;
  const uniqueTexts = new Map([...report.a.evidence, ...report.b.evidence].filter((cite) => cite.origin === "page").map((cite) => [normalize(cite.quote), cite]));
  const sites = new Set([...uniqueTexts.values()].map((cite) => siteKey(cite.url)));
  report.documentary = { a: Math.round(20 * coverage(report.a) * 10) / 10,
    b: Math.round(20 * coverage(report.b) * 10) / 10,
    bridge: Math.round(20 * bridgeStrength * (sites.size >= 2 ? 1 : 0.5) * 10) / 10 };
  report.contradictions = validated.verdict === "different" || validated.verdict === "mixed" || validated.rationale.startsWith("Hay pruebas en los dos sentidos")
    ? [validated.rationale] : [];
  report.catalogSignature = catalogSignature(facts[0], facts[1]);
  return report;
}

export function pairPolicyContext(a: PersonContext, b: PersonContext, pages: WebPage[], eraConflict: string | null = null): SamePolicyContext {
  const sharedProjects = a.projects.map((item) => item.name).filter((name) => name !== "Various Artists" && b.projects.some((item) => item.name === name));
  return { names: [a.name, b.name], sharedProjects, eraConflict,
    projectsA: a.projects.map((item) => item.name), projectsB: b.projects.map((item) => item.name), yearsA: activeYears(a), yearsB: activeYears(b),
    aliveYearsA: a.projects.filter((item) => item.year !== null && aliveOnly(item.role)).map((item) => item.year!),
    aliveYearsB: b.projects.filter((item) => item.year !== null && aliveOnly(item.role)).map((item) => item.year!),
    albumsA: a.projects.flatMap((item) => item.album ? [item.album] : []), albumsB: b.projects.flatMap((item) => item.album ? [item.album] : []),
    birthA: a.birthDate ? Number(a.birthDate.slice(0, 4)) : archiveRecord(pages, a)?.birth ?? null,
    birthB: b.birthDate ? Number(b.birthDate.slice(0, 4)) : archiveRecord(pages, b)?.birth ?? null };

}

export async function investigatePersonContexts(a: PersonContext, b: PersonContext, broker = new WebSearchBroker(), gateway: DeepSeekGateway = createDeepSeekGateway(),
  options: { eraConflict?: string | null } = {}) {
  const [pages, ...discogs] = await Promise.all([
    collectPages(broker, [a, b].map((side) => ({ urls: side.sourceUrls, name: side.name, projects: side.projects })), searchQueries(a, b)),
    discogsPages(nameForms(a.name), a.projects), discogsPages(nameForms(b.name), b.projects)]);
  addDiscogs(pages, discogs.flat());
  const dossierHash = createHash("sha256").update(JSON.stringify({ rules: VERIFICATION_RULES_VERSION, a, b, sources: pages.map((page) => [page.url, page.contentHash]) })).digest("hex");
  let proposal: WebVerdict = { verdict: "unknown", rationale: "No hay páginas verificables suficientes.", evidence: [], uncertainties: [] };
  let aiRunId: number | null = null;
  if (pages.length) {
    const result = await ask(gateway, "person-web-verification.v3", PAIR_INSTRUCTIONS,
      { a: dossierPerson(a), b: dossierPerson(b), pages: pagesForModel(pages) });
    proposal = result.proposal;
    aiRunId = result.runId ?? null;
  }
  const eraConflict = options.eraConflict !== undefined ? options.eraConflict
    : a.id > 0 && b.id > 0 ? await eraConflictBetween(getPool(), a.id, b.id) : null;
  const context = pairPolicyContext(a, b, pages, eraConflict);
  // En un par, «mixta» con dos personas citadas se juzga con la regla de «distintas» (validateWebVerdict).
  const validated = validateWebVerdict(proposal, pages, context);
  return { dossierHash, validated, pages, aiRunId };
}

/** Búsquedas para una ficha sospechosa: el nombre con proyectos de sus distintas épocas. */
export function mixedSearchQueries(person: PersonContext): string[] {
  const name = searchName(person.name);
  const artists = [...new Map(person.projects.filter((item) => item.name !== "Various Artists")
    .map((item) => [item.name, item] as const)).values()];
  const picks = artists.length <= 4 ? artists
    : [artists[0]!, artists[Math.floor(artists.length / 3)]!, artists[Math.floor((2 * artists.length) / 3)]!, artists.at(-1)!];
  return [...new Set([`"${name}" músico venezolano biografía`, ...picks.map((item) => `"${name}" "${item.name.replace(/"/gu, "")}"`)])].slice(0, 5);
}

/** Investiga una ficha armada; la usan el botón de Curaduría y la prueba de control. */
export async function investigateMixedContext(person: PersonContext, broker = new WebSearchBroker(), gateway: DeepSeekGateway = createDeepSeekGateway()) {
  const signal = person.id > 0 ? await timelineSignal(person.id) : { split: null, life: [] };
  // En fichas reales el hueco lo confirma la regla de épocas (que mira también colegas); en las armadas, los proyectos.
  const projectSplit = projectEraSplit(person);
  const eraSplit = person.id > 0 ? Boolean(signal.split) : Boolean(projectSplit);
  const [pages, discogs] = await Promise.all([
    collectPages(broker, [{ urls: person.sourceUrls, name: person.name, projects: person.projects }], mixedSearchQueries(person)),
    discogsPages(nameForms(person.name), person.projects)]);
  addDiscogs(pages, discogs);
  const dossierHash = createHash("sha256").update(JSON.stringify({ rules: VERIFICATION_RULES_VERSION, person, signal, sources: pages.map((page) => [page.url, page.contentHash]) })).digest("hex");
  let validated: ReturnType<typeof validateMixedGroups> = { verdict: "unknown", rationale: "No hay páginas verificables suficientes.", evidence: [], groups: [] };
  let aiRunId: number | null = null;
  if (pages.length) {
    const result = await ask(gateway, "person-web-mixed.v2", MIXED_INSTRUCTIONS, { person: dossierPerson(person),
        timeline: { lifeIssues: signal.life, split: eraSplit && projectSplit ? { gap: projectSplit.gap,
          before: [...new Set(projectSplit.before.map((item) => item.name))], after: [...new Set(projectSplit.after.map((item) => item.name))] } : null },
        pages: pagesForModel(pages) });
    aiRunId = result.runId ?? null;
    validated = validateMixedGroups(result.proposal, pages, person, { eraSplit });
  }
  // Con fecha de nacimiento y créditos de antes de los 12 años (la «vida imposible» de Curaduría), los
  // créditos imposibles y el resto se investigan como un par, igual que las épocas.
  // Si la página de archivo del músico trae el nacimiento, ella dice qué bandas son de esa persona:
  // lo demás no se parte por la línea de la fecha (el violinista de 1997–2009 no queda cortado en 2001).
  const archive = archiveRecord(pages, person);
  const birth = person.birthDate ? Number(person.birthDate.slice(0, 4)) : archive?.birth ?? null;
  const owned = archive?.birth === birth && archive.projects.length ? new Set(archive.projects) : null;
  const dated = person.projects.filter((item) => item.year !== null && item.name !== "Various Artists" && performed(item.role));
  // Lo mismo después de morir, solo con créditos de vida (mezcla, producción…): James Brown murió en 2006 y mezcló un disco de 2010.
  const death = person.deathDate ? Number(person.deathDate.slice(0, 4)) : null;
  for (const limit of [birth ? { kind: "birth" as const, year: birth } : null, death ? { kind: "death" as const, year: death } : null]) {
    if (!limit || validated.verdict === "mixed") continue;
    const outside = (year: number) => limit.kind === "birth" ? year < limit.year + MIN_ACTIVE_AGE : year > limit.year + 1;
    const impossible = dated.filter((item) => outside(item.year!) && (limit.kind === "birth" ? !owned?.has(item.name) : aliveOnly(item.role)));
    // El otro lado: lo de artistas sin créditos imposibles, con año posible o sin año (una membresía de
    // Metal Archives sin fecha suele ser justo de quien trae la fecha de nacimiento).
    const early = new Set(impossible.map((item) => item.name));
    const possible = limit.kind === "birth" && owned ? person.projects.filter((item) => owned.has(item.name))
      : person.projects.filter((item) => item.name !== "Various Artists" && !early.has(item.name) && (item.year === null || !outside(item.year)));
    if (!impossible.length || !possible.length) continue;
    const asPerson = (side: PersonProject[], id: number, own: boolean): PersonContext => ({ id, name: person.name,
      birthDate: own && limit.kind === "birth" ? person.birthDate ?? `${limit.year}-01-01` : null,
      deathDate: own && limit.kind === "death" ? person.deathDate : null, projects: side, sourceUrls: person.sourceUrls });
    const edge = limit.kind === "birth" ? Math.min(...impossible.map((item) => item.year!)) : Math.max(...impossible.map((item) => item.year!));
    const pair = await investigatePersonContexts(asPerson(impossible, -1, false), asPerson(possible, -2, true), broker, gateway,
      { eraConflict: `${limit.kind === "birth" ? "nació" : "murió"} en ${limit.year} según la ficha y tiene créditos de ${edge}` });
    const bridge = bridged([...pages, ...pair.pages], person.name, impossible, possible);
    if (process.env["CRV_DEBUG_VERIFY"]) debugVerification("[vida]", { limit, impossible: impossible.map((i) => i.name), possible: possible.map((i) => i.name), verdict: pair.validated.verdict, why: pair.validated.rationale.slice(0, 300), bridge });
    if (pair.validated.verdict === "different" && !bridge) {
      validated = { verdict: "mixed", evidence: pair.validated.evidence, rationale: pair.validated.rationale,
        groups: [{ label: limit.kind === "birth" ? `créditos de antes de ${limit.year + MIN_ACTIVE_AGE}` : `créditos de después de ${limit.year + 3}`,
          projects: [...new Set(impossible.map((item) => item.name))] },
        { label: `${limit.kind === "birth" ? "nacido" : "muerto"} en ${limit.year}`, projects: [...new Set(possible.map((item) => item.name))] }] };
      pages.push(...pair.pages.filter((page) => !pages.some((old) => old.url === page.url)));
    } else if (pair.validated.verdict === "different" && bridge) {
      validated = { ...validated, rationale: `${validated.rationale} Una página une los dos lados («${bridge.snippet}», ${bridge.url}): no se parte.` };
    }
  }
  // Parte de los créditos se acreditó con otro nombre: esa parte se investiga como la persona de ese nombre.
  const credited = validated.verdict === "mixed" ? null : foreignCredits(person);
  if (credited) {
    const side = (projects: PersonProject[], id: number, name: string): PersonContext => ({ id, name, birthDate: null, deathDate: null, projects, sourceUrls: person.sourceUrls });
    const pair = await investigatePersonContexts(side(credited.foreign, -1, credited.name), side(credited.own, -2, person.name), broker, gateway, { eraConflict: null });
    // Un artista con discos de los dos lados (los dos Cheo tocaron con Alberto Naranjo) no sirve de puente.
    const ownArtists = new Set(credited.own.map((item) => item.name));
    const bridge = bridged([...pages, ...pair.pages], person.name, credited.foreign.filter((item) => !ownArtists.has(item.name)),
      credited.own.filter((item) => !credited.foreign.some((other) => other.name === item.name)));
    if (process.env["CRV_DEBUG_VERIFY"]) debugVerification("[acreditado]", { name: credited.name, foreign: credited.foreign.map((i) => i.name), verdict: pair.validated.verdict, why: pair.validated.rationale.slice(0, 300), bridge });
    if (pair.validated.verdict === "different" && !bridge) {
      validated = { verdict: "mixed", evidence: pair.validated.evidence, rationale: pair.validated.rationale,
        groups: [{ label: `acreditado como ${credited.name}`, projects: [...new Set(credited.foreign.map((item) => item.name))] },
          { label: person.name, projects: [...new Set(credited.own.map((item) => item.name))] }] };
      pages.push(...pair.pages.filter((page) => !pages.some((old) => old.url === page.url)));
    }
  }
  // Con dos épocas sin artista común, cada época se investiga como una ficha y se juzga como un par:
  // la regla de «distintas» (la web confirma a cada una y hay contradicción) es la más probada.
  if (validated.verdict !== "mixed" && eraSplit && projectSplit) {
    const range = (side: PersonProject[]) => `${Math.min(...side.map((item) => item.year!))}–${Math.max(...side.map((item) => item.year!))}`;
    const asPerson = (side: PersonProject[], id: number): PersonContext => ({ id, name: person.name, birthDate: null, deathDate: null,
      projects: side, sourceUrls: person.sourceUrls });
    const conflict = `épocas separadas por ${projectSplit.gap} años (${range(projectSplit.before)} / ${range(projectSplit.after)}) sin artista común`;
    const pair = await investigatePersonContexts(asPerson(projectSplit.before, -1), asPerson(projectSplit.after, -2), broker, gateway, { eraConflict: conflict });
    const bridge = bridged([...pages, ...pair.pages], person.name, projectSplit.before, projectSplit.after);
    if (pair.validated.verdict === "different" && !bridge) {
      validated = { verdict: "mixed", evidence: pair.validated.evidence, rationale: pair.validated.rationale,
        groups: [{ label: `época ${range(projectSplit.before)}`, projects: [...new Set(projectSplit.before.map((item) => item.name))] },
          { label: `época ${range(projectSplit.after)}`, projects: [...new Set(projectSplit.after.map((item) => item.name))] }] };
      pages.push(...pair.pages.filter((page) => !pages.some((old) => old.url === page.url)));
    } else if (pair.validated.verdict === "different" && bridge) {
      validated = { ...validated, rationale: `${validated.rationale} Una página une los dos lados («${bridge.snippet}», ${bridge.url}): no se parte.` };
    }
  }
  // Discogs acredita los discos de la ficha a dos artistas distintos (James Brown cantante / James Brown
  // ingeniero): cada uno se investiga como una ficha y se juzga como un par, igual que las épocas.
  const byArtist = discogs.filter((item) => item.projects.length);
  if (validated.verdict !== "mixed" && byArtist.length >= 2) {
    const [left, right] = byArtist as [DiscogsArtistPage, DiscogsArtistPage];
    const leftSide = person.projects.filter((item) => left.projects.includes(item.name) && !right.projects.includes(item.name));
    const rightSide = person.projects.filter((item) => right.projects.includes(item.name) && !left.projects.includes(item.name));
    if (leftSide.length && rightSide.length) {
      const asPerson = (side: PersonProject[], id: number): PersonContext => ({ id, name: person.name, birthDate: null, deathDate: null,
        projects: side, sourceUrls: person.sourceUrls });
      const pair = await investigatePersonContexts(asPerson(leftSide, -1), asPerson(rightSide, -2), broker, gateway, { eraConflict: null });
      const bridge = bridged([...pages, ...pair.pages], person.name, leftSide, rightSide);
      if (pair.validated.verdict === "different" && !bridge) {
        validated = { verdict: "mixed", evidence: pair.validated.evidence, rationale: pair.validated.rationale,
          groups: [left, right].map(({ page, projects }) => ({ label: page.title.replace(/ \| Discogs$/u, ""), projects })) };
        pages.push(...pair.pages.filter((page) => !pages.some((old) => old.url === page.url)));
      }
    }
  }
  if (validated.groups.length) {
    validated = { ...validated, rationale: `${validated.rationale} Reparto propuesto: ${validated.groups.map((group) => `${group.label}: ${group.projects.join(", ")}`).join(" · ")}.` };
  }
  return { dossierHash, validated, pages, aiRunId };
}

export async function investigateKnownPersonPair(aId: number, bId: number, broker = new WebSearchBroker(), gateway: DeepSeekGateway = createDeepSeekGateway()) {
  const [a, b, allFacts] = await Promise.all([personContext(aId), personContext(bId), loadPersonFacts(getPool())]);
  const result = await investigatePersonContexts(a, b, broker, gateway);
  const facts = new Map(allFacts.map((person) => [person.id, person]));
  const comparison = buildPersonComparison(a, b, result.pages, result.validated, [facts.get(aId)!, facts.get(bId)!]);
  return { ...result, comparison };
}

export async function investigatePersonReview(reviewId: number, broker = new WebSearchBroker(), gateway: DeepSeekGateway = createDeepSeekGateway()): Promise<VerificationView> {
  const [a, b] = await pairForReview(reviewId);
  const { dossierHash, validated, pages, aiRunId, comparison } = await investigateKnownPersonPair(a.id, b.id, broker, gateway);
  const current = (await getPool().query<{ id: string; dossier_hash: string }>(
    "SELECT id::text,dossier_hash FROM ingest.person_web_verifications WHERE review_id=$1 AND status='proposed'", [reviewId])).rows[0];
  if (current?.dossier_hash === dossierHash) return (await getPersonVerification(reviewId))!;
  const sources = pages.map((page) => ({ url: page.url, title: page.title, contentHash: page.contentHash }));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE ingest.person_web_verifications SET status='superseded' WHERE review_id=$1 AND status='proposed'", [reviewId]);
    await client.query(`INSERT INTO ingest.person_web_verifications(review_id,dossier_hash,status,verdict,rationale,evidence,sources,ai_run_id,comparison)
      VALUES($1,$2,'proposed',$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb)`,
    [reviewId, dossierHash, validated.verdict, validated.rationale, JSON.stringify(validated.evidence), JSON.stringify(sources), aiRunId, JSON.stringify(comparison)]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  return (await getPersonVerification(reviewId))!;
}

export async function getPersonVerification(reviewId: number): Promise<VerificationView | null> {
  return readVerification("review_id", reviewId);
}

export async function getMixedPersonVerification(personId: number): Promise<VerificationView | null> {
  return readVerification("person_id", personId);
}

async function readVerification(column: "review_id" | "person_id", id: number): Promise<VerificationView | null> {
  const row = (await getPool().query<{ id: string; review_id: string | null; person_id: string | null; dossier_hash: string; status: string; verdict: WebVerdict["verdict"]; rationale: string;
    comparison: PersonComparison | null; evidence: VerifiedEvidence[]; sources: VerificationView["sources"]; created_at: string; reviewed_by: string | null; review_note: string | null }>(`
    SELECT id::text,review_id::text,person_id::text,dossier_hash,status,verdict,rationale,evidence,sources,comparison,created_at::text,reviewed_by,review_note
    FROM ingest.person_web_verifications WHERE ${column}=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [id])).rows[0];
  let comparison = row?.comparison ?? null;
  if (comparison) {
    const facts = new Map((await loadPersonFacts(getPool())).map((person) => [person.id, person]));
    const a = facts.get(comparison.a.id); const b = facts.get(comparison.b.id);
    if (a && b) comparison = compareCatalog(a, b, comparison);
  }
  return row ? { id: Number(row.id), reviewId: row.review_id === null ? null : Number(row.review_id), personId: row.person_id === null ? null : Number(row.person_id), dossierHash: row.dossier_hash, status: row.status,
    comparison, verdict: row.verdict, rationale: row.rationale, evidence: row.evidence, sources: row.sources, createdAt: row.created_at,
    reviewedBy: row.reviewed_by, reviewNote: row.review_note } : null;
}

export async function investigateMixedPerson(personId: number, broker = new WebSearchBroker(), gateway: DeepSeekGateway = createDeepSeekGateway()): Promise<VerificationView> {
  // Lo pide una persona desde Curaduría: se investiga aunque las reglas de épocas no vean nada
  // (José Romero 486 juntaba a Romero Bello y a Joseíto sin un hueco de 20 años).
  const person = await personContext(personId);
  const { dossierHash, validated, pages, aiRunId } = await investigateMixedContext(person, broker, gateway);
  const current = (await getPool().query<{ dossier_hash: string }>(
    "SELECT dossier_hash FROM ingest.person_web_verifications WHERE person_id=$1 AND status='proposed'", [personId])).rows[0];
  if (current?.dossier_hash === dossierHash) return (await getMixedPersonVerification(personId))!;
  const sources = pages.map((page) => ({ url: page.url, title: page.title, contentHash: page.contentHash }));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE ingest.person_web_verifications SET status='superseded' WHERE person_id=$1 AND status='proposed'", [personId]);
    await client.query(`INSERT INTO ingest.person_web_verifications(person_id,dossier_hash,status,verdict,rationale,evidence,sources,ai_run_id)
      VALUES($1,$2,'proposed',$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [personId, dossierHash, validated.verdict, validated.rationale, JSON.stringify(validated.evidence), JSON.stringify(sources), aiRunId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  return (await getMixedPersonVerification(personId))!;
}

export async function reviewMixedPersonVerification(personId: number, operator: string, note: string): Promise<VerificationView> {
  const updated = await getPool().query(`UPDATE ingest.person_web_verifications SET status='reviewed',reviewed_by=$2,review_note=$3,reviewed_at=now()
    WHERE person_id=$1 AND status='proposed' RETURNING id`, [personId, operator, note]);
  if (!updated.rowCount) throw new Error("No hay propuesta pendiente");
  return (await getMixedPersonVerification(personId))!;
}

export async function reviewPersonVerification(reviewId: number, operator: string, note: string): Promise<VerificationView> {
  const updated = await getPool().query(`UPDATE ingest.person_web_verifications SET status='reviewed',reviewed_by=$2,review_note=$3,reviewed_at=now()
    WHERE review_id=$1 AND status='proposed' RETURNING id`, [reviewId, operator, note]);
  if (!updated.rowCount) throw new Error("No hay propuesta pendiente");
  return (await getPersonVerification(reviewId))!;
}
