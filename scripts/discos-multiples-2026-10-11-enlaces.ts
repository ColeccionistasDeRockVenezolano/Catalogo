// CRV · Discos múltiples: enlaces de escucha de los discos juntados (2026-10-11).
//
// El run 18980 juntó volúmenes y lados en una ficha. `streaming_links` admite
// un enlace por plataforma y álbum, así que mergeInto descartó el del que
// desaparecía cuando chocaba con otro distinto: el «Vol. 2» perdió su álbum en
// Spotify/Deezer/Apple Music. Las filas quedaron en la auditoría de la fusión
// (merge_audit.new_value.discardedRows); aquí vuelven como enlaces de SU disco
// (`public.album_disc_links`, 0063), en el disco donde el reporte del run dice
// que quedó («suma X … como disco N»).
//
// Caso aparte: «La Música de Un Solo Pueblo Vol. 1» (9071) tenía los enlaces
// del Vol. 2 (los mismos que 9073); los buenos eran los de 14940, la ficha
// repetida del Vol. 1 que se le fundió. Se cambian.
//
// Las fusiones de duplicados (misma lista) con otra edición en la plataforma
// no se tocan: su enlace queda en la auditoría, como siempre.
//
//   ./scripts/with-node22.sh npx tsx scripts/discos-multiples-2026-10-11-enlaces.ts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const MERGE_RUN = 18980;
const DIR = "reports/discos-multiples-2026-10-11";
const confirm = process.argv.includes("--confirm");
const NOTE = `Discos múltiples 2026-10-11: el enlace de escucha del disco juntado vuelve como enlace de su disco (run ${MERGE_RUN})`;

// «suma 3708 «Live in Paris - Lado B» (15 pistas) en 3584 «…» como disco 2»
const report = readFileSync(`${DIR}/aplicado.md`, "utf8");
const appended = new Map<number, number>();
for (const match of report.matchAll(/ {2}suma (\d+) «.*?» \(\d+ pistas\) en \d+ «.*?» como disco (\d+)/gu)) {
  appended.set(Number(match[1]), Number(match[2]));
}
// 13997 es el Vol. 2 de una ficha partida en dos que se fundió en las
// posiciones del disco 2 de 321 (Sentimiento Muerto) tras `move_disc`.
appended.set(13997, 2);
const SWAP = { keep: 9071, drop: 14940 };

interface Discarded { drop: number; keep: number; row: Record<string, unknown> }
const lines: string[] = [];
let restored = 0, skipped = 0, swapped = 0;

const { runId } = await withOperatorRun({ name: "curation:album-disc-links", operator: "claude-code", note: NOTE, params: { mergeRun: MERGE_RUN } }, async ({ client }) => {
  const rows = (await client.query<{ drop: string; keep: string; row: Record<string, unknown> }>(`
    SELECT ma.old_value->>'id' AS drop, r.to_id::text AS keep, d->'row' AS row
      FROM ingest.merge_audit ma
      CROSS JOIN LATERAL jsonb_array_elements(ma.new_value->'discardedRows') d
      JOIN ingest.entity_redirects r ON r.entity_kind='album' AND r.from_id=(ma.old_value->>'id')::bigint
     WHERE ma.run_id=$1 AND ma.field='merged_duplicate' AND d->>'table'='public.streaming_links'
     ORDER BY 2, 1`, [MERGE_RUN])).rows.map((r): Discarded => ({ drop: Number(r.drop), keep: Number(r.keep), row: r.row }));

  for (const { drop, keep, row } of rows) {
    const platform = String(row["platform"]);
    const url = String(row["url"]);
    const current = (await client.query<{ url: string }>(
      "SELECT url FROM public.streaming_links WHERE album_id=$1 AND platform=$2", [keep, platform])).rows[0]?.url;
    if (drop === SWAP.drop && keep === SWAP.keep) {
      await client.query(`
        UPDATE public.streaming_links SET url=$3, external_id=$4, method=$5, source=$6, verified=$7, notes=concat_ws(' · ', $8::text, $9::text)
         WHERE album_id=$1 AND platform=$2`,
      [keep, platform, url, row["external_id"], row["method"], row["source"], row["verified"], row["notes"], `${NOTE}; antes apuntaba al Vol. 2 (${current})`]);
      lines.push(`- ${keep} ${platform}: ${current} → ${url} (era el enlace del Vol. 2)`);
      swapped += 1;
      continue;
    }
    const disc = appended.get(drop);
    if (current === url || disc === undefined) { skipped += 1; continue; }
    const exists = await client.query(`
      SELECT 1 FROM public.tracks WHERE album_id=$1 AND disc_number=$2
      UNION ALL SELECT 1 FROM public.album_discs WHERE album_id=$1 AND disc_number=$2 LIMIT 1`, [keep, disc]);
    if (!exists.rowCount) throw new Error(`${keep} no tiene disco ${disc} (enlace de ${drop})`);
    const inserted = await client.query(`
      INSERT INTO public.album_disc_links(album_id,disc_number,platform,url,external_id,method,source,verified,notes,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,concat_ws(' · ', $9::text, $10::text),$11)
      ON CONFLICT (album_id,disc_number,platform) DO NOTHING`,
    [keep, disc, platform, url, row["external_id"], row["method"], row["source"], row["verified"], row["notes"], `${NOTE}; era de la ficha ${drop}`, row["created_at"]]);
    if (!inserted.rowCount) throw new Error(`${keep} disco ${disc} ya tiene enlace de ${platform}`);
    lines.push(`- ${keep} disco ${disc} · ${platform}${row["verified"] ? "" : " (sin verificar, no se muestra)"}: ${url} (de ${drop})`);
    restored += 1;
  }
}, { rollbackOnly: !confirm });

const head = `# Enlaces de los discos juntados — ${confirm ? `run ${runId}` : `ensayo (run ${runId} revertido)`}\n\n`
  + `${restored} enlaces vuelven como enlaces de su disco; ${swapped} de 9071 cambiados por los del Vol. 1; ${skipped} sin tocar (repetían la URL de la ficha que quedó, o eran otra edición de un duplicado y quedan en la auditoría).\n`;
writeFileSync(`${DIR}/enlaces-${confirm ? "aplicado" : "ensayo"}.md`, `${head}\n${lines.join("\n")}\n`);
console.log(head);
await closeDb();
