// Corrección de los «nombres antiguos» de la fase B (2026-10-15).
//
// La captura de Metal Archives trae en `years_active` la historia de cambios de nombre («… (as
// Dreams of Tears)»). Varias de las bandas que el cierre del hueco creó como nuevas son, en
// realidad, la MISMA banda que el catálogo ya tiene con su nombre actual. Por cada caso:
//   - los discos duplicados (título normalizado igual al de la ficha buena) se retiran con sus pistas;
//   - los discos que no existen en la ficha buena se REATRIBUYEN a ella (parentId) — conservan pistas,
//     portada y auditoría;
//   - el nombre antiguo queda como alias `former_name` de la ficha buena (la búsqueda lo encuentra);
//   - la ficha creada por error se retira al final.
// Todo en un run del operador: retiros con snapshot y reatribuciones con auditoría.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/former-names-fix-2026-10-15.ts [--confirm]
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { createAlias } from "../src/api/repositories/aliases.js";
import { deleteEntity, updateEntity, withOperatorRun } from "../src/merge/operator.js";

const ROOT = process.cwd();
const DIR = "reports/myspace-2026-10-15";
const CONFIRM = process.argv.includes("--confirm");

const CASOS = [
  { nueva: "Lake of Tears", idNueva: 6972, idBuena: 678, buena: "Dreams of Tears" },
  { nueva: "Hodah", idNueva: 6973, idBuena: 661, buena: "Exordium Profanum" },
  { nueva: "Nigrium Mortualia", idNueva: 6974, idBuena: 2160, buena: "Moriturio" },
  { nueva: "Gorepriest", idNueva: 6975, idBuena: 870, buena: "Sol Nocturno" },
  { nueva: "Godless Crown", idNueva: 6977, idBuena: 609, buena: "Godless" },
  { nueva: "Okkvlt", idNueva: 6978, idBuena: 672, buena: "Cthonica" },
  { nueva: "Leviathan A.C.", idNueva: 6984, idBuena: 594, buena: "Leviathan" },
];

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}
function afin(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length > 4 && b.length > 4 && (a.startsWith(b) || b.startsWith(a));
}

async function main(): Promise<void> {
  const pool = getPool();
  const plan: Array<Record<string, unknown>> = [];
  for (const caso of CASOS) {
    const nuevas = (await pool.query<{ id: string; title: string }>(
      "SELECT id::text, title FROM public.albums WHERE artist_id=$1 ORDER BY id", [caso.idNueva])).rows;
    const buenas = (await pool.query<{ id: string; title: string }>(
      "SELECT id::text, title FROM public.albums WHERE artist_id=$1 ORDER BY id", [caso.idBuena])).rows;
    const nb = buenas.map((b) => norm(b.title));
    const dup: string[] = [], mover: string[] = [];
    for (const n of nuevas) {
      (nb.some((b) => afin(b, norm(n.title))) ? dup : mover).push(n.id);
    }
    plan.push({ ...caso, discos: nuevas.length, duplicados: dup, reatribuir: mover, enBuena: buenas.length });
    console.log(`${caso.nueva} (#${caso.idNueva}) → ${caso.buena} (#${caso.idBuena}): ${nuevas.length} discos · ${dup.length} duplicados (retirar) · ${mover.length} a reatribuir · buena tiene ${buenas.length}`);
  }
  writeFileSync(path.join(ROOT, DIR, "former-names-plan.json"), JSON.stringify(plan, null, 1));
  if (!CONFIRM) { console.log("vista previa: repite con --confirm"); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:former-names-fix",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Corrección de fichas creadas con el nombre antiguo (MA) de bandas que el catálogo ya tiene con su nombre actual: discos duplicados retirados, discos nuevos reatribuidos a la ficha buena y nombre antiguo como alias former_name.",
    params: { casos: CASOS.length },
  }, async (context) => {
    const detalle: Array<Record<string, unknown>> = [];
    for (const paso of plan) {
      const idNueva = paso["idNueva"] as number, idBuena = paso["idBuena"] as number;
      let retirados = 0, movidos = 0;
      for (const id of paso["duplicados"] as string[]) {
        const albumId = Number(id);
        const suyas = await context.client.query<{ id: string }>("SELECT id::text FROM public.tracks WHERE album_id=$1 ORDER BY id", [albumId]);
        for (const t of suyas.rows) await deleteEntity(context, "track", Number(t.id));
        await deleteEntity(context, "album", albumId);
        retirados++;
      }
      for (const id of paso["reatribuir"] as string[]) {
        await updateEntity(context, "album", Number(id), {}, { parentId: idBuena });
        movidos++;
      }
      let alias: string;
      try {
        await createAlias(context, "artist", idBuena, { alias: paso["nueva"] as string, aliasType: "former_name", isPrimary: false });
        alias = paso["nueva"] as string;
      } catch (error) {
        alias = `(ya existía: ${(error as Error).message.slice(0, 60)})`;
      }
      await deleteEntity(context, "artist", idNueva);
      detalle.push({ nueva: paso["nueva"], buena: paso["buena"], retirados, movidos, alias });
      console.log(`${paso["nueva"]}: ${retirados} duplicados retirados · ${movidos} discos reatribuidos · alias ${alias}`);
    }
    return { detalle };
  });

  let archivos = 0;
  for (const paso of plan) {
    for (const id of paso["duplicados"] as string[]) {
      for (const ext of ["jpg", "webp", "png", "gif"]) {
        const f = path.join(ROOT, "web", "public", "media", "album", `${id}.${ext}`);
        if (existsSync(f)) { rmSync(f); archivos++; }
      }
    }
    for (const ext of ["jpg", "webp", "png", "gif"]) {
      for (const sufijo of ["", "-logo"]) {
        const f = path.join(ROOT, "web", "public", "media", "artist", `${paso["idNueva"] as number}${sufijo}.${ext}`);
        if (existsSync(f)) { rmSync(f); archivos++; }
      }
    }
  }
  writeFileSync(path.join(ROOT, DIR, "former-names-aplicado.json"), JSON.stringify({ run: runId, result, archivos }, null, 1));
  console.log(`run ${runId} · ${archivos} archivos huérfanos borrados`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
