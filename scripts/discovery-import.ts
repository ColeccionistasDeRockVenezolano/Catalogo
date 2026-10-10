import { readFile } from "node:fs/promises";
import { importDiscoveryBatch } from "../src/discovery/curation.js";
import { closeDb } from "../src/db/client.js";
const file = process.argv[2];
if (!file) throw new Error("Uso: discovery-import.ts archivo.json [--apply] (por defecto: vista previa sin escrituras)");
try { console.log(JSON.stringify(await importDiscoveryBatch(JSON.parse(await readFile(file, "utf8")), process.argv.includes("--apply")), null, 2)); }
finally { await closeDb(); }
