// CRV · Sincroniza la hoja YT Master desde la base, en lugar del export de Herra.
//
//   tsx scripts/radio-sheet-sync.ts [--out informe.json]           ensayo: lee la hoja y no escribe
//   tsx scripts/radio-sheet-sync.ts --test-sheet <id>              escribe en una hoja de prueba
//
// Esta herramienta no escribe en la hoja real: hasta el corte, su dueño sigue
// siendo el cron de Herra. Las filas fuera de la lista pública toman su estado
// del registro de media.youtube_videos; nunca consulta páginas de YouTube.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getEnv } from "../src/config/env.js";
import { closeDb, getPool } from "../src/db/client.js";
import { sheetStatusOf } from "../src/radio/sheet-status.js";
import { loadRadioConfig } from "../src/shared/radio/config.js";
import type { YouTubeVideoPayload } from "../src/youtube/api.js";
import { syncTrackingSheet, type TrackingStatus, type UnlistedVideoProbe } from "./lib/sheets-tracking.js";

const args = process.argv.slice(2);
const valueOf = (flag: string): string | null => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? null : null);

async function main(): Promise<void> {
  const config = await loadRadioConfig(Number(process.env["CRV_RADIO_PROJECT_ID"] ?? "1"));
  if (!config?.trackingSheetId) throw new Error("radio: la configuración no define trackingSheetId");
  const credentials = getEnv().CRV_RADIO_SHEET_CREDENTIALS
    ?? "/home/brian/apps/herra-instances/herra-crv/secrets/service-account-radio-sheet.json";
  if (!fs.existsSync(credentials)) throw new Error(`radio: no existe la credencial de la hoja: ${credentials}`);
  const testSheet = valueOf("--test-sheet");
  if (testSheet && (testSheet === config.trackingSheetId || config.readOnlySheetIds.includes(testSheet))) {
    throw new Error("radio: la hoja de prueba no puede ser la real ni una de solo lectura");
  }

  const { rows } = await getPool().query<{ video_id: string; title: string | null; publication_status: string; metadata: Partial<YouTubeVideoPayload> | null }>(
    `SELECT video_id, title, publication_status::text AS publication_status, metadata
       FROM media.youtube_videos WHERE channel_id = $1
      ORDER BY published_at DESC NULLS LAST, id DESC`, [config.channelId]);
  const registry = new Map(rows.map((row) => [row.video_id, sheetStatusOf(row.publication_status, row.metadata)]));
  const listed = rows
    .filter((row) => registry.get(row.video_id) === "Listed" && row.title?.trim())
    .map((row) => ({ videoId: row.video_id, title: row.title! }));
  if (listed.length === 0) throw new Error("radio: no hay videos públicos del canal en la base");
  // Un video sin registro queda fuera del resultado: la hoja conserva su estado.
  const probe: UnlistedVideoProbe = async (videoIds) => new Map(videoIds.flatMap((videoId) => {
    const status = registry.get(videoId);
    return status && status !== "Listed" ? [[videoId, status as Exclude<TrackingStatus, "Listed">] as const] : [];
  }));

  const result = await syncTrackingSheet(testSheet ?? config.trackingSheetId, credentials, listed, !testSheet, probe, {
    ...(config.channelTitle ? { channelName: config.channelTitle } : {}),
    readOnlySheetIds: config.readOnlySheetIds,
  });
  const report = {
    generatedAt: new Date().toISOString(),
    mode: testSheet ? "test-sheet" : "dry-run",
    listed: listed.length,
    added: result.added,
    orderChanges: result.orderChanges,
    statusChanges: result.statusChanges,
    unlistedDateChanges: result.unlistedDateChanges,
    statusCounts: result.statusCounts,
    statusDetails: result.statusDetails ?? [],
    newRows: result.rows,
    possibleDuplicates: result.possibleDuplicates,
  };
  const out = valueOf("--out") ?? path.join(os.homedir(), "crv-staging", "reports", "radio-catalogo-crv-2026-11", "hoja-ensayo.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const { statusDetails, newRows, possibleDuplicates, ...summary } = report;
  console.log(JSON.stringify({ ...summary, statusDetails: statusDetails.length, newRows: newRows.length, possibleDuplicates: possibleDuplicates.length }));
  for (const row of statusDetails.slice(0, 40)) console.log(`  ${row.videoId ?? "(sin URL)"} ${row.from || "(vacío)"} -> ${row.to} · ${String(row.artist)} — ${String(row.album)}`);
  for (const row of newRows.slice(0, 15)) console.log(`  + ${row.join(" | ")}`);
  console.log(`informe: ${out}`);
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; })
  .finally(closeDb);
