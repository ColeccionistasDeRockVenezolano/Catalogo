// CRV · Compara dos catálogos de radio con el motor real, sin red ni base.
//
//   tsx scripts/checks/radio-catalog-compare.mts <vivo.json> <nuevo.json> [--informe salida.json] [--samples 2000]
//
// Separa lo que cambia la emisión (huella del motor y piezas al aire) de lo que
// solo cambia los textos. Sale con 0 si ambos catálogos programan lo mismo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectCatalog, radioSnapshot, resetRadioEngineForTests, type RadioStation } from "../../src/shared/radio/engine.js";

interface Item { videoId: string; startSeconds: number; durationSeconds: number; regionRestriction?: { allowed?: string[]; blocked?: string[] }; [field: string]: unknown }

const args = process.argv.slice(2);
const option = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const [livePath, nextPath] = args;
if (!livePath || !nextPath || livePath.startsWith("--") || nextPath.startsWith("--")) {
  console.error("uso: <vivo.json> <nuevo.json> [--informe salida.json] [--samples 2000]");
  process.exit(2);
}
const samples = Number(option("--samples") ?? "2000");
const load = (file: string): { items: Item[] } => JSON.parse(fs.readFileSync(file, "utf8")) as { items: Item[] };
const live = load(livePath);
const next = load(nextPath);
const key = (item: Item): string => `${item.videoId}:${item.startSeconds}`;
const liveByKey = new Map(live.items.map((item) => [key(item), item]));
const nextByKey = new Map(next.items.map((item) => [key(item), item]));
const offAir = (item: Item): boolean => {
  const restriction = item.regionRestriction;
  if (!restriction) return false;
  if (restriction.allowed) return !restriction.allowed.includes("VE") || restriction.allowed.length < 100;
  return (restriction.blocked ?? []).includes("VE") || (restriction.blocked ?? []).length >= 100;
};

const onlyLive = [...liveByKey.keys()].filter((id) => !nextByKey.has(id));
const onlyNext = [...nextByKey.keys()].filter((id) => !liveByKey.has(id));
const onlyLiveOnAir = onlyLive.filter((id) => !offAir(liveByKey.get(id)!));
const perVideo = (keys: string[], from: Map<string, Item>) => {
  const groups = new Map<string, number>();
  for (const id of keys) { const videoId = from.get(id)!.videoId; groups.set(videoId, (groups.get(videoId) ?? 0) + 1); }
  return [...groups].sort((a, b) => b[1] - a[1]).map(([videoId, pieces]) => ({ videoId, pieces, artist: from.get(keys.find((id) => id.startsWith(`${videoId}:`))!)?.["artist"], album: from.get(keys.find((id) => id.startsWith(`${videoId}:`))!)?.["album"] }));
};

const fields = ["title", "artist", "album", "year", "trackNumber", "durationSeconds", "albumId", "albumType", "genres", "regionRestriction"];
const differences: Record<string, number> = {};
const examples: Record<string, unknown[]> = {};
for (const [id, a] of liveByKey) {
  const b = nextByKey.get(id);
  if (!b) continue;
  for (const field of fields) {
    if (JSON.stringify(a[field]) === JSON.stringify(b[field])) continue;
    differences[field] = (differences[field] ?? 0) + 1;
    const bucket = examples[field] ??= [];
    if (bucket.length < 5) bucket.push({ id, vivo: a[field], nuevo: b[field] });
  }
}
const common = (items: Item[], other: Map<string, Item>): string[] => items.filter((item) => other.has(key(item))).map(key);
const sameRelativeOrder = common(live.items, nextByKey).join() === common(next.items, liveByKey).join();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crv-radio-compare-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
function station(name: string, source: string): RadioStation {
  const folder = path.join(dir, name);
  fs.mkdirSync(folder);
  const catalogPath = path.join(folder, "catalog.json");
  fs.copyFileSync(source, catalogPath);
  return {
    catalogPath, stationName: "CRV", crossfadeSeconds: 4, epochMs: Date.parse("2026-09-07T19:09:18.774Z"),
    sweeper: { src: "radio/sweeper-v2.wav", durationSeconds: 13.404422, overlapSeconds: 6, leadSeconds: 6, everyPieces: 3 },
  };
}
const start = Date.now();
const timeline = (target: RadioStation) => {
  resetRadioEngineForTests();
  const inspection = inspectCatalog(target);
  const played = Array.from({ length: samples }, (_, index) => {
    const snapshot = radioSnapshot(target, start + index * 197_000, 0, { country: "VE" });
    return snapshot ? `${snapshot.current.videoId}:${snapshot.current.startSeconds}` : null;
  });
  return { inspection, played };
};
const a = timeline(station("vivo", livePath));
const b = timeline(station("nuevo", nextPath));
const sameInstant = a.played.filter((value, index) => value !== null && value === b.played[index]).length;
const sameProgram = a.inspection.version !== null && a.inspection.version === b.inspection.version;

const report = {
  vivo: { path: livePath, piezas: live.items.length, videos: new Set(live.items.map((item) => item.videoId)).size, alAire: a.inspection.playable, huella: a.inspection.version, error: a.inspection.error },
  nuevo: { path: nextPath, piezas: next.items.length, videos: new Set(next.items.map((item) => item.videoId)).size, alAire: b.inspection.playable, huella: b.inspection.version, error: b.inspection.error },
  mismaProgramacion: sameProgram,
  mismoOrdenRelativo: sameRelativeOrder,
  instantesIguales: { iguales: sameInstant, de: samples },
  soloVivo: { piezas: onlyLive.length, alAire: onlyLiveOnAir.length, porVideo: perVideo(onlyLive, liveByKey) },
  soloNuevo: { piezas: onlyNext.length, porVideo: perVideo(onlyNext, nextByKey) },
  camposDistintos: differences,
  ejemplos: examples,
};
if (option("--informe")) fs.writeFileSync(option("--informe")!, `${JSON.stringify(report, null, 2)}\n`);
console.log(`vivo:  ${report.vivo.piezas} piezas, ${report.vivo.videos} videos, ${report.vivo.alAire} al aire, huella ${report.vivo.huella}`);
console.log(`nuevo: ${report.nuevo.piezas} piezas, ${report.nuevo.videos} videos, ${report.nuevo.alAire} al aire, huella ${report.nuevo.huella}`);
console.log(`misma programación: ${sameProgram ? "SÍ" : "NO"} · mismo orden relativo: ${sameRelativeOrder ? "SÍ" : "NO"} · instantes iguales: ${sameInstant}/${samples}`);
console.log(`solo vivo: ${onlyLive.length} piezas (${onlyLiveOnAir.length} al aire) · solo nuevo: ${onlyNext.length} piezas`);
for (const row of report.soloVivo.porVideo.slice(0, 10)) console.log(`  - ${row.videoId} ${row.pieces} ${String(row.artist)} — ${String(row.album)}`);
for (const row of report.soloNuevo.porVideo.slice(0, 10)) console.log(`  + ${row.videoId} ${row.pieces} ${String(row.artist)} — ${String(row.album)}`);
console.log(`campos distintos en piezas comunes: ${JSON.stringify(differences)}`);
process.exitCode = sameProgram ? 0 : 1;
