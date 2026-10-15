// Corrección 2 de nombres cruzados (2026-10-15): las 5 «bandas nuevas» de la fase B que en
// realidad ya estaban en el catálogo con el OTRO nombre (el catálogo tiene el nombre antiguo o el
// nuevo y MA el complementario; los alias ya estaban registrados en las fichas buenas).
//
//   Beheaded(#6976)        → Behated Reign(#931)     · disco «Gates of Suffering» (2013)
//   6Sonar(#6980)          → Sexto Sonar(#971)       · disco «Everlasting» (2014)
//   Transgresor(#6981)     → Neon Genesis(#3050)     · disco «Destructive Thrash» (2008)
//   Desperatio Dei(#6982)  → Nox Desperatio(#730)    · disco «Desperatio Dei» (2024)
//   Daemonhorn(#6985)      → Theurgia(#895)          · disco «Black Icon Demonized» (2006)
//
// Ninguno de esos 5 discos existe en la ficha buena → se reatribuyen (parentId), conservando pistas,
// portada y auditoría. Los temas que falten en la ficha buena se completan (nunca se pisan). Las
// fichas creadas se retiran. Uso: tsx scripts/nombres-cruzados-fix2-2026-10-15.ts [--confirm]
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { deleteEntity, updateEntity, withOperatorRun } from "../src/merge/operator.js";

const ROOT = process.cwd();
const DIR = "reports/myspace-2026-10-15";
const CONFIRM = process.argv.includes("--confirm");

const CASOS = [
  { nueva: "Beheaded", idNueva: 6976, idBuena: 931, buena: "Behated Reign" },
  { nueva: "6Sonar", idNueva: 6980, idBuena: 971, buena: "Sexto Sonar" },
  { nueva: "Transgresor", idNueva: 6981, idBuena: 3050, buena: "Neon Genesis" },
  { nueva: "Desperatio Dei", idNueva: 6982, idBuena: 730, buena: "Nox Desperatio" },
  { nueva: "Daemonhorn", idNueva: 6985, idBuena: 895, buena: "Theurgia" },
];

async function main(): Promise<void> {
  const pool = getPool();
  const plan: Array<Record<string, unknown>> = [];
  for (const caso of CASOS) {
    const nueva = (await pool.query<{ name: string; themes: string | null }>(
      "SELECT name, themes FROM public.artists WHERE id=$1", [caso.idNueva])).rows[0];
    if (!nueva) { console.log(`${caso.nueva}: la ficha #${caso.idNueva} ya no existe (nada que hacer)`); continue; }
    const buena = (await pool.query<{ name: string; themes: string | null }>(
      "SELECT name, themes FROM public.artists WHERE id=$1", [caso.idBuena])).rows[0];
    const albumes = (await pool.query<{ id: string; title: string }>(
      "SELECT id::text, title FROM public.albums WHERE artist_id=$1 ORDER BY id", [caso.idNueva])).rows;
    plan.push({ ...caso, discos: albumes.map((a) => ({ id: a.id, title: a.title })),
      temasNueva: nueva.themes, temasBuena: buena?.themes ?? null });
    console.log(`${caso.nueva} (#${caso.idNueva}) → ${caso.buena} (#${caso.idBuena}): ${albumes.length} discos a reatribuir · temas: ${nueva.themes ?? "—"} → ${buena?.themes ?? "—"}`);
  }
  writeFileSync(path.join(ROOT, DIR, "nombres-cruzados-fix2-plan.json"), JSON.stringify(plan, null, 1));
  if (!CONFIRM) { console.log("vista previa: repite con --confirm"); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:nombres-cruzados-fix2",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Corrección de 5 fichas creadas con el otro nombre de bandas ya presentes en el catálogo (los alias estaban registrados): discos reatribuidos a la ficha buena y tema de las letras completado donde faltaba.",
    params: { casos: plan.length },
  }, async (context) => {
    const detalle: Array<Record<string, unknown>> = [];
    for (const paso of plan) {
      let movidos = 0, temas = false;
      for (const disco of paso["discos"] as Array<{ id: string; title: string }>) {
        await updateEntity(context, "album", Number(disco.id), {}, { parentId: paso["idBuena"] as number });
        movidos++;
      }
      if (!paso["temasBuena"] && paso["temasNueva"]) {
        await updateEntity(context, "artist", paso["idBuena"] as number, { themes: paso["temasNueva"] as string });
        temas = true;
      }
      await deleteEntity(context, "artist", paso["idNueva"] as number);
      detalle.push({ nueva: paso["nueva"], buena: paso["buena"], movidos, temas });
      console.log(`${paso["nueva"]}: ${movidos} discos reatribuidos a ${paso["buena"]}${temas ? " · temas completados" : ""}`);
    }
    return { detalle };
  });

  let archivos = 0;
  for (const paso of plan) {
    for (const ext of ["jpg", "webp", "png", "gif"]) {
      for (const sufijo of ["", "-logo"]) {
        const f = path.join(ROOT, "web", "public", "media", "artist", `${paso["idNueva"] as number}${sufijo}.${ext}`);
        if (existsSync(f)) { rmSync(f); archivos++; }
      }
    }
  }
  writeFileSync(path.join(ROOT, DIR, "nombres-cruzados-fix2-aplicado.json"), JSON.stringify({ run: runId, result, archivos }, null, 1));
  console.log(`run ${runId} · ${archivos} archivos huérfanos`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
