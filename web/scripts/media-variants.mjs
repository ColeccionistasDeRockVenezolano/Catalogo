// Pregenera las copias optimizadas de web/public/media (ver media-variants.mjs)
// para que ninguna visita reciba el original pesado mientras se crea su copia.
// Solo encarga lo que falta o quedó viejo: se puede relanzar cuando se quiera.
//
// Uso:
//   npm run media:variants -- [--widths 160,320,640,1200] [--jobs 4] [--limit N] [--dry-run]
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { MEDIA_WIDTHS, OPTIMIZABLE_EXTENSIONS, mediaRoot, optimizerAvailable, optimizerCommand, runOptimizer, variantPath } from "../media-variants.mjs";

const CHUNK = 200;

function arg(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const widths = (arg("--widths") ?? MEDIA_WIDTHS.join(",")).split(",").map(Number);
const unknown = widths.filter((width) => !MEDIA_WIDTHS.includes(width));
if (unknown.length) throw new Error(`anchos no servidos por el gateway: ${unknown.join(", ")} (válidos: ${MEDIA_WIDTHS.join(", ")})`);
const jobs = Number(arg("--jobs") ?? "4");
const limit = Number(arg("--limit") ?? "Infinity");
const dryRun = process.argv.includes("--dry-run");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && OPTIMIZABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

const orders = [];
let fresh = 0;
for await (const file of walk(mediaRoot)) {
  const source = await stat(file);
  for (const width of widths) {
    const dst = variantPath(path.relative(mediaRoot, file), width);
    const current = await stat(dst).catch(() => null);
    if (current && current.mtimeMs >= source.mtimeMs) fresh++;
    else orders.push({ src: file, dst, max_side: width });
  }
  if (orders.length >= limit) break;
}
const todo = orders.slice(0, limit);
console.log(`Copias al día: ${fresh} · por generar: ${todo.length} (anchos ${widths.join(", ")})`);
if (dryRun || todo.length === 0) process.exit(0);
if (!(await optimizerAvailable())) throw new Error(`no se encontró el optimizador: ${optimizerCommand} (CRV_MEDIA_OPTIMIZER)`);

const started = Date.now();
let done = 0, failed = 0, sourceBytes = 0, outBytes = 0;
for (let at = 0; at < todo.length; at += CHUNK) {
  const { unanswered, error } = await runOptimizer(todo.slice(at, at + CHUNK), {
    jobs,
    timeoutMs: 60 * 60_000,
    onResult: (result) => {
      if (result.ok) {
        done++;
        sourceBytes += result.source_bytes;
        outBytes += result.bytes;
      } else {
        failed++;
        console.error(`  ✗ ${path.relative(mediaRoot, result.src ?? "")}: ${result.error}`);
      }
    },
  });
  failed += unanswered.length;
  if (error) console.error(`  ${error.message}`);
  const elapsed = (Date.now() - started) / 1000;
  const pace = (done + failed) / Math.max(1, elapsed);
  const left = todo.length - done - failed;
  console.log(`  ${done + failed}/${todo.length} · ${failed} con error · `
    + `${(sourceBytes / 1048576).toFixed(0)} MB → ${(outBytes / 1048576).toFixed(0)} MB · `
    + `quedan ~${Math.ceil(left / Math.max(pace, 0.01) / 60)} min`);
}
console.log(`Listo: ${done} copias en ${((Date.now() - started) / 60000).toFixed(1)} min, ${failed} con error.`);
process.exitCode = failed > 0 && done === 0 ? 1 : 0;
