// Aplicación al catálogo de los MIEMBROS EXTRA cosechados de los perfiles MySpace (Wayback).
// Solo filas cuyo nombre ya resuelve a una persona existente del catálogo (personId en el
// ledger): esta fase NO crea personas — añade la relación de membresía que faltaba, con su
// claim de la fuente `myspace` (URL del snapshot + evidencia). Runs reversibles por lotes,
// savepoint por relación (el operator deduplica por (banda, persona, rol)).
// Uso: tsx scripts/myspace-2026-10-16/02-apply-miembros-extra.ts [ledger.jsonl] [--confirm] [--batch=100]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { OperatorError, createRelation, withOperatorRun } from "../../src/merge/operator.js";

interface Row {
  artistId: number; personId: number; banda: string; person: string;
  role: string; url: string; evidencia: string;
}

const args = process.argv.slice(2);
const argVal = (name: string) => args.find((v) => v.startsWith(`--${name}=`))?.split("=")[1];
const LEDGER = args.find((v) => !v.startsWith("--")) ?? "reports/myspace-2026-10-16/plan/miembros-extra.jsonl";
const confirm = args.includes("--confirm");
const BATCH = Number(argVal("batch") ?? 100);
const EXTRACTOR = "perfil-myspace-wayback";
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function main(): Promise<void> {
  const rows = readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => Number.isInteger(r.personId) && r.personId > 0);
  const pool = getPool();
  const source = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='myspace-wayback-machine'");
  const sourceId = Number(source.rows[0]?.id);
  if (!sourceId) throw new Error("fuente myspace-wayback-machine no existe: crearla con sources:add primero");

  const report = { creadas: 0, yaEstaban: 0, review: [] as unknown[], saltadas: [] as unknown[], errores: [] as unknown[] };
  console.log(`membresías extra MySpace: ${rows.length} filas con persona resuelta`);
  if (!confirm) {
    for (const row of rows.slice(0, 8)) {
      console.log(`  ${row.banda.slice(0, 26).padEnd(26)} ← ${row.person} (person ${row.personId}) · ${row.role}`);
    }
    console.log("dry-run (ejecuta con --confirm)");
    await closeDb();
    return;
  }

  const runs: number[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { runId, result } = await withOperatorRun({
      name: `hermes:myspace-miembros-extra (${i + 1}-${i + slice.length}/${rows.length})`,
      operator: "hermes-curaduria (delegado por Brian)",
      note: "Membresías que los perfiles MySpace clásicos (Wayback) listan y el catálogo no tenía; solo relaciones de personas ya existentes.",
    }, async (context) => {
      let creadas = 0;
      for (const row of slice) {
        await context.client.query("SAVEPOINT my_rel");
        try {
          const res = await createRelation(context, "artist_membership",
            { artistId: row.artistId, personId: row.personId }, { role: row.role });
          if (res.created) {
            creadas += 1;
            report.creadas += 1;
            const claim = await context.client.query<{ id: string }>(`
              INSERT INTO ingest.claims(source_id,entity_kind,artist_membership_id,field,raw_value,normalized_value,raw_hash,extractor,
                                        extractor_version,confidence,status,created_by,run_id,notes,identity_key)
              VALUES($1,'artist_membership',$2,'role',$3::jsonb,$3::jsonb,$4,$5,'1','medium','accepted','human',$6,$7,$8)
              ON CONFLICT DO NOTHING RETURNING id::text`,
            [sourceId, res.id, JSON.stringify(row.role),
              sha([EXTRACTOR, row.artistId, row.personId, row.role, row.url]), EXTRACTOR, context.runId,
              `Miembro listado en el perfil MySpace de la banda (${row.banda}): ${row.person} — ${row.role}`,
              `myspace:membership:${row.artistId}:${row.personId}:${row.role.toLowerCase().replace(/\s+/g, "-")}`]);
            if (claim.rows[0]?.id) {
              await context.client.query(
                "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
                [claim.rows[0].id, row.url, row.evidencia.slice(0, 500), sha([row.url, row.evidencia])]);
            }
          } else {
            report.yaEstaban += 1;
          }
          await context.client.query("RELEASE SAVEPOINT my_rel");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT my_rel");
          await context.client.query("RELEASE SAVEPOINT my_rel");
          if (error instanceof OperatorError && (error.code === "needs_review" || error.code === "invalid")) {
            report.review.push({ banda: row.banda, person: row.person, role: row.role, detail: error.message.slice(0, 180) });
          } else {
            report.errores.push({ banda: row.banda, person: row.person, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) });
          }
        }
      }
      return creadas;
    });
    runs.push(runId);
    console.log(`lote ${i + 1}-${i + slice.length}: run ${runId}, ${result} creadas | acumulado: creadas=${report.creadas} yaEstaban=${report.yaEstaban} review=${report.review.length} err=${report.errores.length}`);
    writeFileSync("reports/myspace-2026-10-16/apply-miembros-extra.partial.json",
      JSON.stringify({ runs, ...report }, null, 2));
  }
  writeFileSync("reports/myspace-2026-10-16/apply-miembros-extra.json", JSON.stringify({ runs, ...report }, null, 2));
  console.log(`TOTAL: creadas=${report.creadas} yaEstaban=${report.yaEstaban} review=${report.review.length} errores=${report.errores.length}`);
  await closeDb();
}

main().catch((error) => { console.error(error); process.exit(1); });
