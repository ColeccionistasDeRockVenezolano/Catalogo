// CRV · Indexa capturas del almacén local para la IA del catálogo.
//
// Uso:
//   tsx scripts/index-local-evidence.ts                 # fuentes conocidas
//   tsx scripts/index-local-evidence.ts --source=rym --limit-files=200
//   tsx scripts/index-local-evidence.ts --reset
//
// Es incremental: la clave (source, source_path, artist_key, url) se actualiza,
// no se duplica. El cuerpo se recorta a 2.500 caracteres; el archivo completo
// sigue viviendo en /mnt/1tb/Shared.
import { opendir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { extractRecords, sourceOfPath } from "../src/research/local-evidence-index.js";

const KNOWN_ROOTS = [
  "deep-hippito-2026-10-25", "hippito-y-sus-chatarritas",
  "rym-reviews-2026-10-16", "rym-reviews-2026-10-20", "rym-reviews-938-2026-10-21",
  "rym-reviews-control-2026-10-21", "rym-reviews-correctas-2026-10-21",
  "deep-rhv-com-2026-10-25", "deep-rhv-blogspot-2026-10-25",
  "rockhecho-2026-10-29", "rockhecho-cierre-2026-10-29", "rock-hecho-en-venezuela",
  "discogs-bio", "lastfm-bio", "musicbrainz-bio", "theaudiodb-bio",
  "wikipedia-bio-es", "wikipedia-bio-en", "venciclopedia-bio",
  "aoty-2026-10-19", "bandcamp", "sincopa", "venezuelademo-2026-10-23",
  "metal-archives", "metal-archives-ve-2026-10-01", "source-profiles-2026-10-21",
  "source-profiles-2026-10-21b", "fuentes-web-2026-10-16", "fuentes-web-2026-10-01",
];
const EXTENSIONS = new Set([".json", ".jsonl", ".ndjson", ".csv", ".html", ".htm"]);
const args = process.argv.slice(2);
const sourceFilter = args.find((arg) => arg.startsWith("--source="))?.slice("--source=".length);
const rootFilter = args.find((arg) => arg.startsWith("--root="))?.slice("--root=".length);
const limitFiles = Number(args.find((arg) => arg.startsWith("--limit-files="))?.slice("--limit-files=".length) ?? 0);
const reset = args.includes("--reset");
const roots = (process.env["CRV_LOCAL_EVIDENCE_ROOTS"]?.split(",").map((root) => root.trim()).filter(Boolean) ?? KNOWN_ROOTS)
  .filter((root) => !rootFilter || root.includes(rootFilter))
  .map((root) => resolve("data/raw", root));

async function* files(root: string): AsyncGenerator<string> {
  let dir;
  try { dir = await opendir(root); } catch { return; }
  for await (const entry of dir) {
    if (entry.name.startsWith(".")) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (EXTENSIONS.has(extname(entry.name).toLowerCase())) yield path;
  }
}

interface Row {
  source: string; sourcePath: string; artistName: string | null; artistKey: string;
  title: string | null; url: string | null; body: string; capturedAt: string | null;
}

const rows: Row[] = [];
let read = 0;
let skipped = 0;
for (const root of roots) {
  for await (const path of files(root)) {
    if (sourceFilter && sourceOfPath(path) !== sourceFilter) continue;
    if (limitFiles && read >= limitFiles) break;
    try {
      const info = await stat(path);
      if (info.size > 8 * 1024 * 1024) { skipped += 1; continue; }
      const content = await readFile(path, "utf8");
      const extension = extname(path).toLowerCase();
      const capturedAt: string | null = info.mtime.toISOString();
      let url: string | null = null;
      if (extension === ".html" || extension === ".htm") {
        for (const headerPath of [`${path}.headers.json`, path.replace(/\.html?$/u, ".headers.json")]) {
          try {
            const headers = JSON.parse(await readFile(headerPath, "utf8")) as Record<string, unknown>;
            const candidate = headers["url"] ?? headers["Url"] ?? headers["URL"];
            if (typeof candidate === "string" && /^https?:\/\//u.test(candidate)) { url = candidate; break; }
          } catch { /* captura sin cabeceras */ }
        }
      }
      const records = extractRecords(content, path, extension, capturedAt);
      for (const record of records) {
        rows.push({ ...record, url: record.url ?? url });
      }
      read += 1;
    } catch { skipped += 1; }
  }
  if (limitFiles && read >= limitFiles) break;
}

const unique = new Map<string, Row>();
for (const row of rows) {
  const key = `${row.source}|${row.sourcePath}|${row.artistKey}|${row.url ?? ""}`;
  if (!unique.has(key)) unique.set(key, row);
}
console.error(`archivos leídos=${read} omitidos=${skipped} registros=${unique.size}`);

if (reset) {
  await getPool().query("TRUNCATE ingest.local_evidence RESTART IDENTITY");
  console.error("tabla vaciada");
}
const values = [...unique.values()];
for (let start = 0; start < values.length; start += 300) {
  const chunk = values.slice(start, start + 300);
  const params: unknown[] = [];
  const tuples = chunk.map((row, index) => {
    const base = index * 8;
    params.push(row.source, row.sourcePath, row.artistName, row.artistKey, row.title, row.url, row.body, row.capturedAt);
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
  });
  await getPool().query(`
    INSERT INTO ingest.local_evidence(source,source_path,artist_name,artist_key,title,url,body,captured_at)
    VALUES ${tuples.join(",")}
    ON CONFLICT (source,source_path,artist_key,url) DO UPDATE
      SET artist_name=EXCLUDED.artist_name, title=EXCLUDED.title, body=EXCLUDED.body,
          captured_at=EXCLUDED.captured_at`, params);
}

const { rows: counts } = await getPool().query<{ source: string; n: string }>(
  "SELECT source, count(*)::text AS n FROM ingest.local_evidence GROUP BY source ORDER BY count(*) DESC");
console.log(JSON.stringify({ filesRead: read, skipped, extracted: values.length, indexed: counts }, null, 2));
await closeDb();
