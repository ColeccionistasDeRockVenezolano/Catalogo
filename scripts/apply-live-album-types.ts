// CRV · Regla «en vivo» sobre el catálogo (plan v2 del primo, etapa 2, punto 5).
//
// Un disco cuyo título dice que es en vivo (src/normalization/live-title.ts)
// pasa a `live_album`, con estas reglas:
//   * la hoja YT Master manda: si su clasificación da otro tipo, el disco no
//     cambia y va al informe («saltados por la hoja»);
//   * D2 (recomendación del plan): un sencillo, un EP, un demo o un compilado
//     en vivo conserva su tipo y lleva además la clasificación «En vivo»;
//     solo cambian de tipo los álbumes (`studio_album` y `other`);
//   * Music Video, Live Concert, Documentary y B-Sides no llevan tipo
//     (regla de scripts/apply-album-types.ts);
//   * las dudas de la regla (obras «Concierto de…», «Live» suelto, títulos
//     mixtos) no se tocan: van al informe.
//
// Cada cambio de tipo deja un claim de `crv-tipo-disco` (extractor
// `regla-en-vivo`) con la evidencia del título y su fila de merge_audit; las
// clasificaciones «En vivo» quedan en el diario. Todo en un run reversible.
//
// Uso: tsx scripts/apply-live-album-types.ts [--confirm]
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { liveTitleVerdict } from "../src/normalization/live-title.js";

const DATE = "2026-10-14";
const SOURCE_SLUG = "crv-tipo-disco";
const EXTRACTOR = "regla-en-vivo";
export const LIVE_CLASSIFICATION = "En vivo";
/** Vocabulario de la hoja (scripts/harvest-album-types.py). */
const SHEET: Readonly<Record<string, string>> = {
  "Studio Album": "studio_album", EP: "ep", "Compilation Album": "compilation", "Live Album": "live_album",
  Single: "single", Demos: "demo", Unplugged: "live_album", Remix: "remix",
};
const NO_TYPE = new Set(["Music Video", "Live Concert", "Documentary", "B-Sides"]);
/** Tipos que no son «álbum»: se quedan y llevan la clasificación (D2). */
const KEEP_TYPE = new Set(["single", "ep", "demo", "compilation", "remix", "soundtrack", "collaboration_album"]);
const ALBUM_TYPES = new Set(["studio_album", "other"]);

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface Row { id: string; title: string; album_type: string; artist: string | null; classes: string[] | null; youtube_url: string | null; wordpress_url: string | null }
interface Item { albumId: number; artist: string | null; title: string; albumType: string; marker: string | null; why?: string }

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const report = {
    mode: confirm ? "confirm" : "dry-run", runId: 0,
    changed: [] as Item[], classified: [] as Item[], alreadyLive: 0, alreadyClassified: 0,
    skippedSheet: [] as Item[], skippedNoType: [] as Item[], doubts: [] as Item[],
  };
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const sourceId = Number((await client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SOURCE_SLUG])).rows[0]!.id);
    // Abrir el run en esta transacción la liga al diario (crv_bind_run).
    const run = await client.query<{ id: string }>(
      `INSERT INTO ingest.scrape_runs(kind, status, params) VALUES('merge_run','running',$1::jsonb) RETURNING id::text`,
      [JSON.stringify({ action: "live_album_types", plan: "plan v2 del primo, etapa 2, punto 5", confirm })]);
    report.runId = Number(run.rows[0]!.id);
    const { rows } = await client.query<Row>(`
      SELECT a.id::text, a.title, a.album_type::text, r.name AS artist, a.youtube_url, a.wordpress_url,
             (SELECT array_agg(x.classification::text ORDER BY x.position) FROM ingest.album_classifications x WHERE x.album_id = a.id) AS classes
        FROM public.albums a LEFT JOIN public.artists r ON r.id = a.artist_id
       ORDER BY a.id`);

    for (const row of rows) {
      const verdict = liveTitleVerdict(row.title, row.artist);
      const item: Item = { albumId: Number(row.id), artist: row.artist, title: row.title, albumType: row.album_type, marker: verdict.marker };
      if (!verdict.live) {
        if (verdict.doubt && row.album_type !== "live_album") report.doubts.push(item);
        continue;
      }
      if (row.album_type === "live_album") { report.alreadyLive += 1; continue; }
      const classes = row.classes ?? [];
      if (classes.some((label) => NO_TYPE.has(label))) { report.skippedNoType.push({ ...item, why: classes.join(", ") }); continue; }

      if (KEEP_TYPE.has(row.album_type)) {
        if (classes.includes(LIVE_CLASSIFICATION)) { report.alreadyClassified += 1; continue; }
        await client.query(`
          INSERT INTO ingest.album_classifications(album_id, classification, position, inferred)
          VALUES($1, $2, COALESCE((SELECT max(position) FROM ingest.album_classifications WHERE album_id=$1), 0) + 1, true)
          ON CONFLICT (album_id, classification) DO NOTHING`, [row.id, LIVE_CLASSIFICATION]);
        report.classified.push(item);
        continue;
      }
      if (!ALBUM_TYPES.has(row.album_type)) { report.skippedNoType.push({ ...item, why: `tipo ${row.album_type}` }); continue; }

      const sheet = new Set(classes.map((label) => SHEET[label]).filter((type): type is string => Boolean(type)));
      if (sheet.size && !sheet.has("live_album")) { report.skippedSheet.push({ ...item, why: `la hoja dice ${classes.join(", ")}` }); continue; }

      const updated = await client.query(
        `UPDATE public.albums SET album_type='live_album', updated_at=now() WHERE id=$1 AND album_type=$2::album_type RETURNING id`, [row.id, row.album_type]);
      if (!updated.rowCount) continue;
      const note = `regla «en vivo» (${verdict.marker}): «${row.title}»; plan v2 del primo, punto 5`;
      const claim = await client.query<{ id: string }>(`
        INSERT INTO ingest.claims(source_id,entity_kind,album_id,field,raw_value,normalized_value,raw_hash,extractor,
                                  extractor_version,confidence,status,created_by,run_id,notes,identity_key)
        VALUES($1,'album',$2,'album_type',to_jsonb($3::text),to_jsonb('live_album'::text),$4,$5,'1','medium','accepted','system',$6,$7,$8)
        ON CONFLICT DO NOTHING RETURNING id::text`,
      [sourceId, row.id, row.title, sha([EXTRACTOR, row.id, row.title]), EXTRACTOR, report.runId, note, `tipo-disco:album:${row.id}`]);
      const claimId = claim.rows[0]?.id;
      if (claimId) {
        const url = row.youtube_url ?? row.wordpress_url ?? `crv-fuente://catalogo/album/${row.id}`;
        await client.query(`
          INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4)
          ON CONFLICT DO NOTHING`, [claimId, url, `[título] ${row.title}`.slice(0, 500), sha([url, row.title])]);
      }
      const audit = await client.query<{ id: string }>(`
        INSERT INTO ingest.merge_audit(run_id,entity_kind,album_id,field,old_value,new_value,reason,confidence,performed_by)
        VALUES($1,'album',$2,'album_type',to_jsonb($3::text),to_jsonb('live_album'::text),$4,'medium','system') RETURNING id::text`,
      [report.runId, row.id, row.album_type, note]);
      if (claimId) await client.query("INSERT INTO ingest.merge_audit_claims(merge_audit_id,claim_id) VALUES($1,$2)", [audit.rows[0]!.id, claimId]);
      report.changed.push(item);
    }
    await client.query(`UPDATE ingest.scrape_runs SET status='ok', finished_at=now(), counters=$2::jsonb WHERE id=$1`, [report.runId, JSON.stringify({
      changed: report.changed.length, classified: report.classified.length, skippedSheet: report.skippedSheet.length,
      skippedNoType: report.skippedNoType.length, doubts: report.doubts.length,
    })]);
    await client.query(confirm ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const out = `reports/apply-live-album-types-${report.mode}-${DATE}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`regla en vivo (${report.mode}, run ${report.runId}): ${report.changed.length} → live_album · ${report.classified.length} con clasificación «En vivo»`,
    `· ${report.skippedSheet.length} saltados por la hoja · ${report.skippedNoType.length} sin tipo (video/B-Sides) · ${report.doubts.length} dudas`,
    `· ${report.alreadyLive} ya eran live_album → ${out}`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
