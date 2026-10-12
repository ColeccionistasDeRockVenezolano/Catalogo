// CRV · Plan del primo, etapa 2 (2026-10-12), tanda 2B.1: sellos compuestos.
//
// «PolyGram/Rodven», «Lyric/AVR», «Independent/Cendis»… se parten en sus sellos
// reales, cada uno con su rol en el disco (`ingest.album_labels`: sello,
// distribuidor o licenciatario). NO se deduce un traspaso entre empresas.
// La ficha compuesta se fusiona en el sello principal: sus discos, claims y
// alias pasan a él y el nombre compuesto queda como alias «variante de fuente»
// (oculto al público, útil para la búsqueda y las ingestas). Nada se borra.
//
//   npx tsx scripts/primo-etapa2-sellos.ts            ensayo: escribe el plan
//   npx tsx scripts/primo-etapa2-sellos.ts --confirm  aplica en un run
import { writeFileSync, mkdirSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { labelMatchKeys, looseKey, splitCompositeLabel, LABEL_ROLE_LABEL, type LabelRole } from "../src/discography/labels.js";
import { createEntity, withOperatorRun, OperatorError, type OperatorContext } from "../src/merge/operator.js";
import { mergeEntities, previewEntityMerge } from "../src/merge/entity-merge.js";

const confirm = process.argv.includes("--confirm");
const NOTE = "Plan del primo, etapa 2 (2026-10-12): sellos compuestos partidos con su rol (punto 7)";
const OUT = "reports/primo-etapa2";

/**
 * Formas de la fuente que no casan por nombre con la ficha del sello: un id
 * (ficha existente) o el nombre con el que se crea la nueva.
 */
const SYNONYMS: Readonly<Record<string, string | number>> = {
  "philpis": "Philips",
  "icr": "ICRecords",
  "ic": "ICRecords",
  "inv cddvd": "CDDVD Music",
  "luz rec": "Luz Records",
  "mucer": 374, "mucer int": 374,            // Mucer Internacional
  "balboa": 24,                             // Balboa Records (con 11 discos como sello)
  "tucan": 1178,                            // Tucan Records C.A.
  "dorian": 4224,                           // Dorian Recordings
  "diario meridiano": "Meridiano",
  "haf prod": "HAF Productions",
  // Sony Music (396) tiene «Columbia» como alias: el sello Columbia es otra ficha.
  "columbia": "Columbia Records",
  "a y m": "A&M Records",
};

interface Org { id: number; name: string; type: string; albums: number; aliases: string[] }
interface PartPlan { name: string; role: LabelRole; orgId: number | null; orgName: string | null; create: boolean }
interface CompositePlan { id: number; name: string; albums: number[]; parts: PartPlan[]; keepId: number | null; doubt: string | null; skipped?: string }

const pool = getPool();
const orgs = (await pool.query<{ id: string; name: string; type: string; albums: string; aliases: string[] | null }>(`
  SELECT o.id::text, o.name, o.organization_type::text AS type,
         (SELECT count(*) FROM public.albums a WHERE a.label_id = o.id)::text AS albums,
         (SELECT array_agg(x.alias) FROM ingest.organization_aliases x WHERE x.organization_id = o.id) AS aliases
    FROM public.organizations o`)).rows.map((row): Org => ({ id: Number(row.id), name: row.name, type: row.type, albums: Number(row.albums), aliases: row.aliases ?? [] }));

const index = new Map<string, Org[]>();
for (const org of orgs) {
  if (org.name.includes("/")) continue;
  for (const name of [org.name, ...org.aliases.filter((alias) => !alias.includes("/"))]) {
    for (const key of labelMatchKeys(name)) index.set(key, [...(index.get(key) ?? []).filter((o) => o.id !== org.id), org]);
  }
}
const typeRank = (type: string) => (type === "record_label" ? 0 : type === "distributor" ? 1 : type === "production_company" ? 2 : type === "other" ? 3 : 4);

const loose = (name: string): string => looseKey(name);
const synonymOf = (name: string): string | number | undefined =>
  labelMatchKeys(name).map((key) => SYNONYMS[key]).find((value) => value !== undefined);
const canonicalName = (name: string): string => {
  const synonym = synonymOf(name);
  return typeof synonym === "string" ? synonym : name;
};

function findOrg(name: string): Org | null {
  const synonym = synonymOf(name);
  if (typeof synonym === "number") return orgs.find((org) => org.id === synonym) ?? null;
  if (synonym === "Columbia Records") return orgs.find((org) => org.name === "Columbia Records" && org.type === "record_label") ?? null;
  const wanted = synonym ?? name;
  const candidates = new Map<number, Org>();
  for (const key of labelMatchKeys(wanted)) for (const org of index.get(key) ?? []) candidates.set(org.id, org);
  const list = [...candidates.values()].filter((org) => org.type !== "recording_studio");
  list.sort((a, b) => typeRank(a.type) - typeRank(b.type) || b.albums - a.albums || a.id - b.id);
  return list[0] ?? null;
}

const composites = orgs.filter((org) => org.type === "record_label" && org.name.includes("/"));
const albumsOf = new Map<number, number[]>();
for (const row of (await pool.query<{ id: string; label_id: string }>(
  "SELECT id::text, label_id::text FROM public.albums WHERE label_id = ANY($1::bigint[])", [composites.map((org) => org.id)])).rows) {
  albumsOf.set(Number(row.label_id), [...(albumsOf.get(Number(row.label_id)) ?? []), Number(row.id)]);
}

const plan: CompositePlan[] = composites.map((org) => {
  const split = splitCompositeLabel(org.name);
  const albums = albumsOf.get(org.id) ?? [];
  if (!split) return { id: org.id, name: org.name, albums, parts: [], keepId: null, doubt: null, skipped: "no es un compuesto (un solo sello con barra)" };
  const parts = split.parts.map((part): PartPlan => {
    const found = findOrg(part.name);
    return { name: part.name, role: part.role, orgId: found?.id ?? null, orgName: found?.name ?? null, create: !found };
  });
  const main = parts.find((part) => part.role === "label") ?? parts[0]!;
  return { id: org.id, name: org.name, albums, parts, keepId: main.orgId, doubt: split.doubt };
});

mkdirSync(OUT, { recursive: true });
const md = ["# Sellos compuestos — " + (confirm ? "aplicado" : "ensayo"), "",
  `${plan.filter((p) => !p.skipped).length} compuestos se parten; ${plan.filter((p) => p.skipped).length} se quedan como un sello.`, "",
  "| Compuesto | Discos | Partes (rol → ficha) | Duda |", "|---|---:|---|---|",
  ...plan.map((p) => `| ${p.name} (${p.id}) | ${p.albums.length} | ${p.skipped ? `_${p.skipped}_` : p.parts.map((part) => `${LABEL_ROLE_LABEL[part.role]}: ${part.orgId ? `${part.orgName} (${part.orgId})` : `**nueva** «${canonicalName(part.name)}»`}`).join(" · ")} | ${p.doubt ?? ""} |`)];
writeFileSync(`${OUT}/sellos-${confirm ? "aplicado" : "ensayo"}.md`, md.join("\n") + "\n");
console.log(md.slice(0, 4).join("\n"));
console.log(`nuevas fichas: ${[...new Set(plan.flatMap((p) => p.parts).filter((part) => part.create).map((part) => canonicalName(part.name)))].join(", ")}`);

async function resolvePart(context: OperatorContext, part: PartPlan, created: Map<string, number>): Promise<number> {
  if (part.orgId) return part.orgId;
  const name = canonicalName(part.name);
  const known = created.get(loose(name));
  if (known) return known;
  let id: number;
  try {
    id = (await createEntity(context, "organization", {
      name, organization_type: "record_label",
      notes: "Creado al partir un sello compuesto (plan del primo, etapa 2, 2026-10-12).",
    }, { allowSimilar: true })).id;
  } catch (error) {
    if (error instanceof OperatorError && typeof error.details?.["existingId"] === "number") id = error.details["existingId"] as number;
    else throw error;
  }
  created.set(loose(name), id);
  return id;
}

if (confirm) {
  const { runId, result } = await withOperatorRun({ name: "primo-etapa2:sellos", operator: "claude-code", note: NOTE }, async (context) => {
    const created = new Map<string, number>();
    let rows = 0; let merged = 0;
    for (const item of plan) {
      if (item.skipped) continue;
      const ids = [];
      for (const part of item.parts) ids.push(await resolvePart(context, part, created));
      const keepId = ids[item.parts.findIndex((part) => part.role === "label")] ?? ids[0]!;
      // El papel de cada empresa en cada disco que llevaba el compuesto.
      for (const albumId of item.albums) {
        for (const [position, part] of item.parts.entries()) {
          const inserted = await context.client.query(`
            INSERT INTO ingest.album_labels(album_id, version_id, organization_id, role, position, source_text, run_id)
            VALUES ($1, (SELECT id FROM ingest.album_versions WHERE album_id = $1 AND is_primary), $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING`, [albumId, ids[position], part.role, position + 1, item.name, context.runId]);
          rows += inserted.rowCount ?? 0;
        }
      }
      // La ficha compuesta se funde en el sello principal; su nombre queda como variante de fuente.
      const preview = await previewEntityMerge(context.client, "organization", keepId, item.id);
      await mergeEntities(context, { kind: "organization", keepId, dropId: item.id, previewHash: preview.previewHash, keepDropNameAsAlias: true });
      await context.client.query(`
        UPDATE ingest.organization_aliases SET alias_type = 'source_variant', notes = concat_ws(' · ', notes, $3::text)
         WHERE organization_id = $1 AND alias = $2`, [keepId, item.name, "Sello compuesto partido (plan del primo, etapa 2)"]);
      merged++;
    }
    return { rows, merged, created: created.size };
  });
  console.log(`run ${runId}:`, result);
}
await closeDb();
