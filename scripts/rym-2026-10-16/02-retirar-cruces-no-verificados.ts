// Retira solo los aportes del run RYM 20262 para identidades que la revisión
// independiente no confirmó. Conserva los datos previos y salta filas editadas
// después. El run nuevo es reversible; el informe IA queda como evidencia.
// Uso: tsx scripts/rym-2026-10-16/02-retirar-cruces-no-verificados.ts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { deleteAlias } from "../../src/api/repositories/aliases.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { deleteRelation, updateEntity, withOperatorRun } from "../../src/merge/operator.js";

const REVIEW = "reports/rym-resto-2026-10-16/revision-identidad-20262-completa.jsonl";
const JOBS = "reports/rym-resto-2026-10-16/artista-ensayo.json";
const CONFIRM = process.argv.includes("--confirm");
type Review = { artistId: number; name: string; verdict: { identity: "same" | "different" | "uncertain" } | null };
type Audit = { id: string; target_id: string; field: string; old_value: unknown; new_value: unknown };
type Inserted = { id: string; artist_id: string; changed_later: boolean };

function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

async function main(): Promise<void> {
  const pool = getPool();
  const reviews = readFileSync(REVIEW, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Review);
  const review = new Map(reviews.map((row) => [row.artistId, row.verdict?.identity ?? "error"]));
  const jobs = JSON.parse(readFileSync(JOBS, "utf8")) as { trabajos: Array<{
    artistId: number; personas: Array<{ personId: number }>;
  }> };
  const ids = new Set(jobs.trabajos.map((job) => job.artistId));
  if (review.size !== ids.size || [...ids].some((id) => !review.has(id))) throw new Error("La revisión IA no cubre todas las fichas del run 20262");
  const unverified = new Set([...review].filter(([, verdict]) => verdict !== "same").map(([id]) => id));
  const personOwners = new Map<number, Set<number>>();
  for (const job of jobs.trabajos) for (const person of job.personas) {
    personOwners.set(person.personId, new Set([...(personOwners.get(person.personId) ?? []), job.artistId]));
  }
  const unverifiedPersons = new Set([...personOwners].filter(([, owners]) => [...owners].every((id) => unverified.has(id))).map(([id]) => id));
  const artistAudits = (await pool.query<Audit>(`
    SELECT id::text,artist_id::text AS target_id,field,old_value,new_value
      FROM ingest.merge_audit WHERE run_id=20262 AND artist_id IS NOT NULL ORDER BY id`,
  )).rows.filter((row) => unverified.has(Number(row.target_id)));
  const personAudits = (await pool.query<Audit>(`
    SELECT id::text,person_id::text AS target_id,field,old_value,new_value
      FROM ingest.merge_audit WHERE run_id=20262 AND person_id IS NOT NULL ORDER BY id`,
  )).rows.filter((row) => unverifiedPersons.has(Number(row.target_id)));
  const inserted = async (table: "ingest.artist_aliases" | "public.artist_members"): Promise<Inserted[]> =>
    (await pool.query<Inserted>(`
      SELECT j.row_pk->>'id' AS id,j.new_data->>'artist_id' AS artist_id,
             EXISTS(SELECT 1 FROM ingest.change_journal later
                     WHERE later.id>j.id AND later.table_name=j.table_name AND later.row_pk=j.row_pk) AS changed_later
        FROM ingest.change_journal j
       WHERE j.run_id=20262 AND j.table_name=$1 AND j.op='I'`, [table])).rows
      .filter((row) => unverified.has(Number(row.artist_id)));
  const aliases = await inserted("ingest.artist_aliases");
  const memberships = await inserted("public.artist_members");
  console.log(JSON.stringify({ reviewed: review.size, same: review.size - unverified.size, unverified: unverified.size,
    artistAudits: artistAudits.length, personAudits: personAudits.length, aliases: aliases.length, memberships: memberships.length }));
  if (!CONFIRM) { console.log("ensayo; usar --confirm para retirar los aportes no verificados"); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:rym-20262-retirar-no-verificados",
    operator: "codex (encargo de Brian 2026-10-16)",
    note: "Retirar solo los aportes del run RYM 20262 cuya identidad no confirmó la revisión de biografía y discografía; preserva los datos previos y las ediciones posteriores.",
  }, async (context) => {
    const summary = { artistFields: 0, personFields: 0, aliases: 0, memberships: 0, skipped: [] as string[] };
    for (const [kind, audits] of [["artist", artistAudits], ["person", personAudits]] as const) {
      const grouped = new Map<string, Audit[]>();
      for (const row of audits) {
        const key = `${row.target_id}:${row.field}`;
        grouped.set(key, [...(grouped.get(key) ?? []), row]);
      }
      for (const history of grouped.values()) {
        const first = history[0]!;
        const last = history.at(-1)!;
        const table = kind === "artist" ? "public.artists" : "public.persons";
        const live = (await context.client.query<{ value: unknown }>(
          `SELECT ${first.field} AS value FROM ${table} WHERE id=$1`, [Number(first.target_id)],
        )).rows[0];
        if (!live || !equal(live.value, last.new_value)) {
          summary.skipped.push(`${kind}:${first.target_id}:${first.field}:cambió después`);
          continue;
        }
        await updateEntity(context, kind, Number(first.target_id), { [first.field]: first.old_value });
        if (kind === "artist") summary.artistFields++; else summary.personFields++;
      }
    }
    for (const row of aliases) {
      if (row.changed_later) { summary.skipped.push(`alias:${row.id}:editado después`); continue; }
      const live = await context.client.query("SELECT 1 FROM ingest.artist_aliases WHERE id=$1 AND artist_id=$2", [row.id, row.artist_id]);
      if (!live.rowCount) continue;
      await deleteAlias(context, "artist", Number(row.artist_id), Number(row.id));
      summary.aliases++;
    }
    for (const row of memberships) {
      if (row.changed_later) { summary.skipped.push(`membresía:${row.id}:editada después`); continue; }
      const live = await context.client.query("SELECT 1 FROM public.artist_members WHERE id=$1 AND artist_id=$2", [row.id, row.artist_id]);
      if (!live.rowCount) continue;
      await deleteRelation(context, "artist_membership", Number(row.id));
      summary.memberships++;
    }
    return summary;
  });
  const report = { runId, ...result };
  writeFileSync("reports/rym-resto-2026-10-16/retirada-no-verificados-20262.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, skipped: result.skipped.length }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
