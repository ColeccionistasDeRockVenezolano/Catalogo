// Exporta el catálogo de la Radio CRV desde la base, sin Herra y sin consultar
// a YouTube: la disponibilidad y los vetos salen del registro que mantiene
// `crv-youtube-availability` en media.youtube_videos (regla de AGENTS.md).
// Solo lee PostgreSQL. No copia payloads, descripciones ni evidencia.
//
//   npm run radio:export -- <salida.json> [--base <catálogo>] [--tipos-hoja] [--dry-run] [--max-retiradas 5]
//
// --tipos-hoja     lee los tipos de la hoja YT Master (solo lectura) en vez de su copia
//                  en seed_uploads; si la hoja no se puede leer, no exporta.
// --base           catálogo cuyo orden se conserva (por defecto, la propia salida).
// --max-retiradas  porcentaje máximo de piezas que puede perder; por encima no escribe.
// Nunca escribe sobre el catálogo de una instancia de Herra: su cron sigue siendo el dueño.
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../src/config/env.js";
import { closeDb, getPool } from "../src/db/client.js";
import { RADIO_CATALOG_VERSION, buildRadioTracks, livePlayable, type RadioTrackRow } from "../src/radio/catalog.js";
import { mergeWithPrevious, removedShare, type MergeableItem } from "../src/radio/catalog-merge.js";
import { albumsForVideos, annotateRadioCatalog, loadRadioAlbumGenres, loadRadioAlbumTypes } from "../src/radio/genres.js";
import { annotateRadioRegions } from "../src/radio/regions.js";
import { iso8601DurationToSeconds, type YouTubeVideoPayload } from "../src/youtube/api.js";
import { CRV_CHANNEL_ID } from "../src/youtube/home-channel.js";
import { loadRadioConfig } from "../src/shared/radio/config.js";
import { readAlbumTypesByVideo } from "./lib/sheets-tracking.js";

interface ExportRow extends Omit<RadioTrackRow, "video_duration_seconds"> {
  video_duration_seconds: number | null;
  publication_status: string;
  metadata: Omit<YouTubeVideoPayload, "id"> | null;
  last_fetched_at: Date | null;
}

const VOLATILE_FIELDS = new Set(["generatedAt", "availabilityCheckedAt", "genresAnnotatedAt"]);

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** Final conocido de cada video en el catálogo anterior: la base no guarda la duración de unos pocos. */
function knownEnds(items: readonly MergeableItem[]): Map<string, number> {
  const ends = new Map<string, number>();
  for (const item of items) ends.set(item.videoId, Math.max(ends.get(item.videoId) ?? 0, item.startSeconds + item.durationSeconds));
  return ends;
}

async function sheetTypes(): Promise<Map<string, string[]>> {
  const config = await loadRadioConfig(Number(process.env["CRV_RADIO_PROJECT_ID"] ?? "1"));
  if (!config?.trackingSheetId) throw new Error("radio: la configuración no define trackingSheetId");
  const credentials = getEnv().CRV_RADIO_SHEET_CREDENTIALS
    ?? "/home/brian/apps/herra-instances/herra-crv/secrets/service-account-radio-sheet.json";
  return readAlbumTypesByVideo(config.trackingSheetId, credentials);
}

function readItems(filePath: string): MergeableItem[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { items?: MergeableItem[] };
  return Array.isArray(raw.items) ? raw.items : [];
}

const stable = (catalog: Record<string, unknown>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(catalog).filter(([key]) => !VOLATILE_FIELDS.has(key)).sort(([a], [b]) => a.localeCompare(b))));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valued = new Set(["--base", "--max-retiradas"]);
  const requested = args.find((arg, index) => !arg.startsWith("--") && !valued.has(args[index - 1] ?? "")) ?? process.env["CRV_RADIO_EXPORT_PATH"];
  if (!requested) throw new Error("uso: npm run radio:export -- <salida.json> [--base <catálogo>] [--tipos-hoja] [--dry-run] [--max-retiradas 5]");
  const outputPath = path.resolve(requested);
  if (/(^|\/)herra(-instances)?\//.test(outputPath)) throw new Error(`no se escribe sobre el catálogo de Herra: ${outputPath}`);
  const dryRun = args.includes("--dry-run");
  const maxRemoved = Number(option(args, "--max-retiradas") ?? "5") / 100;
  if (!Number.isFinite(maxRemoved) || maxRemoved < 0) throw new Error("--max-retiradas debe ser un porcentaje");
  const basePath = path.resolve(option(args, "--base") ?? outputPath);

  const pool = getPool();
  const { rows } = await pool.query<ExportRow>(`
    SELECT v.video_id, v.title AS video_title, v.duration_seconds AS video_duration_seconds,
           v.publication_status::text AS publication_status, v.metadata, v.last_fetched_at,
           t.position, t.title AS track_title, t.start_seconds,
           (SELECT string_agg(su.type_raw, ', ') FROM ingest.seed_uploads su WHERE su.video_id = v.video_id) AS sheet_types
      FROM media.youtube_videos v
      JOIN media.youtube_tracklist_entries t ON t.video_id = v.id
     WHERE v.channel_id = $1 AND v.title IS NOT NULL
     ORDER BY v.video_id, t.position`, [CRV_CHANNEL_ID]);

  const typesFromSheet = args.includes("--tipos-hoja") ? await sheetTypes() : null;
  const previous = readItems(basePath);
  const previousEnds = knownEnds(previous);
  const withoutDuration = new Set<string>();
  const payloads = new Map<string, YouTubeVideoPayload>();
  const playable = new Set<string>();
  const trackRows: RadioTrackRow[] = [];
  let lastChecked = 0;
  for (const row of rows) {
    const payload: YouTubeVideoPayload = { id: row.video_id, ...row.metadata };
    payloads.set(row.video_id, payload);
    if (row.publication_status === "published" && livePlayable(payload)) playable.add(row.video_id);
    lastChecked = Math.max(lastChecked, row.last_fetched_at?.getTime() ?? 0);
    const duration = row.video_duration_seconds
      ?? iso8601DurationToSeconds(payload.contentDetails?.["duration"] as string | undefined)
      ?? previousEnds.get(row.video_id) ?? null;
    if (duration === null) withoutDuration.add(row.video_id);
    else trackRows.push({
      ...row, video_duration_seconds: duration,
      sheet_types: typesFromSheet?.get(row.video_id)?.join(", ") ?? row.sheet_types ?? null,
    });
  }
  const built = buildRadioTracks(trackRows, playable);
  if (built.length < 2) throw new Error(`catálogo insuficiente: ${built.length} canciones elegibles`);
  const { items: merged, stats: merge } = mergeWithPrevious(previous, built);

  const albumByVideo = await albumsForVideos(pool, [...new Set(merged.map((item) => item.videoId))]);
  const albumIds = [...new Set(albumByVideo.values())];
  const now = new Date().toISOString();
  const withGenres = annotateRadioCatalog(
    { version: RADIO_CATALOG_VERSION, generatedAt: now, availabilityCheckedAt: lastChecked ? new Date(lastChecked).toISOString() : now, channelId: CRV_CHANNEL_ID, items: merged },
    albumByVideo, await loadRadioAlbumGenres(pool, albumIds), now, await loadRadioAlbumTypes(pool, albumIds),
  );
  const { catalog, stats: regions } = annotateRadioRegions(withGenres.catalog, payloads);

  const hours = merged.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600;
  const summary = `Radio CRV: ${merged.length} piezas de ${new Set(merged.map((item) => item.videoId)).size} videos, ${hours.toFixed(1)} h · `
    + `${merge.kept} conservadas, ${merge.added} nuevas, ${merge.removed} retiradas, ${merge.timingPreserved} con duración conservada · `
    + `${withGenres.stats.confirmed} con género confirmado · ${regions.restrictedVideos} videos con veto parcial`;
  process.stdout.write(`${summary}\n`);
  if (withoutDuration.size) process.stdout.write(`sin duración conocida, fuera del catálogo: ${[...withoutDuration].sort().join(", ")}\n`);
  if (removedShare(merge) > maxRemoved) {
    process.stderr.write(`retiraría el ${(removedShare(merge) * 100).toFixed(1)} % de las piezas (máximo ${maxRemoved * 100} %): no se escribe\n`);
    process.exitCode = 3;
    return;
  }
  if (dryRun) { process.stdout.write("dry-run: no se escribió\n"); return; }
  if (fs.existsSync(outputPath) && stable(JSON.parse(fs.readFileSync(outputPath, "utf8")) as Record<string, unknown>) === stable(catalog)) {
    process.stdout.write("sin cambios: el archivo no se modifica\n");
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(catalog, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, outputPath);
  process.stdout.write(`-> ${outputPath}\n`);
}

main()
  .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; })
  .finally(closeDb);
