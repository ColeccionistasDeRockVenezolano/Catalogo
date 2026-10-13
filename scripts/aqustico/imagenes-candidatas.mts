// Plan Aqustico · candidatas de imagen (Curaduría · Imágenes) para TODAS las fotos de
// artistas y carátulas de discos cruzadas con CRV — tengan o no imagen ya (Brian, 2026-10-12).
//
// Lee reports/aqustico-2026-10/imagenes-completo.jsonl (lo prepara imagenes-completo.py
// --copiar: las imágenes quedan en web/public/media/<kind>/<id>-aq.<ext>, ruta ALTERNATIVA
// que nunca pisa el archivo de la imagen actual; candidate_url = /crv/media/<kind>/<id>-aq.<ext>,
// que la web ya sirve; la URL de origen remota queda en page_url y en el JSONL).
// Inserta en ingest.image_candidates con un run de operador; ON CONFLICT DO NOTHING
// respeta decisiones previas. Sin --confirm se deshace al final (dry-run).
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/aqustico/imagenes-candidatas.mts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

const DIR = "reports/aqustico-2026-10";
interface Row { kind: "album" | "artist"; id: number; sourceUrl: string; originUrl: string; label: string; source: string; pageUrl: string }

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const rows = readFileSync(`${DIR}/imagenes-completo.jsonl`, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Row);
  const results: Array<{ kind: string; id: number; label: string; outcome: string }> = [];
  let runId = 0;
  try {
    const out = await withOperatorRun({
      name: "aqustico:imagenes-candidatas",
      operator: "auto:aqustico",
      note: `Plan Aqustico: candidatas de imagen (comparar calidad) en ${rows.length} fichas cruzadas. Rutas locales /crv/media/<kind>/<id>-aq.*; origen en page_url y ${DIR}/imagenes-completo.jsonl.`,
      params: { file: `${DIR}/imagenes-completo.jsonl`, count: rows.length, confirm },
    }, async (context) => {
      for (const row of rows) {
        const table = row.kind === "album" ? "public.albums" : "public.artists";
        const field = row.kind === "album" ? "cover_url" : "picture_url";
        const column = row.kind === "album" ? "album_id" : "artist_id";
        const current = await context.client.query<{ url: string | null }>(`SELECT ${field} AS url FROM ${table} WHERE id=$1`, [row.id]);
        if (current.rows.length === 0) { results.push({ kind: row.kind, id: row.id, label: row.label.slice(0, 80), outcome: "sin_ficha" }); continue; }
        const currentUrl = current.rows[0]!.url;
        if (currentUrl === row.sourceUrl) { results.push({ kind: row.kind, id: row.id, label: row.label.slice(0, 80), outcome: "ya_aplicada" }); continue; }
        const inserted = await context.client.query(
          `INSERT INTO ingest.image_candidates(entity_kind, ${column}, current_url, candidate_url, source, page_url, origin, run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
          [row.kind, row.id, currentUrl, row.sourceUrl, row.source, row.pageUrl, "aqustico:imagenes-completo", context.runId]);
        results.push({ kind: row.kind, id: row.id, label: row.label.slice(0, 80), outcome: (inserted.rowCount ?? 0) > 0 ? "candidata" : "ya_existia" });
      }
      return results.length;
    }, { rollbackOnly: !confirm });
    runId = out.runId;
  } finally {
    const report = { mode: confirm ? "confirm" : "dry-run", runId, filas: rows.length,
      candidatas: results.filter((r) => r.outcome === "candidata").length,
      yaExistian: results.filter((r) => r.outcome === "ya_existia").length,
      yaAplicadas: results.filter((r) => r.outcome === "ya_aplicada").length,
      sinFicha: results.filter((r) => r.outcome === "sin_ficha").length,
      results };
    const file = `${DIR}/imagenes-completo-${report.mode}-run${runId}.json`;
    writeFileSync(file, JSON.stringify(report, null, 1));
    console.log(`candidatas de imagen (${report.mode}, run ${runId}): filas ${report.filas} · candidatas ${report.candidatas} · ya existían ${report.yaExistian} · ya aplicadas ${report.yaAplicadas} · sin ficha ${report.sinFicha} → ${file}`);
    await closeDb();
  }
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
