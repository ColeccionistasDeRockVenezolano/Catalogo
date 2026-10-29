// Auditoría de Shared 2026-10-25 · géneros de fichas que no tenían ninguno.
//
// Mismo camino que scripts/apply-source-genres.ts («una fuente basta»: el primer género nombrado es el
// principal), pero con un solo libro verificado y el informe en la campaña de staging, sin pisar los
// informes de reports/. Las etiquetas sin término en la taxonomía quedan fuera y se informan.
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/shared-auditoria-2026-10-25/generos.mts \
//     --dir=$HOME/crv-staging/reports/shared-auditoria-aplicacion-2026-10-25 [--confirm]
import { writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { GENRE_COLUMN, GENRE_TABLE, loadTaxonomy, lockGenres } from "../../src/genres/store.js";
import { applySourceRow, readLedger } from "../genre-source-rows.js";

const args = process.argv.slice(2);
const dir = args.find((v) => v.startsWith("--dir="))?.slice("--dir=".length);
const confirm = args.includes("--confirm");
if (!dir) throw new Error("--dir=… obligatorio");

async function main(): Promise<void> {
  const rows = readLedger(path.join(dir!, "ledger-generos.jsonl"));
  const client = await getPool().connect();
  const report = { mode: confirm ? "aplicado" : "ensayo (revertido)", runId: 0, candidates: rows.length,
    accepted: [] as unknown[], alreadyClassified: [] as string[], unresolved: [] as unknown[],
    moreSpecificExists: [] as string[], errors: [] as unknown[] };
  try {
    await client.query("BEGIN");
    await lockGenres(client);
    const taxonomy = await loadTaxonomy(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO ingest.scrape_runs(kind, status, params) VALUES('merge_run','running',$1::jsonb) RETURNING id::text`,
      [JSON.stringify({ action: "genres_source_accept", operator: "claude-code (encargo de Brian)",
        note: "Auditoría de Shared 2026-10-25: géneros que la fuente nombra para fichas sin ninguno.", ledger: "ledger-generos.jsonl", confirm })]);
    report.runId = Number(run.rows[0]!.id);
    for (const row of rows) {
      const has = await client.query(
        `SELECT 1 FROM ${GENRE_TABLE[row.kind]} WHERE ${GENRE_COLUMN[row.kind]}=$1 AND role='primary' AND status='confirmed'`, [row.entityId]);
      if (has.rowCount) { report.alreadyClassified.push(row.caseId); continue; }
      await client.query("SAVEPOINT ficha");
      try {
        // «Latin-World», «Latin-Aguinaldo-Gaita»: «Latin» es el estante de Sincopa; el libro fija el principal.
        const primary = (row as { primary?: string }).primary;
        const outcome = await applySourceRow(client, taxonomy, row, report.runId, undefined, primary);
        await client.query("RELEASE SAVEPOINT ficha");
        if (outcome.kind === "unresolved") report.unresolved.push({ caseId: row.caseId, title: row.title, raw: outcome.raw, fragments: outcome.fragments });
        else if (outcome.kind === "moreSpecificExists") report.moreSpecificExists.push(row.caseId);
        else report.accepted.push({ caseId: row.caseId, title: row.title, source: row.source, raw: outcome.raw, primary: outcome.primary, secondaries: outcome.secondaries });
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT ficha");
        report.errors.push({ caseId: row.caseId, error: (error as Error).message });
      }
    }
    await client.query(`UPDATE ingest.scrape_runs SET status=$2::ingest.run_status, finished_at=now() WHERE id=$1`,
      [report.runId, report.errors.length ? "partial" : "ok"]);
    await client.query(confirm ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const out = path.join(dir!, `aplicacion-generos-${confirm ? `run${report.runId}` : "ensayo"}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ mode: report.mode, runId: report.runId, accepted: report.accepted.length,
    alreadyClassified: report.alreadyClassified.length, unresolved: report.unresolved.length,
    moreSpecificExists: report.moreSpecificExists.length, errors: report.errors.length, out }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
