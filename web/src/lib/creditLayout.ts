// Estructura pública de los créditos del disco (plan v2 del primo, etapa 4, puntos 11 y 12).
//
//  * Con créditos del canal, la columna «Producción» desaparece: sus datos
//    atomizados repetían las líneas del canal. En su lugar van esas líneas,
//    bajo «Otros Créditos». Las que repiten «Composición», «Arte» o los músicos
//    no se duplican; lo atomizado que el canal no nombra se queda como línea.
//  * Sin canal, «Producción» se presenta con el mismo formato de línea,
//    agrupando los roles de cada persona: «Recorded & Mixed by Boris Milan».
//  * Músicos: «Lead Vocals» primero; luego el bloque más grande (D1).
//
// Solo decide qué se muestra y dónde: no toca claims ni créditos.
import { roleTitle } from "./labels";
import type { Credit, CreditStatement, ScopedCredit } from "./types";

export const PRODUCTION_TYPES = ["producer", "recording", "mixing", "mastering"] as const;
export const COMPOSITION_TYPES = ["writer", "composer"] as const;
export const ART_TYPES = ["artwork", "photography"] as const;
export const MUSICIAN_TYPES = ["musician", "guest"] as const;

type CreditsByType = Readonly<Record<string, Credit[] | undefined>>;
type ScopedByType = Readonly<Record<string, ScopedCredit[] | undefined>>;

export interface CreditTarget { key: string; to: string; name: string; deceased: boolean }

export function creditTarget(credit: Credit): CreditTarget | null {
  if (credit.personId !== null) return { key: `p${credit.personId}`, to: `/personas/${credit.personId}`, name: credit.personDisplayName ?? credit.personName ?? "", deceased: credit.personIsDeceased ?? false };
  if (credit.artistId !== null) return { key: `a${credit.artistId}`, to: `/artistas/${credit.artistId}`, name: credit.artistName ?? "", deceased: false };
  if (credit.organizationId !== null) return { key: `o${credit.organizationId}`, to: `/organizaciones/${credit.organizationId}`, name: credit.organizationName ?? "", deceased: false };
  return null;
}

export function trackScope(tracks: ScopedCredit["tracks"]): string {
  const multiDisc = tracks.some((track) => track.discNumber > 1);
  const list = tracks.map((track) => (multiDisc ? `${track.discNumber}.${track.trackNumber}` : String(track.trackNumber)));
  return `${list.length === 1 ? "pista" : "pistas"} ${list.join(", ")}`;
}

// ── Músicos (punto 11, D1) ─────────────────────────────────────────────────
const LEAD_VOCALS = /\blead\s+vocals?\b|^vocals?\b|\bvoz\s+principal\b|^voz\b|^voces\b|\bvocalista\b|\bcantante\b/iu;
const INSTRUMENT_RANK: ReadonlyArray<RegExp> = [
  /\bvocals?\b|\bvoz\b|\bvoces\b/iu,
  /\bguitars?\b|\bguitarras?\b/iu,
  /\bbass\b|\bbajo\b/iu,
  /\bdrums?\b|\bbater[ií]a\b/iu,
];

export function isLeadVocals(role: string): boolean {
  return LEAD_VOCALS.test(role.trim());
}

function instrumentRank(role: string): number {
  const index = INSTRUMENT_RANK.findIndex((pattern) => pattern.test(role));
  return index === -1 ? INSTRUMENT_RANK.length : index;
}

const visualLength = (name: string) => Array.from(name.trim()).length;

/**
 * «Lead Vocals» (también combinado: «Lead Vocals & Bass») siempre primero.
 * Después, el bloque más grande: más nombres y, a igualdad, el nombre más
 * largo. El instrumento (Voz > Guitarras > Bajo > Batería) solo desempata.
 * Dentro de cada bloque, el nombre más largo primero.
 */
export function orderMusicianBlocks<T>(blocks: ReadonlyArray<{ role: string; items: T[] }>, nameOf: (item: T) => string): Array<{ role: string; items: T[] }> {
  const sorted = blocks.map((block, index) => ({
    role: block.role,
    items: block.items.map((item, at) => ({ item, at })).sort((a, b) => visualLength(nameOf(b.item)) - visualLength(nameOf(a.item)) || a.at - b.at).map(({ item }) => item),
    index,
  }));
  const longest = (items: T[]) => Math.max(0, ...items.map((item) => visualLength(nameOf(item))));
  sorted.sort((a, b) => Number(isLeadVocals(b.role)) - Number(isLeadVocals(a.role))
    || b.items.length - a.items.length
    || longest(b.items) - longest(a.items)
    || instrumentRank(a.role) - instrumentRank(b.role)
    || a.index - b.index);
  return sorted.map(({ role, items }) => ({ role, items }));
}

// ── Líneas «Rol by Nombre» (punto 12) ──────────────────────────────────────
export interface CreditLine {
  key: string;
  /** «Recorded & Mixed», ya con mayúsculas. */
  roles: string;
  /** «by» o «at» entre rol y nombre; «:» para roles que son sustantivos («Executive Producer: …»). */
  joiner: "by" | "at" | ":";
  /** A quiénes acredita la línea, en orden: «Produced by Gustavo Casas & Ricardo Martínez». */
  targets: Array<{ target: CreditTarget | null; fallback: string }>;
  scope: string | null;
}

const ROLE_ORDER: ReadonlyArray<RegExp> = [
  /^(?:co-?)?produc/iu, /^executive|ejecutiv/iu, /^arrang/iu, /^(?:re-?)?record|grabad/iu, /^engineer/iu, /^mix|mezcl/iu, /^(?:re-?)?master/iu,
];

function roleRank(word: string): number {
  const index = ROLE_ORDER.findIndex((pattern) => pattern.test(word));
  return index === -1 ? ROLE_ORDER.length : index;
}

/** «Produced, Recorded & Mixed»; también para nombres. */
export function joinList(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} & ${items.at(-1)}`;
}

const TRACK_PREFIX = /^(?:except\s+)?(?:tracks?|pistas?|temas?)\s+([\d\s,&y-]+?)\s+(?=\p{L})/iu;
const STUDIO_WORK = /record|mix|master|grabad|mezcl/iu;

/** «Track 8 Recorded & Mixed by» → palabras [«Recorded», «Mixed»], unión «by», alcance «pista 8». */
function parseRole(raw: string, isOrganization: boolean): { words: string[]; joiner: CreditLine["joiner"]; scope: string | null } {
  let text = raw.trim().replace(/\s+/gu, " ");
  let scope: string | null = null;
  const prefix = TRACK_PREFIX.exec(text);
  if (prefix) {
    const numbers = prefix[1]!.split(/[\s,&y-]+/u).filter(Boolean).map((value) => String(Number(value)));
    scope = `${numbers.length === 1 ? "pista" : "pistas"} ${numbers.join(", ")}`;
    text = text.slice(prefix[0].length);
  }
  let joiner: CreditLine["joiner"] | null = null;
  const tail = /\s+(by|at|por|en)\s*:?\s*$/iu.exec(text);
  if (tail) {
    joiner = /^(?:at|en)$/iu.test(tail[1]!) ? "at" : "by";
    text = text.slice(0, tail.index);
  }
  text = text.replace(/\s*:\s*$/u, "");
  const words = text.split(/\s*(?:&|,|\band\b|\sy\s)\s*/iu).map((word) => word.trim()).filter(Boolean);
  const verb = words.length > 0 && words.every((word) => /ed$/iu.test(word.split(" ").at(-1)!));
  // Un estudio graba, mezcla o masteriza «at», aunque la fuente diga «by».
  if (isOrganization && verb && words.every((word) => STUDIO_WORK.test(word))) joiner = "at";
  joiner ??= verb ? "by" : ":";
  return { words, joiner, scope };
}

const sortRoles = (words: string[]) => words.map((word, at) => ({ word, at })).sort((a, b) => roleRank(a.word) - roleRank(b.word) || a.at - b.at).map(({ word }) => word);

/**
 * Créditos atomizados → líneas. Primero se juntan los roles de cada persona
 * («recorded» + «mixed» de Boris Milan → «Recorded & Mixed by Boris Milan»);
 * luego, quienes comparten exactamente los mismos roles van en una sola línea.
 */
export function creditLines(credits: ReadonlyArray<Credit>, scoped: ReadonlyArray<ScopedCredit> = []): CreditLine[] {
  const perTarget = new Map<string, { words: Map<string, string>; joiner: CreditLine["joiner"]; target: CreditTarget | null; fallback: string; scope: string | null; order: number }>();
  let order = 0;
  const push = (credit: Credit, ownScope: string | null) => {
    const target = creditTarget(credit);
    const parsed = parseRole(credit.role || credit.creditType, credit.organizationId !== null && credit.personId === null);
    const scope = ownScope ?? parsed.scope;
    const key = `${target?.key ?? `c${credit.id}`}|${parsed.joiner}|${scope ?? ""}`;
    const group = perTarget.get(key) ?? { words: new Map<string, string>(), joiner: parsed.joiner, target, fallback: credit.role, scope, order: order++ };
    for (const word of parsed.words) {
      const label = roleTitle(word);
      const id = label.toLocaleLowerCase("es");
      if (!group.words.has(id)) group.words.set(id, label);
    }
    perTarget.set(key, group);
  };
  for (const credit of credits) push(credit, null);
  for (const credit of scoped) push(credit, trackScope(credit.tracks));

  const lines = new Map<string, { line: CreditLine; rank: number; order: number }>();
  for (const group of perTarget.values()) {
    const words = sortRoles([...group.words.values()]);
    const roles = joinList(words) || roleTitle(group.fallback);
    const key = `${roles.toLocaleLowerCase("es")}|${group.joiner}|${group.scope ?? ""}`;
    const existing = lines.get(key);
    if (existing) {
      if (!existing.line.targets.some((item) => item.target && item.target.key === group.target?.key)) existing.line.targets.push({ target: group.target, fallback: group.fallback });
      continue;
    }
    lines.set(key, { line: { key, roles, joiner: group.joiner, targets: [{ target: group.target, fallback: group.fallback }], scope: group.scope }, rank: Math.min(ROLE_ORDER.length, ...words.map(roleRank)), order: group.order });
  }
  return [...lines.values()]
    // Como el canal: primero lo de todo el disco y luego lo acotado a pistas; dentro, Produced → Recorded → Mixed → Mastered.
    .sort((a, b) => Number(a.line.scope !== null) - Number(b.line.scope !== null) || a.rank - b.rank || a.order - b.order)
    .map(({ line }) => line);
}

// ── «Otros Créditos» con canal ─────────────────────────────────────────────
type Category = "production" | "composition" | "art" | "musicians" | "other";

function categoryOf(roleKey: string | null): Category {
  if (roleKey === null) return "other";
  if ((PRODUCTION_TYPES as readonly string[]).includes(roleKey)) return "production";
  if ((COMPOSITION_TYPES as readonly string[]).includes(roleKey)) return "composition";
  if ((ART_TYPES as readonly string[]).includes(roleKey)) return "art";
  if ((MUSICIAN_TYPES as readonly string[]).includes(roleKey)) return "musicians";
  return "other";
}

const SECTION_TYPES: Readonly<Record<Exclude<Category, "production" | "other">, readonly string[]>> = {
  composition: COMPOSITION_TYPES, art: ART_TYPES, musicians: MUSICIAN_TYPES,
};

function statementCategory(statement: CreditStatement): Category {
  const role = statement.parts.find((part) => part.type === "role");
  if (role) return categoryOf(role.roleKey);
  if (["artwork", "illustration", "photography"].includes(statement.sectionKind)) return "art";
  return "other";
}

function partKey(part: CreditStatement["parts"][number]): string | null {
  if (part.personId !== null) return `p${part.personId}`;
  if (part.artistId !== null) return `a${part.artistId}`;
  if (part.organizationId !== null) return `o${part.organizationId}`;
  return null;
}

const normalizedName = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Una línea sin rol conocido («Painting: Gianni Fedele») sobra si Arte o
 * Composición ya acreditan a todos sus nombres con ese mismo rol.
 */
function repeatsOwnSection(statement: CreditStatement, creditsByType: CreditsByType, scopedByType: ScopedByType): boolean {
  const entities = statement.parts.filter((part) => part.type === "person" || part.type === "artist" || part.type === "organization");
  if (!entities.length) return false;
  const text = statement.text.toLocaleLowerCase("es");
  const credits = [...ART_TYPES, ...COMPOSITION_TYPES].flatMap((type) => [...(creditsByType[type] ?? []), ...(scopedByType[type] ?? [])]);
  return entities.every((part) => {
    const key = partKey(part);
    const name = normalizedName(Array.from(statement.text).slice(part.start, part.end).join(""));
    return credits.some((credit) => {
      const target = creditTarget(credit);
      const role = roleTitle(credit.role).toLocaleLowerCase("es");
      return target && role.length > 2 && text.includes(role) && (target.key === key || normalizedName(target.name) === name);
    });
  });
}

/** Créditos «otros» sin los que repiten persona y rol de Arte o Composición (datos dobles de dos fuentes). */
export function otherWithoutRepeats<T extends Credit>(others: readonly T[], creditsByType: CreditsByType, scopedByType: ScopedByType): T[] {
  const seen = new Set([...ART_TYPES, ...COMPOSITION_TYPES].flatMap((type) => [...(creditsByType[type] ?? []), ...(scopedByType[type] ?? [])])
    .map((credit) => `${creditTarget(credit)?.key}|${roleTitle(credit.role).toLocaleLowerCase("es")}`));
  return others.filter((credit) => !seen.has(`${creditTarget(credit)?.key}|${roleTitle(credit.role).toLocaleLowerCase("es")}`));
}

export interface OtherCreditsPlan {
  /** Líneas del canal que van a «Otros Créditos», en el orden de la descripción. */
  statements: CreditStatement[];
  /** Producción atomizada que el canal no nombra, y los créditos «otros». */
  lines: CreditLine[];
}

/** Qué va a «Otros Créditos» cuando el disco tiene créditos del canal. */
export function otherCreditsWithChannel(statements: ReadonlyArray<CreditStatement>, creditsByType: CreditsByType, scopedByType: ScopedByType): OtherCreditsPlan {
  const covered = (types: readonly string[]) => {
    const keys = new Set<string>();
    const names = new Set<string>();
    for (const type of types) {
      for (const credit of [...(creditsByType[type] ?? []), ...(scopedByType[type] ?? [])]) {
        const target = creditTarget(credit);
        if (target) { keys.add(target.key); names.add(normalizedName(target.name)); }
      }
    }
    return { keys, names };
  };
  const sections = Object.fromEntries(Object.entries(SECTION_TYPES).map(([category, types]) => [category, covered(types)])) as Record<keyof typeof SECTION_TYPES, ReturnType<typeof covered>>;

  const seen = new Set<string>();
  const shown: CreditStatement[] = [];
  const named = { keys: new Set<string>(), names: new Set<string>() };
  const shownNamed = { keys: new Set<string>(), names: new Set<string>() };
  const remember = (into: typeof named, statement: CreditStatement) => {
    for (const part of statement.parts) {
      const key = partKey(part);
      if (key) into.keys.add(key);
      if (part.type === "person" || part.type === "artist" || part.type === "organization") into.names.add(normalizedName(Array.from(statement.text).slice(part.start, part.end).join("")));
    }
  };
  for (const statement of statements) {
    const text = statement.text.trim().replace(/\s+/gu, " ").toLocaleLowerCase("es");
    if (seen.has(text)) continue; // la misma línea en el video de cada disco
    seen.add(text);
    remember(named, statement);
    const category = statementCategory(statement);
    if (category === "other" && repeatsOwnSection(statement, creditsByType, scopedByType)) continue;
    if (category !== "production" && category !== "other") {
      // Composición, Arte y Músicos tienen sección propia: la línea sobra si esa sección ya nombra a todos.
      const section = sections[category];
      const entities = statement.parts.filter((part) => part.type === "person" || part.type === "artist" || part.type === "organization");
      const repeated = entities.length > 0 && entities.every((part) => {
        const key = partKey(part);
        return (key !== null && section.keys.has(key)) || section.names.has(normalizedName(Array.from(statement.text).slice(part.start, part.end).join("")));
      });
      if (repeated) continue;
    }
    shown.push(statement);
    remember(shownNamed, statement);
  }

  // Lo atomizado que ninguna línea nombra se queda, como línea: no se pierde nada.
  const missingFrom = (names: typeof named) => (credit: Credit) => {
    const target = creditTarget(credit);
    if (!target) return true;
    return !names.keys.has(target.key) && !names.names.has(normalizedName(target.name));
  };
  const production = PRODUCTION_TYPES.flatMap((type) => (creditsByType[type] ?? []).filter(missingFrom(named)));
  const productionScoped = PRODUCTION_TYPES.flatMap((type) => (scopedByType[type] ?? []).filter(missingFrom(named)));
  const other = otherWithoutRepeats(creditsByType.other ?? [], creditsByType, scopedByType).filter(missingFrom(shownNamed));
  const otherScoped = otherWithoutRepeats(scopedByType.other ?? [], creditsByType, scopedByType).filter(missingFrom(shownNamed));
  return {
    statements: shown,
    lines: [...creditLines(production, productionScoped), ...creditLines(other, otherScoped)],
  };
}
