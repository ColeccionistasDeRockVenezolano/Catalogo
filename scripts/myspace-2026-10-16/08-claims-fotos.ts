// CRV · Abre los CLAIMS DE FOTO de la campaña MySpace: un claim de evidencia por artista
// con la foto que el perfil mostraba (field picture_url), con la URL del snapshot y —cuando
// la copia local está verificada— el archivo, bytes y sha256. NO toca el core (la ficha ya
// tiene su picture_url): deja la procedencia en el expediente del artista.
// Runs reversibles por lotes; savepoint por claim.
// Uso: tsx scripts/myspace-2026-10-16/08-claims-fotos.ts [ledger.jsonl] [--confirm] [--batch=200]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

interface Row {
  artistId: number; banda: string; fotoUrl: string; snapshotUrl: string; anio: string;
  plantilla: string | null; archivo: string; bytes: string; sha256: string; waybackDescarga: string;
}

const args = process.argv.slice(2);
const argVal = (name: string) => args.find((v) => v.startsWith(`--${name}=`))?.split("=")[1];
const LEDGER = args.find((v) => !v.startsWith("--")) ?? "reports/myspace-2026-10-16/claims-fotos.jsonl";
const confirm = args.includes("--confirm");
const BATCH = Number(argVal("batch") ?? 200);
const EXTRACTOR = "perfil-myspace-wayback";
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function main(): Promise<void> {
  const rows = readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
  const pool = getPool();
  const source = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='myspace-wayback-machine'");
  const sourceId = Number(source.rows[0]?.id);
  if (!sourceId) throw new Error("fuente myspace-wayback-machine no existe");

  const conCopia = rows.filter((r) => r.archivo).length;
  const report = { claims: 0, yaEstaban: 0, errores: [] as unknown[] };
  console.log(`claims de foto: ${rows.length} (con copia local: ${conCopia})`);
  if (!confirm) {
    for (const row of rows.slice(0, 6)) {
      console.log(`  ${row.banda.slice(0, 24).padEnd(24)} ${row.anio} ${row.archivo ? `· ${row.archivo.split("/").pop()} (${row.bytes} B)` : "· sin copia local"}`);
    }
    console.log("dry-run (ejecuta con --confirm)");
    await closeDb();
    return;
  }

  const runs: number[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { runId, result } = await withOperatorRun({
      name: `hermes:myspace-claims-fotos (${i + 1}-${i + slice.length}/${rows.length})`,
      operator: "hermes-curaduria (delegado por Brian)",
      note: "Claims de evidencia de la foto de perfil de MySpace (Wayback). No modifica el core: documenta la procedencia para el expediente del artista.",
    }, async (context) => {
      let creados = 0;
      for (const row of slice) {
        await context.client.query("SAVEPOINT f_claim");
        try {
          const nota = `Foto del perfil MySpace (${row.anio || "s/f"}): ${row.fotoUrl}` +
            (row.archivo ? ` · copia local verificada ${row.archivo} (${row.bytes} B, sha256 ${row.sha256.slice(0, 16)}…)` : " · sin copia local");
          const claim = await context.client.query<{ id: string }>(`
            INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,normalized_value,raw_hash,extractor,
                                      extractor_version,confidence,status,created_by,run_id,notes,identity_key)
            VALUES($1,'artist',$2,'picture_url',to_jsonb($3::text),to_jsonb($3::text),$4,$5,'1','medium','accepted','human',$6,$7,$8)
            ON CONFLICT DO NOTHING RETURNING id::text`,
          [sourceId, row.artistId, row.fotoUrl, sha([EXTRACTOR, row.artistId, "picture_url", row.fotoUrl]),
            EXTRACTOR, context.runId, nota, `myspace:photo:artist:${row.artistId}`]);
          if (claim.rows[0]?.id) {
            creados += 1;
            report.claims += 1;
            await context.client.query(
              "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
              [claim.rows[0].id, row.snapshotUrl || row.waybackDescarga || row.fotoUrl, nota.slice(0, 500),
                sha([row.snapshotUrl, row.fotoUrl])]);
          } else {
            report.yaEstaban += 1;
          }
          await context.client.query("RELEASE SAVEPOINT f_claim");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT f_claim");
          await context.client.query("RELEASE SAVEPOINT f_claim");
          report.errores.push({ artistId: row.artistId, error: (error as Error).message.slice(0, 180) });
        }
      }
      return creados;
    });
    runs.push(runId);
    console.log(`lote ${i + 1}-${i + slice.length}: run ${runId}, ${result} claims | acumulado: claims=${report.claims} yaEstaban=${report.yaEstaban} err=${report.errores.length}`);
  }
  writeFileSync("reports/myspace-2026-10-16/claims-fotos.json", JSON.stringify({ runs, ...report }, null, 2));
  console.log(`TOTAL: claims=${report.claims} yaEstaban=${report.yaEstaban} errores=${report.errores.length}`);
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exit(1); });
