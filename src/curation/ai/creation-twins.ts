// Plan 20/20 · altas que repiten una ficha.
//
// La resolución de entidades solo compara el nombre canónico completo, así que una
// propuesta de alta podía pasar como documentada aunque la ficha ya existiera con otra
// grafía: «4to Poder - Cuarto Poder» frente al artista «Cuarto Poder», la persona
// «Larry Porfirio Rada Herrera» frente a «Apache» con ese nombre real, o la misma banda
// creada como organización. Aquí cada nombre se separa en las variantes que él mismo
// declara y se compara con nombres, alias y nombres reales del catálogo y con las
// otras altas del plan. Un parecido no bloquea: pide criterio editorial.
import type { PoolClient } from "pg";
import type { CatalogKind, CatalogOperation } from "./types.js";

const ORDINALS: Record<string, string> = {
  "1ro": "primero", "1er": "primer", "2do": "segundo", "3ro": "tercero", "3er": "tercer", "4to": "cuarto",
  "5to": "quinto", "6to": "sexto", "7mo": "septimo", "8vo": "octavo", "9no": "noveno", "10mo": "decimo",
};
const KIND_NAMES: Partial<Record<CatalogKind, string>> = { artist: "artista", organization: "organización", person: "persona" };

/** Comparable form: no accents, case or punctuation; written ordinals («4to») read as words («cuarto»). */
export function identityForm(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\b(\d{1,2})\s*(ro|er|do|to|mo|vo|no)\b\.?/gu, (match, number: string, suffix: string) => ORDINALS[`${number}${suffix}`] ?? match)
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** A name plus the variants it spells out itself: «A - B», «A / B», «A (B)», «A aka B». */
export function nameVariants(...names: unknown[]): string[] {
  const variants = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) continue;
    for (const part of [name, ...name.split(/\s+[-–—/|]\s+|\s*[()]\s*|\s+(?:aka|a\.k\.a\.|alias)\s+/iu)]) {
      const form = identityForm(part);
      if (form.length >= 3) variants.add(form);
    }
  }
  return [...variants];
}

/** SQL_ASCII stores accents as two bytes: each vowel or ñ also matches any one or two bytes. */
function loosePattern(word: string): string {
  return word.replace(/[aeioun]/gu, (letter) => `(${letter}|..)`);
}

interface Row { kind: CatalogKind; id: number; name: string; forms: string }
const SEARCH: Partial<Record<CatalogKind, CatalogKind[]>> = { artist: ["artist", "organization"], organization: ["organization", "artist"], person: ["person"] };
const TABLES: Partial<Record<CatalogKind, { table: string; aliases: string; key: string; extra: string }>> = {
  artist: { table: "public.artists", aliases: "ingest.artist_aliases", key: "artist_id", extra: "NULL" },
  organization: { table: "public.organizations", aliases: "ingest.organization_aliases", key: "organization_id", extra: "NULL" },
  person: { table: "public.persons", aliases: "ingest.person_aliases", key: "person_id", extra: "e.real_name" },
};

async function candidates(client: PoolClient, kind: CatalogKind, variants: string[]): Promise<Row[]> {
  const spec = TABLES[kind];
  if (!spec) return [];
  // The longest word of each variant narrows the search; the comparison itself is done here.
  const words = [...new Set(variants.map((variant) => variant.split(" ").filter((word) => /\p{L}/u.test(word)).sort((a, b) => b.length - a.length)[0]).filter((word): word is string => Boolean(word) && word!.length >= 3))];
  if (!words.length) return [];
  const pattern = words.map(loosePattern).join("|");
  const rows = await client.query<{ id: number; name: string; forms: string }>(
    `SELECT e.id::int, e.name, concat_ws(' | ', e.name, ${spec.extra}, (SELECT string_agg(a.alias, ' | ') FROM ${spec.aliases} a WHERE a.${spec.key}=e.id)) AS forms
       FROM ${spec.table} e
      WHERE e.name ~* $1 OR ${spec.extra === "NULL" ? "false" : `${spec.extra} ~* $1`}
         OR EXISTS (SELECT 1 FROM ${spec.aliases} a WHERE a.${spec.key}=e.id AND a.alias ~* $1)
      LIMIT 300`,
    [pattern],
  );
  return rows.rows.map((row) => ({ kind, ...row }));
}

/**
 * Why a proposed record is probably one that already exists or that another proposal of the plan
 * creates; null when nothing resembles it. Exact same-kind names are left to the catalog's own check.
 */
export async function creationTwin(
  client: PoolClient,
  op: Extract<CatalogOperation, { op: "create_entity" }>,
  plan: CatalogOperation[],
  labels: (kind: CatalogKind, id: number) => string | undefined,
): Promise<string | null> {
  const kinds = SEARCH[op.kind];
  if (!kinds) return null;
  const own = nameVariants(op.values["name"], op.values["realName"]);
  if (!own.length) return null;
  const mine = new Set(own);
  const shares = (forms: string) => nameVariants(...forms.split(" | ")).some((form) => mine.has(form));
  const fullName = identityForm(String(op.values["name"] ?? ""));

  // Another proposal registers this name as the real name of an existing person.
  if (op.kind === "person")
    for (const other of plan)
      if (other.op === "replace_fields" && other.target.kind === "person" && "id" in other.target && typeof other.values["realName"] === "string" && shares(other.values["realName"])) {
        const label = labels("person", other.target.id) ?? `#${other.target.id}`;
        return `Criterio editorial: otra propuesta registra este nombre real en la persona «${label}» (#${other.target.id}); probablemente es la misma. Si es otra, al aceptarla se crea como ficha distinta.`;
      }
  // An earlier proposal of the plan already creates it.
  for (const other of plan) {
    if (other.key === op.key) break;
    if (other.op === "create_entity" && kinds.includes(other.kind) && shares([other.values["name"], other.values["realName"]].filter((v) => typeof v === "string").join(" | ")))
      return `Criterio editorial: la propuesta «${other.label}» ya crea esta ficha. Decide solo una; si es otra, al aceptarla se crea como ficha distinta.`;
  }
  const found: Row[] = [];
  for (const kind of kinds) found.push(...(await candidates(client, kind, own)).filter((row) => shares(row.forms)));
  const twins = found.filter((row) => !(row.kind === op.kind && identityForm(row.name) === fullName)).slice(0, 3);
  if (!twins.length) return null;
  const list = twins.map((row) => `${KIND_NAMES[row.kind]} «${row.name}» (#${row.id})`).join(", ");
  return `Criterio editorial: probablemente ya existe: ${list}. Si es otra, al aceptarla se crea como ficha distinta.`;
}
