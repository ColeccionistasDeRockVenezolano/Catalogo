// CRV · copia los estáticos sueltos de `public/` al build, sin `media/`.
//
// Por qué existe: `public/media` es un enlace al almacén de 1 TB con 19.586
// imágenes (2 GB). Vite copia `publicDir` completo en cada build y eso ataba la
// publicación al disco de giro: el mismo build tardaba 1m39s con la caché
// caliente y 9m5s con el HDD ocupado (deploy del 2026-10-22). Además dejaba una
// segunda copia muerta de las imágenes dentro de `dist-public/media`.
//
// `server.mjs` ya sirve `/crv/media/*` directamente desde `public/media`
// (ver `serveFile`), así que el build no necesita ninguna copia de `media`.
// Aquí se copian solo los archivos sueltos de la raíz de `public/`
// (favicon, logo…) para que el gateway los siga encontrando en `dist-public`.
//
//   uso: node scripts/copy-public-root.mjs <outDir>
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXCLUDED = new Set(["media"]);

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv[2];
if (!outArg) {
  console.error("falta el directorio de salida (p. ej. dist-public)");
  process.exit(1);
}
const outDir = path.resolve(directory, outArg);
const publicDir = path.join(directory, "public");

const entries = await readdir(publicDir, { withFileTypes: true });
await mkdir(outDir, { recursive: true });
let copied = 0;
for (const entry of entries) {
  if (EXCLUDED.has(entry.name)) continue;
  await cp(path.join(publicDir, entry.name), path.join(outDir, entry.name), { recursive: true });
  copied += 1;
}
console.log(`  estáticos de public/ copiados a ${path.relative(directory, outDir)}: ${copied} (media/ se sirve desde el almacén)`);
