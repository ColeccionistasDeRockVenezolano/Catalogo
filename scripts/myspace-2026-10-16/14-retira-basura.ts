// Retira fichas de PERSONA basura creadas por el lote de altas MySpace (mal parseo de la
// minería: títulos de vídeo/discos y etiquetas tipo «PHOTOS BY», «Google search»).
// Orden del skill: membresías ANTES que la persona. Run reversible; savepoint por ficha.
// Uso: tsx scripts/myspace-2026-10-16/14-retira-basura.ts --confirm
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { deleteEntity, deleteRelation, withOperatorRun } from "../../src/merge/operator.js";

const NOMBRES = ["ESCLAVO DE LA ETERNIDAD", "REGRESO DEL ABISMO", "Editor de Imagenes", "Google search", "PHOTOS BY"];
const confirm = process.argv.includes("--confirm");

async function main(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; name: string }>(
    "SELECT id::text, name FROM public.persons WHERE name = ANY($1::text[])", [NOMBRES]);
  console.log(`fichas basura a retirar: ${rows.length}`);
  for (const r of rows) console.log(`  person ${r.id} · ${r.name}`);
  if (!rows.length) { await closeDb(); return; }
  if (!confirm) { console.log("dry-run (ejecuta con --confirm)"); await closeDb(); return; }

  const report: Array<{ personId: number; name: string; relaciones: number; ok: boolean; error?: string }> = [];
  const { runId } = await withOperatorRun({
    name: "hermes:myspace-retira-basura",
    operator: "hermes-curaduria (delegado por Brian)",
    note: "Retiro de fichas de persona creadas por error desde la minería de perfiles MySpace (títulos de vídeo/disco y etiquetas de plantilla).",
  }, async (context) => {
    let retiradas = 0;
    for (const r of rows) {
      const personId = Number(r.id);
      await context.client.query("SAVEPOINT basura");
      try {
        const rel = await context.client.query<{ id: string }>(
          "SELECT id::text FROM public.artist_members WHERE person_id=$1", [personId]);
        for (const m of rel.rows) {
          await deleteRelation(context, "artist_membership", Number(m.id));
        }
        await deleteEntity(context, "person", personId);
        await context.client.query("RELEASE SAVEPOINT basura");
        retiradas += 1;
        report.push({ personId, name: r.name, relaciones: rel.rows.length, ok: true });
        console.log(`  retirada: ${r.name} (${rel.rows.length} relaciones)`);
      } catch (error) {
        await context.client.query("ROLLBACK TO SAVEPOINT basura");
        report.push({ personId, name: r.name, relaciones: 0, ok: false, error: (error as Error).message.slice(0, 160) });
        console.log(`  ERROR ${r.name}: ${(error as Error).message.slice(0, 120)}`);
      }
    }
    return retiradas;
  });
  writeFileSync("reports/myspace-2026-10-16/retira-basura.json", JSON.stringify({ runId, report }, null, 2));
  console.log(`TOTAL: run ${runId}, ${report.filter((x) => x.ok).length}/${rows.length} retiradas`);
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exit(1); });
