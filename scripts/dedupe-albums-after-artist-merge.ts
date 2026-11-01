// CRV · Limpieza de discos duplicados que quedan al fusionar artistas.
//
// Al unir dos fichas de la misma banda, sus discos se mueven a la ficha que
// queda: si ambas tenían el mismo álbum, aparecen dos filas con el mismo título
// y año bajo el mismo artista. Este script las une SOLO cuando la lista de
// pistas es idéntica (título normalizado en el mismo orden), el título no queda
// vacío al normalizar y no hay formatos ni números de catálogo en conflicto.
// Usa `mergeDuplicate('album')`, el mismo camino auditado de `review duplicates`.
//
// Uso:
//   tsx scripts/dedupe-albums-after-artist-merge.ts --since=2026-10-29T20:00:00Z [--confirm]
import { closeDb, getPool } from "../src/db/client.js";
import { mergeDuplicate } from "../src/review/duplicates.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

const args = process.argv.slice(2);
const since = args.find((arg) => arg.startsWith("--since="))?.slice("--since=".length) ?? "2026-10-29T20:00:00Z";
const confirm = args.includes("--confirm");
const note = "Discos duplicados unidos tras la fusión de artistas del 2026-10-29 (misma lista de pistas)";

interface AlbumRow {
  id: string; artist_id: string; title: string; release_year: number | null;
  media_format: string | null; catalog_id: string | null;
}

async function tracklist(albumId: number): Promise<string> {
  const { rows } = await getPool().query<{ title: string }>(
    "SELECT title FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number NULLS LAST,id", [albumId]);
  return rows.map((row) => normalizeEntityName(row.title).secondaryKey).join("\n");
}

async function main(): Promise<void> {
  const pool = getPool();
  const keeps = (await pool.query<{ id: string }>(`
    SELECT DISTINCT (params->>'keepId')::bigint AS id
      FROM ingest.scrape_runs
     WHERE params->>'action'='cli:review:artist-merge' AND status='ok' AND created_at >= $1::timestamptz`,
  [since])).rows.map((row) => Number(row.id));
  const existing = (await pool.query<{ id: string }>(
    "SELECT id::text FROM public.artists WHERE id=ANY($1::bigint[])", [keeps])).rows.map((row) => Number(row.id));

  const pairs: Array<{ keep: AlbumRow; drop: AlbumRow }> = [];
  for (const artistId of existing) {
    const albums = (await pool.query<AlbumRow>(
      `SELECT id::text,artist_id::text,title,release_year,media_format,catalog_id
         FROM public.albums WHERE artist_id=$1 ORDER BY id`, [artistId])).rows;
    const groups = new Map<string, AlbumRow[]>();
    for (const album of albums) {
      const titleKey = normalizeEntityName(album.title).secondaryKey;
      if (!titleKey) continue;
      const key = `${titleKey}|${album.release_year ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), album]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const signatures = new Map<number, string>();
      for (const album of group) signatures.set(Number(album.id), await tracklist(Number(album.id)));
      const distinct = new Set([...signatures.values()].filter(Boolean));
      if (distinct.size !== 1) continue; // listas distintas o vacías: no se tocan
      const formats = new Set(group.map((album) => album.media_format?.trim().toLowerCase()).filter(Boolean));
      const catalogs = new Set(group.map((album) => album.catalog_id?.trim().toLowerCase()).filter(Boolean));
      if (formats.size > 1 || catalogs.size > 1) continue;
      const ordered = [...group].sort((left, right) => Number(left.id) - Number(right.id));
      for (const drop of ordered.slice(1)) pairs.push({ keep: ordered[0]!, drop });
    }
  }

  console.log(JSON.stringify({ mode: confirm ? "confirm" : "dry-run", artists: existing.length, pairs: pairs.length,
    detail: pairs.map((pair) => `${pair.keep.id} ${pair.keep.title} (${pair.keep.release_year}) ← ${pair.drop.id}`) }, null, 2));
  if (!confirm || !pairs.length) return;

  const run = await pool.query<{ id: string }>(
    "INSERT INTO ingest.scrape_runs(kind,status,params) VALUES('merge_run','running',$1::jsonb) RETURNING id::text",
    [JSON.stringify({ action: "album_dedupe_after_artist_merge", note, since, pairs: pairs.length })]);
  const runId = Number(run.rows[0]!.id);
  const merged: Array<{ keep: number; drop: number; title: string }> = [];
  try {
    for (const pair of pairs) {
      await mergeDuplicate("album", Number(pair.keep.id), Number(pair.drop.id),
        `${note} — «${pair.keep.title}» (${pair.keep.release_year ?? "sin año"})`, runId);
      merged.push({ keep: Number(pair.keep.id), drop: Number(pair.drop.id), title: pair.keep.title });
    }
    await pool.query("UPDATE ingest.scrape_runs SET status='ok',finished_at=now() WHERE id=$1", [runId]);
    console.log(JSON.stringify({ runId, merged }, null, 2));
  } catch (error) {
    await pool.query("UPDATE ingest.scrape_runs SET status='failed',finished_at=now(),error_log=$2 WHERE id=$1",
      [runId, error instanceof Error ? error.message.slice(0, 1000) : String(error)]);
    throw error;
  }
}

main().then(async () => { await closeDb(); }).catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exitCode = 1;
});
