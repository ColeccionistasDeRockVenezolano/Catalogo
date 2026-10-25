/**
 * Fusiona duplicados detectados al importar MP3.com 2003 (el alta creó una ficha
 * nueva que en realidad ya existía con otro nombre).
 *
 * Uso: tsx scripts/mp3com-dedupe.mts <pares.json> [--confirm]
 *   pares.json: [{ "keepId": 74, "dropId": 7665, "motivo": "..." }]
 *
 * Camino: previewEntityMerge (hash) → mergeEntities en un run reversible
 * (`crv runs undo <id>`). El nombre descartado queda como alias.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getPool } from "../src/db/client.js";
import { previewEntityMerge, mergeEntities } from "../src/merge/entity-merge.js";
import { withOperatorRun } from "../src/merge/operator.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env["MP3COM_OUT"] ?? path.join(process.env["HOME"] ?? ROOT, "crv-staging/reports/mp3com-2003");
const file = process.argv[2];
const CONFIRM = process.argv.includes("--confirm");
if (!file) throw new Error("uso: mp3com-dedupe.mts <pares.json> [--confirm]");

interface Pair { keepId: number; dropId: number; motivo: string }
const pairs = JSON.parse(readFileSync(file, "utf8")) as Pair[];

const pool = getPool();
const hechos: unknown[] = [];
for (const p of pairs) {
  const client = await pool.connect();
  try {
    const preview = await previewEntityMerge(client, "artist", p.keepId, p.dropId, { lock: true });
    console.log(`#${p.keepId} «${preview.keep.name}» ← #${p.dropId} «${preview.drop.name}»: ` +
      `conflictos=${preview.fieldConflicts.map((f) => f.field).join(",") || "ninguno"} ` +
      `al=+${preview.aliasesToAdd.length} recomendado=${preview.recommendedKeepId} avisos=${preview.warnings.join("; ") || "-"}`);
    if (!CONFIRM) { hechos.push({ ...p, previewHash: preview.previewHash, keep: preview.keep.name, drop: preview.drop.name, conflictos: preview.fieldConflicts.map((f) => f.field) }); continue; }
  } finally { client.release(); }

  const { runId } = await withOperatorRun({
    name: `hermes:mp3com-dedupe #${p.keepId}←#${p.dropId}`,
    operator: "hermes (delegado por Brian)",
    note: `Fusión de duplicado detectado al importar MP3.com 2003: ${p.motivo}`,
  }, async (context) => {
    const preview = await previewEntityMerge(context.client, "artist", p.keepId, p.dropId, { lock: true });
    const res = await mergeEntities(context, {
      kind: "artist", keepId: p.keepId, dropId: p.dropId,
      previewHash: preview.previewHash, keepDropNameAsAlias: true,
    });
    return res;
  });
  hechos.push({ ...p, runId });
  console.log(`  fusionado en run ${runId} (reversible: crv runs undo ${runId})`);
}

writeFileSync(path.join(OUT, `dedupe-${CONFIRM ? "aplicado" : "preview"}.json`), JSON.stringify(hechos, null, 1));
await closeDb();
