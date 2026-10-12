// CRV · Plan del primo, etapa 2 (2026-10-12): versiones de disco (punto 9).
// Decisión de Brian: el álbum es la obra (la página) y sus versiones viven
// dentro (`ingest.album_versions`).
//
//   --stage=inicial   una versión inicial por disco con lo que ya guarda el
//                     núcleo: `albums.catalog_id`, `media_format`, `label_id`.
//   --stage=run18980  las reediciones que juntó la run 18980 («Flor de Fuego
//                     (CD/DVD)», «Atabal Yémal (CD Reissue)»…) vuelven como
//                     versiones de su obra con su sello, año, formato y
//                     portada, tal como estaban en la ficha absorbida
//                     (`merge_audit.old_value`).
//
// Sin --confirm solo informa. Todo va en un run.
import { writeFileSync, mkdirSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { versionFormatOf } from "../src/discography/versions.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";

const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice("--stage=".length);
const confirm = process.argv.includes("--confirm");
const NOTE = "Plan del primo, etapa 2 (2026-10-12): versiones de disco (punto 9)";
const OUT = "reports/primo-etapa2";
const pool = getPool();
mkdirSync(OUT, { recursive: true });

async function inicial(): Promise<void> {
  const { rows } = await pool.query<{ n: string }>(`
    SELECT count(*)::text AS n FROM public.albums a
     WHERE (a.catalog_id IS NOT NULL OR (a.media_format IS NOT NULL AND a.media_format <> 'Unknown') OR a.label_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM ingest.album_versions v WHERE v.album_id = a.id)`);
  console.log(`versiones iniciales por crear: ${rows[0]!.n}`);
  if (!confirm) return;
  const { runId, result } = await withOperatorRun({ name: "primo-etapa2:versiones-inicial", operator: "claude-code", note: `${NOTE}: versión inicial` }, async (context) => {
    const inserted = await context.client.query(`
      INSERT INTO ingest.album_versions(album_id, position, format, catalog_number, release_year, release_date, is_primary, source, source_ref, run_id)
      SELECT a.id, 1, NULLIF(a.media_format, 'Unknown'), a.catalog_id, a.release_year, ced.release_date, true, 'albums',
             'albums.catalog_id / media_format / label_id', $1
        FROM public.albums a
        LEFT JOIN ingest.catalog_edition_details ced ON ced.album_id = a.id
       WHERE (a.catalog_id IS NOT NULL OR (a.media_format IS NOT NULL AND a.media_format <> 'Unknown') OR a.label_id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM ingest.album_versions v WHERE v.album_id = a.id)`, [context.runId]);
    return { versions: inserted.rowCount };
  });
  console.log(`run ${runId}:`, result);
}

/** Fichas absorbidas en la run 18980 que eran otra edición de la misma obra. */
const REISSUE_DROPS = [3845, 7848, 3981, 4589, 3935, 26780, 3526, 4527, 4532, 4529, 3957, 4586, 4293, 7849, 8444, 8457, 8519, 8612, 8632, 8715, 8872];

interface Drop { auditId: number; keepId: number; drop: Record<string, unknown>; keep: { title: string; year: number | null; format: string | null; labelId: number | null; discs: Array<{ disc: number; title: string }>; maxDisc: number } }

async function run18980(): Promise<void> {
  const { rows } = await pool.query<{ audit_id: string; keep_id: string; old_value: Record<string, unknown>; title: string; release_year: number | null; media_format: string | null; label_id: string | null; discs: Array<{ disc: number; title: string }> | null; max_disc: number | null }>(`
    SELECT ma.id::text AS audit_id, (ma.new_value->>'keptId') AS keep_id, ma.old_value, a.title, a.release_year, a.media_format, a.label_id::text,
           (SELECT jsonb_agg(jsonb_build_object('disc', d.disc_number, 'title', d.title) ORDER BY d.disc_number) FROM public.album_discs d WHERE d.album_id = a.id) AS discs,
           (SELECT max(t.disc_number) FROM public.tracks t WHERE t.album_id = a.id) AS max_disc
      FROM ingest.merge_audit ma
      JOIN public.albums a ON a.id = (ma.new_value->>'keptId')::bigint
     WHERE ma.run_id = 18980 AND ma.entity_kind = 'album' AND ma.field = 'merged_duplicate'
       AND (ma.old_value->>'id')::bigint = ANY($1::bigint[])
     ORDER BY a.id, ma.id`, [REISSUE_DROPS]);
  const drops: Drop[] = rows.map((row) => ({
    auditId: Number(row.audit_id), keepId: Number(row.keep_id), drop: row.old_value,
    keep: { title: row.title, year: row.release_year, format: row.media_format, labelId: row.label_id ? Number(row.label_id) : null, discs: row.discs ?? [], maxDisc: row.max_disc ?? 1 },
  }));
  const report = ["# Versiones de la run 18980 — " + (confirm ? "aplicado" : "ensayo"), "", `${drops.length} ediciones absorbidas vuelven como versiones de ${new Set(drops.map((d) => d.keepId)).size} obras.`, ""];
  for (const item of drops) {
    const title = String(item.drop["title"]);
    const fmt = versionFormatOf(title, item.drop["media_format"] as string | null);
    report.push(`- **${item.keep.title}** (${item.keepId}) ⇐ «${title}» (${item.drop["id"]}): ${[fmt.format, fmt.details, item.drop["release_year"]].filter(Boolean).join(" · ")}${item.drop["label_id"] ? ` · sello ${item.drop["label_id"]}` : ""}${item.drop["cover_url"] ? " · portada propia" : ""}`);
  }
  writeFileSync(`${OUT}/versiones-run18980-${confirm ? "aplicado" : "ensayo"}.md`, report.join("\n") + "\n");
  console.log(report.slice(0, 3).join("\n"));
  if (!confirm) return;
  const { runId, result } = await withOperatorRun({ name: "primo-etapa2:versiones-run18980", operator: "claude-code", note: `${NOTE}: reediciones de la run 18980` }, async (context) => {
    let created = 0;
    for (const item of drops) {
      const drop = item.drop;
      const dropTitle = String(drop["title"]);
      // La obra conserva su versión principal; si aún no la tiene, se crea con sus datos.
      await context.client.query(`
        INSERT INTO ingest.album_versions(album_id, position, format, release_year, is_primary, source, source_ref, run_id)
        SELECT $1, 1, $2, $3, true, 'albums', 'obra de la run 18980', $4
         WHERE NOT EXISTS (SELECT 1 FROM ingest.album_versions WHERE album_id = $1)`,
      [item.keepId, versionFormatOf(item.keep.title, item.keep.format).format, item.keep.year, context.runId]);
      // Los discos que aportó: en «append» la ficha absorbida es un disco aparte con nombre.
      const ownDisc = item.keep.discs.find((disc) => /reedici|reissue|super deluxe|edition|cd \(/iu.test(disc.title) && disc.disc > 1);
      const fmt = versionFormatOf(dropTitle, drop["media_format"] as string | null);
      const position = Number((await context.client.query<{ n: string }>(
        "SELECT (coalesce(max(position), 0) + 1)::text AS n FROM ingest.album_versions WHERE album_id = $1", [item.keepId])).rows[0]!.n);
      const version = await context.client.query<{ id: string }>(`
        INSERT INTO ingest.album_versions(album_id, position, title, format, format_details, catalog_number, release_year, cover_url, notes,
                                          distinct_tracks, disc_numbers, is_primary, source, source_ref, run_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, 'run-18980', $12, $13) RETURNING id::text`,
      [item.keepId, position, ownDisc?.title ?? fmt.title, fmt.format, fmt.details, drop["catalog_id"] ?? null,
        drop["release_year"] ?? null, drop["cover_url"] ?? null, null,
        ownDisc !== undefined, ownDisc ? [ownDisc.disc] : [],
        `merge_audit ${item.auditId}: ficha «${dropTitle}» (#${drop["id"]}) juntada en la run 18980`, context.runId]);
      created++;
      if (drop["label_id"]) {
        const organization = await context.client.query("SELECT 1 FROM public.organizations WHERE id = $1", [drop["label_id"]]);
        if (organization.rowCount) {
          await context.client.query(`
            INSERT INTO ingest.album_labels(album_id, version_id, organization_id, role, position, run_id)
            VALUES ($1, $2, $3, 'label', 1, $4) ON CONFLICT DO NOTHING`, [item.keepId, Number(version.rows[0]!.id), drop["label_id"], context.runId]);
        }
      }
    }
    return { created };
  });
  console.log(`run ${runId}:`, result);
}

/**
 * `--stage=reedicion --keep=9200 --drop=8715`: una reedición sin pistas propias
 * («Antología Vol. 10 (Reissue)») se junta con su obra y queda como versión con
 * su sello y año. Caso Sevillano: al separar los volúmenes de la run 18980 la
 * reedición volvió suelta.
 */
async function reedicion(): Promise<void> {
  const arg = (name: string) => Number(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3));
  const keepId = arg("keep"); const dropId = arg("drop");
  if (!keepId || !dropId) throw new Error("uso: --stage=reedicion --keep=ID --drop=ID");
  const preview = await previewAlbumMerge(pool, keepId, dropId);
  const drop = (await pool.query<Record<string, unknown>>("SELECT * FROM public.albums WHERE id = $1", [dropId])).rows[0]!;
  console.log(`«${preview.drop.title}» → versión de «${preview.keep.title}» (${preview.drop.counts.tracks} pistas propias)`);
  if (preview.drop.counts.tracks > 0) throw new Error("la reedición trae pistas propias: no es solo una versión");
  if (!confirm) return;
  const { runId } = await withOperatorRun({ name: "primo-etapa2:versiones-reedicion", operator: "claude-code", note: `${NOTE}: «${preview.drop.title}» como versión de su obra`, params: { keepId, dropId } }, async (context) => {
    const merged = await mergeAlbums(context, { keepId, dropId, previewHash: preview.previewHash, keepDropNameAsAlias: true });
    await context.client.query(`
      INSERT INTO ingest.album_versions(album_id, position, format, release_year, is_primary, source, source_ref, run_id)
      SELECT $1, 1, NULLIF(a.media_format, 'Unknown'), a.release_year, true, 'albums', 'obra', $2 FROM public.albums a
       WHERE a.id = $1 AND NOT EXISTS (SELECT 1 FROM ingest.album_versions WHERE album_id = $1)`, [keepId, context.runId]);
    const title = String(drop["title"]);
    const fmt = versionFormatOf(title, drop["media_format"] as string | null);
    const version = await context.client.query<{ id: string }>(`
      INSERT INTO ingest.album_versions(album_id, position, title, format, format_details, catalog_number, release_year, cover_url, is_primary, source, source_ref, run_id)
      VALUES ($1, (SELECT coalesce(max(position), 0) + 1 FROM ingest.album_versions WHERE album_id = $1), $2, $3, $4, $5, $6, $7, false, 'albums', $8, $9) RETURNING id::text`,
    [keepId, fmt.title, fmt.format, fmt.details, drop["catalog_id"] ?? null, drop["release_year"] ?? null, drop["cover_url"] ?? null,
      `merge_audit ${merged.auditId}: ficha «${title}» (#${dropId})`, context.runId]);
    if (drop["label_id"]) {
      await context.client.query(`
        INSERT INTO ingest.album_labels(album_id, version_id, organization_id, role, position, run_id) VALUES ($1, $2, $3, 'label', 1, $4) ON CONFLICT DO NOTHING`,
      [keepId, Number(version.rows[0]!.id), drop["label_id"], context.runId]);
    }
  });
  console.log(`run ${runId}`);
}

if (stage === "inicial") await inicial();
else if (stage === "reedicion") await reedicion();
else if (stage === "run18980") await run18980();
else throw new Error("uso: --stage=inicial|run18980 [--confirm]");
await closeDb();
