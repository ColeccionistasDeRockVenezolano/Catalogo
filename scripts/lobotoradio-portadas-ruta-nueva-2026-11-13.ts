// Lobotoradio reorganizó las carpetas de sus portadas (2026-11): el archivo es
// el mismo, pero `images/discos/<letra>/<banda>/<año-disco>/<archivo>` pasó a
// `images/discos/<centena>/<id>/<archivo>` y las direcciones viejas dan 404, así
// que las portadas candidatas no se veían en Curaduría (aviso de Brian, 2026-11-13).
// Se lee la página del disco (`page_url`) y se toma su og:image solo si es el
// MISMO archivo (mismo nombre) y responde como imagen. Si Lobotoradio subió
// después otra portada para ese disco (`…_front_…`), la candidata pasa a esa
// portada nueva —sigue pendiente de que una persona la mire—; el logo genérico
// del sitio no cuenta como portada. Un run reversible.
// Uso: ./scripts/with-node22.sh npx tsx scripts/lobotoradio-portadas-ruta-nueva-2026-11-13.ts [--confirm] [--report archivo.json]
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");
const REPORT = process.argv[process.argv.indexOf("--report") + 1];
const OLD = /lobotoradio\.com\/wp-content\/plugins\/album-collection\/images\/discos\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/u;
const HEADERS = { "user-agent": "Mozilla/5.0 (CRV catálogo; corrección de enlaces de imagen)" };
const basename = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");

async function newAddress(oldUrl: string, pageUrl: string): Promise<{ url: string; replaced: boolean } | { error: string }> {
  const page = await fetch(pageUrl, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!page.ok) return { error: `página HTTP ${page.status}` };
  const html = await page.text();
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/iu)?.[1];
  const same = [og, ...Array.from(html.matchAll(/https:\/\/www\.lobotoradio\.com\/wp-content\/plugins\/album-collection\/images\/discos\/[^"'\s)]+/gu), m => m[0])]
    .filter((url): url is string => Boolean(url)).find(url => basename(url) === basename(oldUrl));
  const replacement = og && /\/images\/discos\/\d{4}-\d{4}\/\d+\//u.test(og) ? og : undefined;
  const found = same ?? replacement;
  if (!found) return { error: og ? `la página no muestra una portada (${basename(og)})` : "la página no tiene portada" };
  const image = await fetch(found, { method: "HEAD", headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!image.ok || !(image.headers.get("content-type") ?? "").startsWith("image/")) return { error: `la dirección nueva no responde como imagen (HTTP ${image.status})` };
  return { url: found, replaced: !same };
}

async function main(): Promise<void> {
  const rows = (await getPool().query<{ candidate_url: string; page_url: string }>(`
    SELECT DISTINCT ON (candidate_url) candidate_url, page_url FROM ingest.image_candidates
     WHERE candidate_url ILIKE '%lobotoradio.com%' AND page_url IS NOT NULL ORDER BY candidate_url, id`)).rows
    .filter(row => OLD.test(row.candidate_url));
  const mapping = new Map<string, string>(); const replaced = new Set<string>(); const failures: Array<{ url: string; page: string; error: string }> = [];
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++]!;
      try {
        const result = await newAddress(row.candidate_url, row.page_url);
        if ("url" in result) { mapping.set(row.candidate_url, result.url); if (result.replaced) replaced.add(row.candidate_url); } else failures.push({ url: row.candidate_url, page: row.page_url, error: result.error });
      } catch (error) { failures.push({ url: row.candidate_url, page: row.page_url, error: error instanceof Error ? error.message : String(error) }); }
    }
  }
  await Promise.all([worker(), worker()]);
  if (REPORT) writeFileSync(REPORT, JSON.stringify({ mapping: Object.fromEntries(mapping), replaced: [...replaced], failures }, null, 1));
  console.log(`${rows.length} direcciones viejas · ${mapping.size - replaced.size} mismo archivo en su ruta nueva · ${replaced.size} con una portada nueva subida por Lobotoradio · ${failures.length} sin resolver`);
  for (const failure of failures.slice(0, 15)) console.log(`  ✗ ${failure.page}: ${failure.error}`);
  if (!CONFIRM) { console.log("vista previa: repite con --confirm para aplicar"); await closeDb(); return; }
  const { runId, result } = await withOperatorRun({
    name: "lobotoradio-portadas-ruta-nueva", operator: "Claude Code (encargo de Brian 2026-11-13)",
    note: "Lobotoradio cambió la ruta de sus portadas: las candidatas apuntan al mismo archivo en su dirección nueva.",
    params: { resolved: mapping.size, replaced: replaced.size, unresolved: failures.length },
  }, async ({ client }) => {
    let candidates = 0, duplicates = 0;
    for (const [oldUrl, newUrl] of mapping) {
      // Si la ficha ya tiene esa misma imagen con la dirección nueva, la vieja sobra: queda descartada.
      const dup = await client.query(`UPDATE ingest.image_candidates o SET status='rejected', decided_by='Claude Code', decided_at=now()
        WHERE o.candidate_url=$1 AND o.status='open' AND EXISTS (SELECT 1 FROM ingest.image_candidates n WHERE n.candidate_url=$2
          AND n.entity_kind=o.entity_kind AND n.album_id IS NOT DISTINCT FROM o.album_id AND n.artist_id IS NOT DISTINCT FROM o.artist_id)`, [oldUrl, newUrl]);
      duplicates += dup.rowCount ?? 0;
      const moved = await client.query(`UPDATE ingest.image_candidates o SET candidate_url=$2,
          image_context = CASE WHEN $3 THEN concat_ws(' · ', image_context, 'Portada actual de Lobotoradio: sustituye a la que tenía antes (ya no existe)') ELSE image_context END
        WHERE o.candidate_url=$1 AND NOT EXISTS (SELECT 1 FROM ingest.image_candidates n WHERE n.candidate_url=$2
          AND n.entity_kind=o.entity_kind AND n.album_id IS NOT DISTINCT FROM o.album_id AND n.artist_id IS NOT DISTINCT FROM o.artist_id)`, [oldUrl, newUrl, replaced.has(oldUrl)]);
      candidates += moved.rowCount ?? 0;
      await client.query("UPDATE media.artist_gallery SET image_url=$2, updated_at=now() WHERE image_url=$1", [oldUrl, newUrl]);
    }
    return { candidates, duplicates };
  });
  console.log(`run ${runId}: ${result.candidates} candidatas con dirección nueva; ${result.duplicates} duplicadas descartadas`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
