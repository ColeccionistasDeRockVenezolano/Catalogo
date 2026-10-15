// Limpieza del falso positivo «Gillman» (2026-10-15).
//
// El hueco de Metal Archives marcó «Gillman» (banda, MA 7312) como sin ficha, pero el catálogo YA
// modela su discografía bajo el solista «Paul Gillman» (#1951, solo_artist, 27 discos): 17 de los
// 22 discos creados son duplicados exactos y los 5 fallidos chocaron justamente con los álbumes
// existentes. Se retira la ficha creada (#6983) con el camino sancionado: deleteEntity (pistas →
// discos → artista) en un run del operador; cada retiro guarda su snapshot en la auditoría.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/limpiar-gillman-2026-10-15.ts [--confirm]
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { deleteEntity, withOperatorRun } from "../src/merge/operator.js";

const ROOT = process.cwd();
const DIR = "reports/myspace-2026-10-15";
const ARTISTA = 6983;
const CONFIRM = process.argv.includes("--confirm");

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

async function main(): Promise<void> {
  const pool = getPool();
  const artista = (await pool.query<{ name: string; artist_type: string }>(
    "SELECT name, artist_type::text FROM public.artists WHERE id=$1", [ARTISTA])).rows[0];
  if (!artista) { console.log(`el artista ${ARTISTA} no existe: nada que limpiar`); await closeDb(); return; }
  const albumes = (await pool.query<{ id: string; title: string }>(
    "SELECT id::text, title FROM public.albums WHERE artist_id=$1 ORDER BY id", [ARTISTA])).rows;
  const pistas = (await pool.query<{ id: string }>(
    "SELECT t.id::text FROM public.tracks t JOIN public.albums al ON al.id=t.album_id WHERE al.artist_id=$1", [ARTISTA])).rows;
  const otros = (await pool.query<{ title: string }>("SELECT title FROM public.albums WHERE artist_id=1951")).rows;
  const claves = new Set(otros.map((o) => norm(o.title)));
  const duplicados = albumes.filter((a) => claves.has(norm(a.title)));

  console.log(`a retirar: artista ${ARTISTA} «${artista.name}» (${artista.artist_type}) · ${albumes.length} discos · ${pistas.length} pistas`);
  console.log(`duplicados exactos contra Paul Gillman (#1951, ${otros.length} discos): ${duplicados.length}`);
  const soloAqui = albumes.filter((a) => !claves.has(norm(a.title)));
  console.log(`discos que NO están en #1951 (candidatos futuros bajo esa ficha): ${soloAqui.map((a) => a.title).join(" · ")}`);

  const report: Record<string, unknown> = { artista, albumes: albumes.length, pistas: pistas.length, duplicados: duplicados.map((d) => d.title), soloAqui: soloAqui.map((s) => s.title) };
  if (!CONFIRM) { console.log("vista previa: repite con --confirm"); writeFileSync(path.join(ROOT, DIR, "limpieza-gillman.json"), JSON.stringify(report, null, 1)); await closeDb(); return; }

  const { runId } = await withOperatorRun({
    name: "hermes:limpiar-gillman-duplicado",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Retiro de la ficha «Gillman» (#6983) creada por el cierre del hueco de Metal Archives: la discografía ya está en el catálogo bajo el solista «Paul Gillman» (#1951); 17 de los 22 discos eran duplicados exactos.",
    params: { artista: ARTISTA, albumes: albumes.length },
  }, async (context) => {
    let nPistas = 0, nAlbumes = 0;
    for (const album of albumes) {
      const suyas = await context.client.query<{ id: string }>("SELECT id::text FROM public.tracks WHERE album_id=$1 ORDER BY id", [Number(album.id)]);
      for (const t of suyas.rows) { await deleteEntity(context, "track", Number(t.id)); nPistas++; }
      await deleteEntity(context, "album", Number(album.id));
      nAlbumes++;
    }
    await deleteEntity(context, "artist", ARTISTA);
    return { nPistas, nAlbumes };
  });

  // archivos huérfanos (portadas de esos discos y foto/logo del artista)
  let borrados = 0;
  for (const album of albumes) {
    for (const ext of ["jpg", "webp", "png", "gif"]) {
      const f = path.join(ROOT, "web", "public", "media", "album", `${album.id}.${ext}`);
      if (existsSync(f)) { rmSync(f); borrados++; }
    }
  }
  for (const ext of ["jpg", "webp", "png", "gif"]) {
    for (const sufijo of ["", "-logo"]) {
      const f = path.join(ROOT, "web", "public", "media", "artist", `${ARTISTA}${sufijo}.${ext}`);
      if (existsSync(f)) { rmSync(f); borrados++; }
    }
  }
  report["run"] = runId; report["archivosBorrados"] = borrados;
  writeFileSync(path.join(ROOT, DIR, "limpieza-gillman.json"), JSON.stringify(report, null, 1));
  console.log(`run ${runId}: retirados ${albumes.length} discos, ${pistas.length} pistas y el artista · ${borrados} archivos huérfanos`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
