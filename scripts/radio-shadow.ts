// CRV · Sombra de la radio (Fase 3).
//
// Calcula la emisión con el motor del catálogo y la compara con el
// `/api/radio/now` vivo de Herra al mismo `serverTime`. No escribe nada y no
// sirve la radio al público: solo demuestra que ambos motores coinciden.
//
// Uso:
//   CRV_ENV_FILE=/home/brian/apps/crv-staging/staging.env \
//     ./scripts/with-node22.sh ./node_modules/.bin/tsx scripts/radio-shadow.ts --live
//   ... --live --watch 30
//   ... --at 2026-11-01T00:49:01.000Z
import { loadRadioConfig, radioStationFromConfig } from "../src/shared/radio/config.js";
import { inspectCatalog, radioSnapshot, type RadioSnapshot } from "../src/shared/radio/engine.js";
import { compareRadioSnapshots, type SnapshotDivergence } from "../src/shared/radio/compare.js";

interface LiveSnapshot extends RadioSnapshot { listeners: number }

const args = process.argv.slice(2);
const watchIndex = args.indexOf("--watch");
const watchSeconds = watchIndex >= 0 ? Number(args[watchIndex + 1] ?? "30") : 0;
const atIndex = args.indexOf("--at");
const at = atIndex >= 0 ? args[atIndex + 1] : null;
const liveFlag = args.includes("--live");
const liveUrl = process.env["CRV_RADIO_LIVE_URL"] ?? "http://127.0.0.1:3020/api/radio/now";
const projectId = Number(process.env["CRV_RADIO_PROJECT_ID"] ?? "1");

function sameState(live: LiveSnapshot, local: RadioSnapshot): SnapshotDivergence[] {
  return compareRadioSnapshots(live, local);
}

async function fetchLive(): Promise<LiveSnapshot> {
  const response = await fetch(liveUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${liveUrl} → HTTP ${response.status}`);
  return await response.json() as LiveSnapshot;
}

async function compareOnce(): Promise<{ at: string; diffs: SnapshotDivergence[] }> {
  const live = await fetchLive();
  const local = radioSnapshot(station, Date.parse(live.serverTime));
  if (!local) throw new Error("el motor local no pudo calcular una emisión");
  // Si cambia la cuña en producción, la divergencia no es del motor: hay que
  // copiar la cuña y la época a la base de la que lee esta sombra.
  const liveSweeper = JSON.stringify(live.sweeper ?? null);
  const localSweeper = JSON.stringify(station.sweeper ?? null);
  if (liveSweeper !== localSweeper) {
    console.error(`! configuración distinta, no del motor: cuña en vivo ${liveSweeper} · cuña local ${localSweeper}`);
  }
  return { at: live.serverTime, diffs: sameState(live, local) };
}

const config = await loadRadioConfig(projectId);
if (!config) {
  console.error("radio: el proyecto no tiene la capacidad activa o la configuración no es válida.");
  process.exit(2);
}
const station = radioStationFromConfig(config);
const catalog = inspectCatalog(station);
console.log(`catálogo: ${catalog.items} piezas, ${catalog.genres} géneros, versión ${catalog.version}, ${(catalog.totalDurationSeconds / 3600).toFixed(2)} h`);
console.log(`estación: ${station.stationName}; epoch ${config.epoch}; cruce ${config.crossfadeSeconds}s; cuña cada ${config.sweeper?.everyPieces ?? 1}`);
if (!station.catalogPath || catalog.error) {
  console.error(`radio: ${catalog.error ?? "sin catálogo"}`);
  process.exit(2);
}

if (at) {
  const local = radioSnapshot(station, Date.parse(at));
  if (!local) { console.error("radio: no se pudo calcular la emisión local"); process.exit(1); }
  console.log(JSON.stringify(local, null, 2));
  process.exit(0);
}

if (!liveFlag && watchSeconds <= 0) {
  const local = radioSnapshot(station);
  if (!local) { console.error("radio: no se pudo calcular la emisión local"); process.exit(1); }
  console.log(JSON.stringify(local, null, 2));
  process.exit(0);
}

const startedAt = Date.now();
let checks = 0;
const mismatches: Array<{ at: string; diffs: SnapshotDivergence[] }> = [];
let running = true;
while (running) {
  try {
    const result = await compareOnce();
    checks += 1;
    if (result.diffs.length > 0) {
      mismatches.push(result);
      console.error(`✗ ${result.at}: ${result.diffs.map((diff) => `${diff.field} live=${String(diff.live)} local=${String(diff.local)}`).join(" | ")}`);
    } else {
      console.log(`✓ ${result.at}: misma pieza (${result.at})`);
    }
  } catch (error) {
    console.error(`! ${error instanceof Error ? error.message : String(error)}`);
  }
  running = watchSeconds > 0 && Date.now() - startedAt < watchSeconds * 1000;
  if (running) await new Promise((resolve) => setTimeout(resolve, 2000));
}

console.log(`\nsombra: ${checks} comprobaciones, ${mismatches.length} divergencias`);
if (checks === 0 || mismatches.length > 0) process.exit(1);
