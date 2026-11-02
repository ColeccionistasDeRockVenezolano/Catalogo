// CRV · Comparación directa de motores de radio (Fase 3).
//
// La sombra solo mira el instante presente en el país por defecto. Esto carga el
// motor real de Herra y el de CRV sobre el mismo catálogo y compara las
// instantáneas completas en muchos instantes y países, incluidos los relevos,
// la cuña, los rellenos por veto y el cambio de catálogo a mitad de pieza.
// No toca la red ni ninguna base: trabaja sobre copias en una carpeta temporal.
//
//   tsx scripts/radio-differential.mts --herra <dist de Herra> --catalog <catálogo> [--samples 4000]
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { radioSnapshot, resetRadioEngineForTests, type RadioStation } from "../src/shared/radio/engine.js";

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const herraDist = arg("--herra");
const catalogSource = arg("--catalog");
const samples = Number(arg("--samples") ?? "4000");
if (!herraDist || !catalogSource) {
  console.error("uso: --herra <dist> --catalog <catálogo> [--samples N]");
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crv-radio-diff-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
const catalogPath = path.join(dir, "catalog.json");
const source = JSON.parse(fs.readFileSync(catalogSource, "utf8")) as { items: Array<Record<string, unknown>>; regionPolicy?: unknown };
// Vetos sintéticos: el catálogo real casi no tiene, y sin ellos el relleno no se ejercita.
const items = source.items.map((item, index) => index % 7 === 0
  ? { ...item, regionRestriction: { blocked: ["US", "DE", "ES"] } }
  : index % 31 === 0 ? { ...item, regionRestriction: { blocked: ["CO"] } } : item);
fs.writeFileSync(catalogPath, JSON.stringify({ ...source, items, regionPolicy: source.regionPolicy ?? { homeRegions: ["VE"], worldwideRegions: 100 } }));
const genresSource = `${catalogSource}.genres.json`;
if (fs.existsSync(genresSource)) fs.copyFileSync(genresSource, `${catalogPath}.genres.json`);

const shared = {
  crossfadeSeconds: 4,
  catalogPath,
  epochMs: Date.parse("2026-09-07T19:09:18.774Z"),
  stationName: "CRV",
  sweeper: { src: "radio/sweeper-v2.wav", durationSeconds: 13.404422, overlapSeconds: 6, leadSeconds: 6, everyPieces: 3 },
};
const herraEnvDir = path.join(dir, "herra");
fs.mkdirSync(herraEnvDir);
process.env["DATA_DIR"] = herraEnvDir;
process.env["LOG_DIR"] = herraEnvDir;
process.env["RADIO_AVAILABILITY_CHECK"] = "false";
const herra = await import(pathToFileURL(path.join(herraDist, "services/radio.service.js")).href) as {
  radioSnapshot(projectId: number, station: unknown, nowMs: number, listener: { country?: string | null }): Record<string, unknown> | null;
  setRadioAvailabilityCheckerForTests(checker: unknown): void;
};
herra.setRadioAvailabilityCheckerForTests(null);
const herraStation = { ...shared, availabilityCheck: false };
const crvStation: RadioStation = { ...shared };

const normalize = (value: Record<string, unknown>): unknown => {
  const copy = { ...value };
  delete copy["listeners"];
  return JSON.parse(JSON.stringify(copy));
};

function compare(nowMs: number, country: string | null, stats: { checks: number; substitutes: number }): void {
  const left = herra.radioSnapshot(1, herraStation, nowMs, { country });
  const right = radioSnapshot(crvStation, nowMs, 0, { country });
  assert.ok(left && right, "un motor no emitió");
  stats.checks += 1;
  if ((right.current as { regionSubstituteFor?: unknown }).regionSubstituteFor) stats.substitutes += 1;
  const expected = normalize(left) as Record<string, unknown>;
  const actual = normalize(right as unknown as Record<string, unknown>) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter((field) => JSON.stringify(expected[field]) !== JSON.stringify(actual[field]));
  if (fields.length > 0) {
    const brief = (value: unknown): string => JSON.stringify(value)?.slice(0, 700) ?? "—";
    throw new Error(`difieren en ${new Date(nowMs).toISOString()} país ${country} tras ${stats.checks} comparaciones: ${fields.map((field) => `\n  ${field}\n    herra ${brief(expected[field])}\n    crv   ${brief(actual[field])}`).join("")}`);
  }
}

const countries = [null, "VE", "US", "DE", "ES", "CO", "XX", "T1", "ve", "BR"];
const stats = { checks: 0, substitutes: 0 };
const base = Date.now();
// Barrido regular: varias semanas hacia adelante, cruzando ciclos.
for (let index = 0; index < samples; index += 1) {
  const nowMs = base + index * 1_237_000 + (index % 13) * 137;
  compare(nowMs, countries[index % countries.length]!, stats);
}
// Relevos: cada frontera de tramo y de cuña, justo antes y justo después.
let cursor = base;
for (let index = 0; index < 300; index += 1) {
  const snapshot = radioSnapshot(crvStation, cursor)!;
  const endsAt = Date.parse(snapshot.endsAt);
  for (const nowMs of [endsAt - 7000, endsAt - 6000, endsAt - 1, endsAt, endsAt + 1, endsAt + 5999, endsAt + 6000]) {
    for (const country of [null, "US", "CO"]) compare(nowMs, country, stats);
  }
  cursor = endsAt + 1;
}
console.log(`barrido y relevos: ${stats.checks} comparaciones iguales, ${stats.substitutes} con relleno`);
assert.ok(stats.substitutes > 100, "el relleno casi no se ejercitó");

// Catálogo nuevo a mitad de pieza: ambos deben terminar la pieza en curso.
const swapAt = cursor;
// Antes de cambiar el archivo: es la pieza que debe terminar con el catálogo anterior.
compare(swapAt, null, stats);
const piece = radioSnapshot(crvStation, swapAt)!;
const swapped = items.filter((_, index) => index % 11 !== 5);
fs.writeFileSync(catalogPath, JSON.stringify({ ...source, items: swapped, regionPolicy: source.regionPolicy ?? { homeRegions: ["VE"], worldwideRegions: 100 } }));
fs.utimesSync(catalogPath, new Date(), new Date(Date.now() + 5000));
let after = 0;
for (const nowMs of [swapAt, swapAt + 1000, Date.parse(piece.endsAt) - 1, Date.parse(piece.endsAt) + 10, Date.parse(piece.endsAt) + 400_000]) {
  for (const country of [null, "US"]) { compare(nowMs, country, stats); after += 1; }
}
console.log(`cambio de catálogo a mitad de pieza: ${after} comparaciones iguales`);
resetRadioEngineForTests();
console.log(`TOTAL ${stats.checks} comparaciones, 0 divergencias`);
process.exit(0);
