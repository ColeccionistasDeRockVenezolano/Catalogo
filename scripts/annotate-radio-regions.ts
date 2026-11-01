// Anota el catálogo de la Radio CRV (herra) con las restricciones regionales
// de YouTube de cada video y la política de la estación. Ver src/radio/regions.ts.
//
// Corre en el gancho radio-post-export de herra-crv, después de los géneros.
// Si la API falla, no escribe nada: la radio sigue con lo que tenía.
//
//   npm run radio:regions -- /ruta/crv-radio-catalog.json [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { YouTubeDataApi, type YouTubeVideoPayload } from "../src/youtube/api.js";
import { annotateRadioRegions } from "../src/radio/regions.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const requested = args.find((arg) => !arg.startsWith("--")) ?? process.env["CRV_RADIO_CATALOG_PATH"];
  if (!requested) throw new Error("uso: npm run radio:regions -- /ruta/crv-radio-catalog.json [--dry-run]");
  const filePath = path.resolve(requested);
  const original = fs.readFileSync(filePath, "utf8");
  const catalog = JSON.parse(original) as Record<string, unknown>;
  const items = Array.isArray(catalog["items"]) ? catalog["items"] as Array<Record<string, unknown>> : [];
  const videoIds = [...new Set(items.flatMap((item) =>
    typeof item?.["videoId"] === "string" && /^[\w-]{11}$/.test(item["videoId"]) ? [item["videoId"]] : []))];

  const api = new YouTubeDataApi();
  const payloads = new Map<string, YouTubeVideoPayload>();
  for (let offset = 0; offset < videoIds.length; offset += 50) {
    const response = await api.listVideos(videoIds.slice(offset, offset + 50));
    for (const payload of response.items ?? []) payloads.set(payload.id, payload);
  }

  const { catalog: annotated, stats } = annotateRadioRegions(catalog, payloads);
  const summary = `Radio CRV · regiones: ${stats.videos} videos · ${stats.restrictedVideos} con veto regional `
    + `(${stats.restrictedItems} piezas; ${stats.stationExcludedItems} fuera del aire para todos) · `
    + `${stats.missingVideos} sin respuesta de la API`;
  const serialized = JSON.stringify(annotated, null, 2) + "\n";
  if (serialized === original) {
    process.stdout.write(`${summary}; sin cambios, el archivo no se modifica\n`);
    return;
  }
  if (dryRun) {
    process.stdout.write(`${summary}; dry-run, no se escribió\n`);
    return;
  }
  annotated["regionsAnnotatedAt"] = new Date().toISOString();
  const mode = fs.statSync(filePath).mode & 0o777;
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(annotated, null, 2) + "\n", { encoding: "utf8", mode });
  fs.renameSync(temporary, filePath);
  process.stdout.write(`${summary} -> ${filePath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
