// CRV · Ensayo del escritor de la hoja YT Master (Fase 3).
//
// Lee la hoja real (solo lectura si no hay hoja de prueba), clasifica los
// videos del canal con las mismas reglas del exportador de Herra y simula los
// cambios de Upload Order/Status. Con `--test-sheet <id>` escribe en una hoja
// de prueba —nunca en la real ni en una de `readOnlySheetIds`— y guarda el
// informe. El export de las 04:00 y el gancho de géneros siguen siendo de
// Herra hasta el go-live.
import fs from "node:fs";
import { getEnv } from "../src/config/env.js";
import { getPool } from "../src/db/client.js";
import { loadRadioConfig } from "../src/shared/radio/config.js";
import {
  syncTrackingSheet, type TrackingSheetVideoRef, type UnlistedVideoProbe,
} from "./lib/sheets-tracking.js";

const args = process.argv.slice(2);
const valueOf = (flag: string): string | null => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
};
const projectId = Number(process.env["CRV_RADIO_PROJECT_ID"] ?? "1");
const config = await loadRadioConfig(projectId);
if (!config) {
  console.error("radio: el proyecto no tiene la feature `radio` activa o su configuración no es válida.");
  process.exit(2);
}
const realSheet = config.trackingSheetId;
if (!realSheet) {
  console.error("radio: la configuración no define trackingSheetId.");
  process.exit(2);
}
const credentials = getEnv().CRV_RADIO_SHEET_CREDENTIALS
  ?? "/home/brian/apps/herra-instances/herra-crv/secrets/service-account-radio-sheet.json";
if (!fs.existsSync(credentials)) {
  console.error(`radio: no existe la credencial de la hoja: ${credentials}`);
  process.exit(2);
}
const testSheet = valueOf("--test-sheet") ?? getEnv().CRV_RADIO_TEST_SHEET_ID ?? null;
if (testSheet && (testSheet === realSheet || config.readOnlySheetIds.includes(testSheet))) {
  console.error("radio: la hoja de prueba no puede ser la real ni una de solo lectura.");
  process.exit(2);
}
const target = testSheet ?? realSheet;
const dryRun = !testSheet;
const out = valueOf("--out") ?? "/tmp/crv-radio-sheet-dry-run.json";

const channelId = config.channelId;
const pool = getPool();
const { rows } = await pool.query<{ video_id: string; title: string }>(
  `SELECT video_id, title FROM media.youtube_videos
    WHERE ($1::text IS NULL OR channel_id = $1)
    ORDER BY published_at DESC NULLS LAST, id DESC`, [channelId]);
const videos: TrackingSheetVideoRef[] = rows
  .filter((row) => /^[A-Za-z0-9_-]{11}$/u.test(row.video_id) && row.title.trim() !== "")
  .map((row) => ({ videoId: row.video_id, title: row.title }));
if (videos.length === 0) {
  console.error("radio: no hay videos del canal en media.youtube_videos.");
  process.exit(2);
}

// En este ensayo no se sondean páginas de YouTube: un estado no público que ya
// esté en la hoja se conserva y una fila nueva sin URL pública queda Unlisted.
const probe: UnlistedVideoProbe = async () => new Map();

console.log(`hoja: ${dryRun ? "ENSAYO (sin escrituras)" : `PRUEBA ${target}`}`);
console.log(`videos del canal: ${videos.length}`);
const result = await syncTrackingSheet(target, credentials, videos, dryRun, probe, {
  ...(config.channelTitle ? { channelName: config.channelTitle } : {}),
  readOnlySheetIds: config.readOnlySheetIds,
});
const report = {
  generatedAt: new Date().toISOString(),
  mode: dryRun ? "dry-run" : "test-sheet",
  target: testSheet ? "test" : "real-read-only",
  videos: videos.length,
  added: result.added,
  orderChanges: result.orderChanges,
  statusChanges: result.statusChanges,
  unlistedDateChanges: result.unlistedDateChanges,
  statusCounts: result.statusCounts,
  possibleDuplicates: result.possibleDuplicates.length,
  sample: result.rows.slice(0, 10),
};
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`informe: ${out}`);
