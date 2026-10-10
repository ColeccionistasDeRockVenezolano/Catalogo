// CRV · Separar una ficha de persona que junta a varios homónimos (caso Víctor
// Valerio, Brian 2026-10-06). Lee un plan JSON verificado en fuentes y, en UNA
// run de operador:
//   · crea una ficha por cada parte (createEntity, como alta humana);
//   · MUEVE (no copia) sus créditos de disco y de pista y sus membresías, con
//     auditoría por fila enlazada a los claims de cada fila;
//   · mueve los claims de nombre de las páginas de esos créditos y los alias
//     indicados, para que la ER vuelva a encontrar a cada uno donde está;
//   · declara distintas todas las fichas resultantes entre sí
//     (`ingest.curation_distinct_pairs`), salvo los pares que el plan deja
//     abiertos en la mesa (`reviewWith`), y corrige los campos de la original;
//   · deriva `is_venezuelan` donde el plan lo pide;
//   · una parte con `into` no crea ficha: devuelve lo suyo a la ficha que ya
//     existía para esa persona (deshace una fusión equivocada) y une sus
//     membresías repetidas;
//   · en la original, un campo en null se vacía (la fecha era de otro) y
//     `removeMemberships` retira membresías derivadas por error.
// Después el veto temporal (src/merge/era-guard.ts) impide volver a juntarlas.
//
// Sin --confirm corre entero y se deshace.
//   ./scripts/with-node22.sh npx tsx scripts/split-person-by-era.ts --plan=docs/decisions/2026-10-06-separar-por-epoca.json [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { closeDb } from "../src/db/client.js";
import { consolidateMemberships } from "../src/merge/equivalent-relations.js";
import { createEntity, updateEntity, withOperatorRun } from "../src/merge/operator.js";
import { removeRelation } from "../src/merge/removals.js";
import { deriveVenezuelanFor } from "../src/merge/venezuelan.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

const CONFIRM = process.argv.includes("--confirm");
const PLAN = process.argv.find((arg) => arg.startsWith("--plan="))?.slice(7) ?? "docs/decisions/2026-10-06-separar-por-epoca.json";

const fields = z.record(z.string(), z.union([z.string(), z.boolean(), z.null()]));
const part = z.object({
  key: z.string(),
  name: z.string(),
  /** Ficha existente de esta persona: se le devuelve lo suyo en vez de crear una. */
  into: z.number().int().optional(),
  fields: fields.default({}),
  aliases: z.array(z.string()).default([]),
  albumCredits: z.array(z.number().int()).default([]),
  trackCredits: z.array(z.number().int()).default([]),
  memberships: z.array(z.number().int()).default([]),
  /** Claims de la ficha original sin página (YouTube, operador) que son de esta parte. */
  claims: z.array(z.number().int()).default([]),
  /** Filas de ingest.person_aliases de la original que son de esta parte. */
  moveAliasIds: z.array(z.number().int()).default([]),
  deriveVenezuelan: z.boolean().default(false),
  /** Par que NO se declara distinto: queda en la mesa (sin proyecto común que lo pruebe). */
  reviewWith: z.object({ key: z.string(), why: z.string() }).optional(),
  evidence: z.array(z.string()).min(1),
});
const planSchema = z.object({
  note: z.string(),
  splits: z.array(z.object({
    from: z.number().int(),
    expectName: z.string(),
    why: z.string(),
    keep: z.object({
      fields: fields.default({}), deriveVenezuelan: z.boolean().default(false), evidence: z.array(z.string()).default([]),
      removeMemberships: z.array(z.object({ id: z.number().int(), why: z.string() })).default([]),
      /** Créditos que la ficha no debía tener (p. ej. enganchados al disco equivocado). */
      removeCredits: z.array(z.object({ kind: z.enum(["album_credit", "track_credit"]), id: z.number().int(), why: z.string() })).default([]),
    }),
    parts: z.array(part).default([]),
  })),
});
type Plan = z.infer<typeof planSchema>;
const plan: Plan = planSchema.parse(JSON.parse(readFileSync(PLAN, "utf8")));

class DryRun extends Error {}

async function audit(client: PoolClient, runId: number, kind: "person" | "album_credit" | "track_credit" | "artist_membership", id: number,
  field: string, oldValue: unknown, newValue: unknown, reason: string, claims: number[]): Promise<void> {
  const column = kind === "person" ? "person_id" : kind === "artist_membership" ? "artist_membership_id" : `${kind}_id`;
  const row = await client.query<{ id: string }>(`
    INSERT INTO ingest.merge_audit(run_id,entity_kind,${column},field,old_value,new_value,reason,confidence,performed_by)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,'high','human') RETURNING id::text`,
  [runId, kind, id, field, JSON.stringify(oldValue), JSON.stringify(newValue), `Separación por época: ${reason}`]);
  if (claims.length) {
    await client.query("INSERT INTO ingest.merge_audit_claims(merge_audit_id,claim_id) SELECT $1::bigint, unnest($2::bigint[]) ON CONFLICT DO NOTHING",
      [Number(row.rows[0]!.id), claims]);
  }
}

const TABLES = { albumCredits: ["album_credits", "album_credit"], trackCredits: ["track_credits", "track_credit"], memberships: ["artist_members", "artist_membership"] } as const;

const report: Array<Record<string, unknown>> = [];
let runId: number | null = null;
try {
  const result = await withOperatorRun({
    name: "personas:separar-por-epoca", operator: "claude-code (pedido por Brian)", note: plan.note, params: { plan: PLAN },
  }, async (context) => {
    const { client } = context;
    for (const split of plan.splits) {
      const source = (await client.query<{ name: string }>("SELECT name FROM public.persons WHERE id=$1 FOR UPDATE", [split.from])).rows[0];
      if (!source || source.name !== split.expectName) throw new Error(`persona ${split.from}: se esperaba «${split.expectName}», hay «${source?.name ?? "nada"}»`);
      const ids = new Map<string, number>([["original", split.from]]);
      const moved: Record<string, unknown> = {};
      for (const item of split.parts) {
        // Todo lo que se mueve tiene que seguir siendo de la ficha original.
        for (const [key, [table]] of Object.entries(TABLES) as Array<[keyof typeof TABLES, readonly [string, string]]>) {
          const wanted = item[key];
          if (!wanted.length) continue;
          const { rows } = await client.query<{ id: string }>(`SELECT id::text FROM public.${table} WHERE id = ANY($1::bigint[]) AND person_id=$2`, [wanted, split.from]);
          if (rows.length !== wanted.length) {
            const have = new Set(rows.map((row) => Number(row.id)));
            throw new Error(`${split.from}/${item.key}: ${table} ${wanted.filter((id) => !have.has(id)).join(", ")} ya no son de la ficha`);
          }
        }
        let id: number;
        if (item.into !== undefined) {
          const target = (await client.query<{ name: string }>("SELECT name FROM public.persons WHERE id=$1 FOR UPDATE", [item.into])).rows[0];
          if (!target || target.name !== item.name) throw new Error(`${split.from}/${item.key}: la ficha ${item.into} no es «${item.name}» (hay «${target?.name ?? "nada"}»)`);
          id = item.into;
        } else {
          id = (await createEntity(context, "person", { name: item.name }, { allowSimilar: true })).id;
        }
        ids.set(item.key, id);
        const noteFields = Object.fromEntries(Object.entries(item.fields).filter(([, value]) => value !== null));
        if (Object.keys(noteFields).length) await updateEntity(context, "person", id, noteFields);
        await audit(client, context.runId, "person", id, "split_from", null, { from: split.from, fromName: source.name, evidence: item.evidence }, split.why, []);
        const pages = new Set<number>();
        // Nombres con que la fuente acredita lo que se mueve: en una página que
        // nombra a dos de las personas juntadas, cada claim de nombre va con la suya.
        const names = new Set<string>();
        for (const [key, [table, kind]] of Object.entries(TABLES) as Array<[keyof typeof TABLES, readonly [string, "album_credit" | "track_credit" | "artist_membership"]]>) {
          for (const rowId of item[key]) {
            await client.query(`UPDATE public.${table} SET person_id=$2 WHERE id=$1`, [rowId, id]);
            const { rows: claims } = await client.query<{ id: string; raw_page_id: string | null; field: string; value: string }>(
              `SELECT id::text, raw_page_id::text, field, raw_value::text AS value FROM ingest.claims WHERE ${kind}_id=$1`, [rowId]);
            for (const claim of claims) {
              if (claim.raw_page_id !== null) pages.add(Number(claim.raw_page_id));
              if (claim.field === "credited_name" || claim.field === "person_name") names.add(claim.value);
            }
            await audit(client, context.runId, kind, rowId, "person_id", split.from, id, split.why, claims.map((claim) => Number(claim.id)));
          }
        }
        const { rows: nameClaims } = await client.query<{ id: string }>(`
          UPDATE ingest.claims SET person_id=$2, updated_at=now()
           WHERE person_id=$1 AND ((field='name' AND raw_page_id = ANY($3::bigint[]) AND (cardinality($5::text[])=0 OR raw_value::text = ANY($5::text[])))
                                   OR id = ANY($4::bigint[]))
          RETURNING id::text`, [split.from, id, [...pages], item.claims, [...names]]);
        const { rows: aliases } = await client.query<{ alias: string }>(
          "UPDATE ingest.person_aliases SET person_id=$2 WHERE id = ANY($3::bigint[]) AND person_id=$1 RETURNING alias", [split.from, id, item.moveAliasIds]);
        for (const alias of item.aliases) {
          await client.query(`
            INSERT INTO ingest.person_aliases(person_id,alias,alias_type,normalized_alias,is_primary,confidence,notes)
            SELECT $1::bigint,$2::text,'name_variant',$3::text,false,'high',$4::text
             WHERE NOT EXISTS (SELECT 1 FROM ingest.person_aliases WHERE person_id=$1::bigint AND normalized_alias=$3::text)`,
          [id, alias, normalizeEntityName(alias).primaryKey, `Separada de la ficha ${split.from} (${item.evidence[0]})`]);
        }
        // Devuelta a una ficha que ya estaba en esa banda: una fila por persona y etapa.
        const consolidated = item.into !== undefined && item.memberships.length
          ? (await consolidateMemberships(client, { personId: id }, `Separación por época: ${split.why}`, context.runId)).merged : 0;
        moved[item.key] = { id, into: item.into ?? null, name: item.name, membershipsConsolidated: consolidated, albumCredits: item.albumCredits.length, trackCredits: item.trackCredits.length,
          memberships: item.memberships.length, claims: nameClaims.length, aliasesMoved: aliases.map((row) => row.alias), aliasesAdded: item.aliases };
      }
      // En la original, null vacía el campo: el dato era del homónimo que se fue.
      if (Object.keys(split.keep.fields).length) await updateEntity(context, "person", split.from, split.keep.fields);
      const removed: string[] = [];
      const removals = [
        ...split.keep.removeMemberships.map((item) => ({ ...item, kind: "artist_membership" as const })),
        ...split.keep.removeCredits,
      ];
      const removalTables = { artist_membership: "artist_members", album_credit: "album_credits", track_credit: "track_credits" } as const;
      for (const removal of removals) {
        const { rows } = await client.query(`SELECT 1 FROM public.${removalTables[removal.kind]} WHERE id=$1 AND person_id=$2`, [removal.id, split.from]);
        if (!rows.length) throw new Error(`${split.from}: ${removal.kind} ${removal.id} ya no es de la ficha`);
        await removeRelation(client, removal.kind, removal.id, { note: `Trayectoria imposible: ${removal.why}`, runId: context.runId });
        removed.push(`${removal.kind}:${removal.id}`);
      }
      // Todas distintas entre sí, salvo los pares que quedan en la mesa.
      const open = new Set(split.parts.flatMap((item) => item.reviewWith ? [[item.key, item.reviewWith.key].sort().join("|")] : []));
      const keys = [...ids.keys()];
      let distinct = 0;
      for (let i = 0; i < keys.length; i += 1) {
        for (let j = i + 1; j < keys.length; j += 1) {
          if (open.has([keys[i]!, keys[j]!].sort().join("|"))) continue;
          const [a, b] = [ids.get(keys[i]!)!, ids.get(keys[j]!)!].sort((x, y) => x - y);
          await client.query(`
            INSERT INTO ingest.curation_distinct_pairs (kind, a_id, b_id, decided_by, note) VALUES ('person', $1, $2, 'brian', $3)
            ON CONFLICT DO NOTHING`, [a, b, `Homónimos separados por época (${plan.note}): ${split.why}`]);
          distinct += 1;
        }
      }
      for (const item of split.parts) {
        if (!item.reviewWith) continue;
        const [a, b] = [ids.get(item.key)!, ids.get(item.reviewWith.key)!].sort((x, y) => x - y);
        await client.query(`
          INSERT INTO ingest.review_queue(kind,person_a_id,person_b_id,priority,status,payload,notes)
          SELECT 'person_duplicate',$1::bigint,$2::bigint,6,'open',$3::jsonb,$4
           WHERE NOT EXISTS (SELECT 1 FROM ingest.review_queue q WHERE q.kind='person_duplicate' AND q.status IN ('open','in_progress')
                             AND q.person_a_id=$1::bigint AND q.person_b_id=$2::bigint)`,
        [a, b, JSON.stringify({ detector: "split-person-by-era", runId: context.runId }), item.reviewWith.why]);
      }
      const derive = [...(split.keep.deriveVenezuelan ? [split.from] : []), ...split.parts.filter((item) => item.deriveVenezuelan).map((item) => ids.get(item.key)!)];
      const marked = derive.length ? await deriveVenezuelanFor(client, derive, context.runId) : 0;
      const after = (await client.query(`SELECT birth_date::text, death_date::text, birth_city, nationality, real_name, is_venezuelan, left(notes, 60) AS notes
        FROM public.persons WHERE id=$1`, [split.from])).rows[0];
      report.push({ from: split.from, name: source.name, after, parts: moved, relationsRemoved: removed, distinctPairs: distinct, venezuelanMarked: marked });
    }
    if (!CONFIRM) throw new DryRun();
  });
  runId = result.runId;
} catch (error) {
  if (!(error instanceof DryRun)) throw error;
}
const out = `reports/${basename(PLAN, ".json")}${CONFIRM ? `-run${runId}` : "-dry-run"}.json`;
writeFileSync(out, `${JSON.stringify({ plan: PLAN, confirm: CONFIRM, runId, report }, null, 2)}\n`);
console.log(JSON.stringify({ out, runId, report }, null, 2));
await closeDb();
