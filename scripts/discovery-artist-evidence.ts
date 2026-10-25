import { readFile } from "node:fs/promises";
import { recordArtistEvidence } from "../src/discovery/artist-evidence.js";
import { closeDb } from "../src/db/client.js";
const file = process.argv[2];
if (!file) throw new Error("Uso: discovery-artist-evidence.ts archivo.json [--apply] (por defecto: vista previa sin escrituras)");
try { console.log(JSON.stringify(await recordArtistEvidence(JSON.parse(await readFile(file, "utf8")), process.argv.includes("--apply")), null, 2)); }
finally { await closeDb(); }
