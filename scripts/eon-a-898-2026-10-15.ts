// Corrección 4: EON (#6979) también era duplicado. La banda existe en el catálogo como
// «Enlighten Our Nature» (#898, Coro, Falcón, con foto, logo, géneros y el alias «EON» [acronym]
// ya registrado; misma formación: Alexander Pulido, Ronald Lares, Lenin Morales).
// Se reatribuyen sus 2 discos, se añade «Arioth» [former_name] a #898 y se retira #6979.
// Uso: ./scripts/eon-a-898-2026-10-15.ts [--confirm]
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { createAlias } from "../src/api/repositories/aliases.js";
import { deleteEntity, deleteRelation, updateEntity, withOperatorRun } from "../src/merge/operator.js";

const ROOT = process.cwd();
const DIR = "reports/myspace-2026-10-15";
const NUEVA = 6979, BUENA = 898, CONFIRM = process.argv.includes("--confirm");

async function main(): Promise<void> {
  const pool = getPool();
  const albumes = (await pool.query<{ id: string; title: string }>(
    "SELECT id::text, title FROM public.albums WHERE artist_id=$1 ORDER BY id", [NUEVA])).rows;
  console.log(`EON (#${NUEVA}) → Enlighten Our Nature (#${BUENA}): ${albumes.length} discos (${albumes.map((a) => a.title).join(", ")})`);
  if (!CONFIRM) { console.log("vista previa: repite con --confirm"); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:eon-a-enlighten",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "EON es el acrónimo/nombre de Enlighten Our Nature (#898, misma formación y ciudad): discos reatribuidos, membresías duplicadas retiradas (la ficha buena ya las tiene), alias Arioth trasladado y ficha duplicada retirada.",
    params: { nueva: NUEVA, buena: BUENA },
  }, async (context) => {
    let movidos = 0, membresias = 0;
    for (const a of albumes) { await updateEntity(context, "album", Number(a.id), {}, { parentId: BUENA }); movidos++; }
    const filas = await context.client.query<{ id: string }>(
      "SELECT id::text FROM public.artist_members WHERE artist_id=$1 ORDER BY id", [NUEVA]);
    for (const f of filas.rows) { await deleteRelation(context, "artist_membership", Number(f.id)); membresias++; }
    const alias = await createAlias(context, "artist", BUENA, { alias: "Arioth", aliasType: "former_name", isPrimary: false });
    await deleteEntity(context, "artist", NUEVA);
    return { movidos, membresias, alias: alias.alias };
  });

  let archivos = 0;
  for (const ext of ["jpg", "webp", "png", "gif"]) {
    for (const sufijo of ["", "-logo"]) {
      const f = path.join(ROOT, "web", "public", "media", "artist", `${NUEVA}${sufijo}.${ext}`);
      if (existsSync(f)) { rmSync(f); archivos++; }
    }
  }
  writeFileSync(path.join(ROOT, DIR, "eon-a-898-aplicado.json"), JSON.stringify({ run: runId, result, archivos }, null, 1));
  console.log(`run ${runId}: ${result.movidos} discos reatribuidos · alias «${result.alias}» → #${BUENA} · ${archivos} archivos huérfanos`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
