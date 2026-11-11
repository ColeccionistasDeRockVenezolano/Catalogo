// Lee los registros existentes; no consulta YouTube ni cambia la emisión.
//   npm exec -- tsx scripts/radio-quality-report.ts --log-dir=/mnt/datos/crv-radio/logs [--since=2026-11-10T00:00:00Z]
import fs from "node:fs";
import path from "node:path";
import { RADIO_DIAGNOSTICS_FILE, summarizeRadioQuality } from "../src/api/radio/diagnostics.js";

const option = (name: string): string | undefined => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const logDir = option("log-dir") ?? process.env["CRV_RADIO_LOG_DIR"] ?? "logs";
const since = option("since");
if (since && !Number.isFinite(Date.parse(since))) throw new Error("--since debe ser una fecha ISO con zona horaria.");
const entries: Array<Record<string, unknown>> = [];
for (const suffix of [".1", ""]) {
  const file = path.join(logDir, RADIO_DIAGNOSTICS_FILE + suffix);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (since && Date.parse(String(entry["receivedAt"])) < Date.parse(since)) continue;
      entries.push(entry);
    } catch { /* línea cortada durante una rotación */ }
  }
}
console.log(JSON.stringify({ files: logDir, since: since ?? null, groups: summarizeRadioQuality(entries) }, null, 2));
