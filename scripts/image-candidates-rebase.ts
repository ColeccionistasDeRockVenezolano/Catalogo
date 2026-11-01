// Pone al día la referencia de las candidatas abiertas: `current_url` pasa a ser
// la imagen que la ficha tiene ahora. Sin esto, un cambio ajeno a la elección
// (la portada remota pasó a copia local) bloquea «Usar esta» en Curaduría.
// No cambia ninguna imagen de ficha ni decide candidatas.
//
//   tsx scripts/image-candidates-rebase.ts --receipt <archivo.jsonl> [--apply]
import { writeFile } from "node:fs/promises";
import { config as loadDotenv } from "dotenv";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

loadDotenv();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const receipt = args[args.indexOf("--receipt") + 1];
if (!args.includes("--receipt") || !receipt) throw new Error("falta --receipt <archivo.jsonl>");

const STALE = `
  FROM ingest.image_candidates c
  LEFT JOIN public.albums al ON c.entity_kind = 'album' AND al.id = c.album_id
  LEFT JOIN public.artists ar ON c.entity_kind = 'artist' AND ar.id = c.artist_id
 WHERE c.status = 'open'
   AND COALESCE(al.id, ar.id) IS NOT NULL
   AND c.current_url IS DISTINCT FROM COALESCE(al.cover_url, ar.picture_url)`;

interface Row { id: string; entity_kind: string; entity_id: string; before_url: string | null; live_url: string | null }
const { rows } = await getPool().query<Row>(`
  SELECT c.id::text, c.entity_kind, COALESCE(c.album_id, c.artist_id)::text AS entity_id, c.current_url AS before_url,
         COALESCE(al.cover_url, ar.picture_url) AS live_url ${STALE} ORDER BY c.id`);
await writeFile(receipt, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
const fichas = new Set(rows.map(row => `${row.entity_kind}:${row.entity_id}`)).size;
console.log(`${rows.length} candidatas en ${fichas} fichas; recibo: ${receipt}`);

if (apply && rows.length) {
  const { runId, result } = await withOperatorRun({
    name: "image_candidates_rebase", operator: "image-candidates-rebase",
    note: "Curaduría: las candidatas abiertas toman como referencia la imagen actual de su ficha; ninguna imagen cambia",
    params: { candidates: rows.length, fichas, receipt },
  }, async context => {
    const updated = await context.client.query(`
      UPDATE ingest.image_candidates t SET current_url = s.live_url
        FROM (SELECT c.id, COALESCE(al.cover_url, ar.picture_url) AS live_url ${STALE}) s
       WHERE t.id = s.id`);
    return updated.rowCount ?? 0;
  });
  console.log(`run ${runId}: ${result} candidatas actualizadas`);
}
await closeDb();
