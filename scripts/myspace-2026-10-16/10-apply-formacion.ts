// Aplica el AÑO DE FORMACIÓN minado de los perfiles MySpace (formed_year) a fichas sin año.
// Ledger: {artistId, artist, field, value, url, evidence}. Solo rellena vacíos; run
// reversible con journal de campos + claim de la fuente myspace-wayback-machine.
// Uso: tsx scripts/myspace-2026-10-16/10-apply-formacion.ts [ledger.jsonl] [--confirm]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { withFieldJournal } from "../../src/merge/field-undo.js";
import { updateEntity, withOperatorRun } from "../../src/merge/operator.js";

interface Row { artistId: number; artist: string; field: string; value: number | string; url: string; evidence: string; }

const args = process.argv.slice(2);
const LEDGER = args.find((v) => !v.startsWith("--")) ?? "reports/myspace-2026-10-16/mineria/formacion.jsonl";
const confirm = args.includes("--confirm");
const EXTRACTOR = "perfil-myspace-wayback";
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function main(): Promise<void> {
  const rows = readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
  const pool = getPool();
  const source = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='myspace-wayback-machine'");
  const sourceId = Number(source.rows[0]?.id);
  if (!sourceId) throw new Error("fuente myspace-wayback-machine no existe");

  const aplicables: Row[] = [];
  for (const row of rows) {
    const { rows: cur } = await pool.query<{ formed_year: number | null }>("SELECT formed_year FROM public.artists WHERE id=$1", [row.artistId]);
    if (cur[0] && (cur[0].formed_year === null || cur[0].formed_year === undefined)) aplicables.push(row);
  }
  console.log(`formación: ${rows.length} filas · huecos reales: ${aplicables.length}`);
  for (const r of aplicables) console.log(`  artist ${r.artistId} (${r.artist}): ${r.value} · ${r.evidence.slice(0, 60)}`);
  if (!confirm) {
    console.log("dry-run (ejecuta con --confirm)");
    await closeDb();
    return;
  }

  const errores: unknown[] = [];
  const { runId, result } = await withOperatorRun({
    name: "hermes:myspace-formacion",
    operator: "hermes-curaduria (delegado por Brian)",
    note: "Año de formación citado en el perfil MySpace (Wayback), solo fichas sin año.",
  }, async (context) => {
    let aplicados = 0;
    for (const row of aplicables) {
      await context.client.query("SAVEPOINT f");
      try {
        const { rows: locked } = await context.client.query<{ formed_year: number | null }>(
          "SELECT formed_year FROM public.artists WHERE id=$1 FOR UPDATE", [row.artistId]);
        if (!locked[0] || locked[0].formed_year !== null) { await context.client.query("RELEASE SAVEPOINT f"); continue; }
        await withFieldJournal(context, { kind: "artist", id: row.artistId, fields: ["formed_year"] }, async () => {
          await updateEntity(context, "artist", row.artistId, { formed_year: row.value });
        });
        const claim = await context.client.query<{ id: string }>(`
          INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,normalized_value,raw_hash,extractor,
                                    extractor_version,confidence,status,created_by,run_id,notes,identity_key)
          VALUES($1,'artist',$2,'formed_year',to_jsonb($3::int),to_jsonb($3::int),$4,$5,'1','medium','accepted','human',$6,$7,$8)
          ON CONFLICT DO NOTHING RETURNING id::text`,
        [sourceId, row.artistId, Number(row.value), sha([EXTRACTOR, row.artistId, "formed_year", row.value]),
          EXTRACTOR, context.runId, row.evidence.slice(0, 400), `myspace:formed_year:artist:${row.artistId}`]);
        if (claim.rows[0]?.id && row.url) {
          await context.client.query(
            "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
            [claim.rows[0].id, row.url, row.evidence.slice(0, 400), sha([row.url, row.evidence])]);
        }
        aplicados += 1;
        await context.client.query("RELEASE SAVEPOINT f");
      } catch (error) {
        await context.client.query("ROLLBACK TO SAVEPOINT f");
        errores.push({ artistId: row.artistId, error: (error as Error).message.slice(0, 180) });
      }
    }
    return aplicados;
  });
  writeFileSync("reports/myspace-2026-10-16/apply-formacion.json", JSON.stringify({ runId, aplicados: result, errores }, null, 2));
  console.log(`TOTAL: run ${runId}, ${result} años aplicados, errores ${errores.length}`);
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exit(1); });
