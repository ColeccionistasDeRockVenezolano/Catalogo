// CRV · Añade los géneros que la banda declaraba en su perfil MySpace (Wayback) y la ficha
// NO tiene (regla de Brian 2026-09-26: si una fuente dice el género y la ficha no lo tiene,
// entra directo; sin umbral, sin revisión ficha a ficha).
//
// - Ficha con principal confirmado: los faltantes entran como SECUNDARIOS.
// - Ficha sin principal: el primer género declarado pasa a principal y el resto secundarios.
// - Los términos ya presentes no se tocan; cada decisión deja fila en genre_assignment_log
//   (actor auto:myspace-wayback) y todo va en un run reversible.
// Uso: tsx scripts/myspace-2026-10-16/06-apply-generos-epoca.ts [ledger.jsonl] [--confirm]
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { confirmGenre } from "../../src/genres/human.js";
import { GENRE_COLUMN, GENRE_TABLE, loadTaxonomy, lockGenres } from "../../src/genres/store.js";
import { rawValues, readLedger, sourceSlugs } from "../genre-source-rows.js";

const args = process.argv.slice(2);
const LEDGER = args.find((v) => !v.startsWith("--")) ?? "reports/genre-laya-evidence-myspace-wayback-2026-10-16.jsonl";
const confirm = args.includes("--confirm");
const ACTOR = "auto:myspace-wayback";

async function main(): Promise<number> {
  const rows = readLedger(LEDGER);
  const client = await getPool().connect();
  const report = {
    mode: confirm ? "confirm" : "dry-run", runId: 0, candidates: rows.length,
    fichasTocadas: [] as Array<{ caseId: string; title?: string; agregados: string[]; principales: string[] }>,
    yaLosTenia: [] as string[],
    conflictos: [] as Array<{ caseId: string; slug: string; detalle: string }>,
    sinTermino: [] as Array<{ caseId: string; fragmentos: string[] }>,
    errores: [] as Array<{ caseId: string; error: string }>,
  };
  try {
    await client.query("BEGIN");
    await lockGenres(client);
    const taxonomy = await loadTaxonomy(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO ingest.scrape_runs(kind, status, params) VALUES('merge_run','running',$1::jsonb) RETURNING id::text`,
      [JSON.stringify({ action: "genres_myspace_epoca", ledger: LEDGER, confirm })]);
    report.runId = Number(run.rows[0]!.id);

    for (const row of rows) {
      const { slugs, fragments } = sourceSlugs(taxonomy, row);
      if (fragments.length) report.sinTermino.push({ caseId: row.caseId, fragmentos: fragments });
      if (!slugs.length) continue;
      const presentes = (await client.query<{ slug: string; role: string }>(
        `SELECT g.slug, t.role FROM ${GENRE_TABLE[row.kind]} t JOIN ingest.genres g ON g.id=t.genre_id
          WHERE t.${GENRE_COLUMN[row.kind]}=$1 AND t.status IN ('confirmed','suggested')`,
        [row.entityId])).rows;
      const setPresentes = new Set(presentes.map((p) => p.slug));
      const tienePrincipal = presentes.some((p) => p.role === "primary");
      const faltantes = slugs.filter((slug) => !setPresentes.has(slug));
      if (!faltantes.length) { report.yaLosTenia.push(row.caseId); continue; }

      const agregados: string[] = [];
      const principales: string[] = [];
      const raw = rawValues(row).join(" | ");
      for (const [i, slug] of faltantes.entries()) {
        const role: "primary" | "secondary" = !tienePrincipal && i === 0 ? "primary" : "secondary";
        await client.query("SAVEPOINT genero");
        try {
          await confirmGenre(client, {
            kind: row.kind, entityId: row.entityId, genreSlug: slug, role,
            actor: ACTOR, runId: report.runId,
            reason: `La banda declara el género en su perfil de MySpace (Wayback): nombra «${raw}» en ${row.url}`,
          });
          await client.query("RELEASE SAVEPOINT genero");
          agregados.push(slug);
          if (role === "primary") principales.push(slug);
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT genero");
          const detalle = (error as Error).message.slice(0, 160);
          if (/por encima de un género|conflict/iu.test(detalle)) report.conflictos.push({ caseId: row.caseId, slug, detalle });
          else report.errores.push({ caseId: row.caseId, error: detalle });
        }
      }
      if (agregados.length) report.fichasTocadas.push({ caseId: row.caseId, ...(row.title === undefined ? {} : { title: row.title }), agregados, principales });
    }

    await client.query(`UPDATE ingest.scrape_runs SET status=$2::ingest.run_status, finished_at=now() WHERE id=$1`,
      [report.runId, report.errores.length ? "partial" : "ok"]);
    await client.query(confirm ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const out = `reports/myspace-2026-10-16/generos-epoca-${report.mode}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  writeFileSync(out.replace(/\.json$/u, `-run-${report.runId}.json`), JSON.stringify(report, null, 2));
  console.log(`géneros de época MySpace (${report.mode}, run ${report.runId}): ${report.candidates} fichas`);
  console.log(`  tocadas: ${report.fichasTocadas.length} · términos agregados: ${report.fichasTocadas.reduce((n, f) => n + f.agregados.length, 0)}`);
  console.log(`  ya los tenían: ${report.yaLosTenia.length} · conflictos familia/hijo: ${report.conflictos.length} · sin término: ${report.sinTermino.length} · errores: ${report.errores.length}`);
  for (const f of report.fichasTocadas.slice(0, 10)) console.log(`   ${f.caseId} ${f.title ?? ""}: +${f.agregados.join(", +")}`);
  console.log(`  detalle: ${out}`);
  await closeDb();
  return 0;
}

main().then((code) => process.exit(code), async (error) => { console.error(error); await closeDb(); process.exit(1); });
