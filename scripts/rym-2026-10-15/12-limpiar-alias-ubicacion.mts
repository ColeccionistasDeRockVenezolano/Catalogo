// Campaña RYM 2026-10-15 · FASE 12: retira los alias-ubicación que la fase 06 escribió por error.
//
// Criterio (semántico, no por lote): un alias de un artista se retira SOLO si su valor coincide
// (normalizado) con el campo «Currently» de una ficha de RYM de ESE MISMO artista y el artista ya
// tiene el dato en `artists.current_city`/`current_country` (migración 0083, backfill de la fase 11).
// Los alias que no se pueden atribuir con seguridad NO se tocan: se informan como dudosos.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/12-limpiar-alias-ubicacion.mts [--confirm]
//      [--v4=…] [--dir=…]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deleteAlias } from "../../src/api/repositories/aliases.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

const argumento = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const DIR = argumento("--dir") ?? "reports/rym-2026-10-15";
const V4 = argumento("--v4") ?? "reports/rym-v4-2026-10-04/artistas.jsonl";
const confirm = process.argv.includes("--confirm");

interface Ficha { slug: string; nombre: string; info: Record<string, string> }

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

async function main(): Promise<void> {
  if (!existsSync(V4)) { console.error(`falta ${V4}`); process.exit(1); }
  const fichas = readFileSync(V4, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ficha);

  const pool = getPool();
  const artistas = new Map<number, { id: number; name: string; current_city: string | null; current_country: string | null }>();
  for (const r of (await pool.query<{ id: string; name: string; current_city: string | null; current_country: string | null }>(
    "SELECT id::text AS id, name, current_city, current_country FROM public.artists")).rows) {
    artistas.set(Number(r.id), { ...r, id: Number(r.id) });
  }
  const porNombre = new Map<string, number[]>();
  const sumar = (clave: string, id: number) => porNombre.set(clave, [...(porNombre.get(clave) ?? []), id]);
  for (const a of artistas.values()) sumar(normalizar(a.name), a.id);
  for (const r of (await pool.query<{ artist_id: string; alias: string }>("SELECT artist_id::text AS artist_id, alias FROM ingest.artist_aliases WHERE is_primary IS NOT TRUE")).rows) {
    sumar(normalizar(r.alias), Number(r.artist_id));
  }
  // El nombre exacto manda cuando es único (los «Also Known As» recíprocos de RYM duplican el mapeo).
  const porNombreExacto = new Map<string, number[]>();
  for (const a of artistas.values()) porNombreExacto.set(normalizar(a.name), [...(porNombreExacto.get(normalizar(a.name)) ?? []), a.id]);
  const fichaDe = (nombre: string): number[] => {
    const exacto = porNombreExacto.get(normalizar(nombre)) ?? [];
    return exacto.length === 1 ? exacto : [...new Set(porNombre.get(normalizar(nombre)) ?? [])];
  };

  // artistId → valores «Currently» de sus fichas (mapeo único). Fichas sin mapeo: aparte.
  const porArtista = new Map<number, Set<string>>();
  const fichasSinMapeo: Array<{ artista: string; valor: string; motivo: string }> = [];
  for (const f of fichas) {
    const valor = (f.info?.["Currently"] ?? "").replace(/\s+/gu, " ").trim();
    if (!valor) continue;
    const ids = fichaDe(f.nombre ?? "");
    if (ids.length !== 1) { fichasSinMapeo.push({ artista: f.nombre, valor, motivo: ids.length === 0 ? "artista sin ficha" : "artista ambiguo" }); continue; }
    const id = ids[0]!;
    porArtista.set(id, new Set([...(porArtista.get(id) ?? []), normalizar(valor)]));
  }

  const aBorrar: Array<{ id: number; artistId: number; artista: string; alias: string }> = [];
  const sinDato: Array<{ artista: string; alias: string; motivo: string }> = [];
  for (const r of (await pool.query<{ id: string; artist_id: string; alias: string }>(
    "SELECT id::text AS id, artist_id::text AS artist_id, alias FROM ingest.artist_aliases")).rows) {
    const artistId = Number(r.artist_id);
    const clave = normalizar(r.alias);
    const valores = porArtista.get(artistId);
    if (!valores?.has(clave)) continue;
    const a = artistas.get(artistId)!;
    if (!a.current_city && !a.current_country) { sinDato.push({ artista: a.name, alias: r.alias, motivo: "la ficha tiene el valor pero el artista aún no tiene current_city/current_country (¿backfill pendiente?)" }); continue; }
    aBorrar.push({ id: Number(r.id), artistId, artista: a.name, alias: r.alias });
  }

  console.log(`alias-ubicación atribuibles con dato ya en el campo nuevo: ${aBorrar.length}`);
  console.log(`fichas sin mapeo único (no se tocan): ${fichasSinMapeo.length}`);
  console.log(`alias que coinciden con la ficha pero el campo nuevo está vacío (no se tocan): ${sinDato.length}`);

  if (!confirm) {
    writeFileSync(path.join(DIR, "ubicacion-alias-limpieza-ensayo.json"), JSON.stringify({ aBorrar: aBorrar.slice(0, 300), total: aBorrar.length, fichasSinMapeo, sinDato }, null, 1));
    console.log("dry-run: muestra en ubicacion-alias-limpieza-ensayo.json; luego --confirm");
    await closeDb();
    return;
  }

  const { runId, result } = await withOperatorRun({
    name: "hermes:rym-ubicacion-alias-limpieza",
    operator: "hermes (encargo de Brian 2026-10-16)",
    note: "Retira de ingest.artist_aliases los alias que son la UBICACIÓN ACTUAL de las fichas de RYM (error de la fase 06 del lote 2026-10-15: leyó «Currently» como alias). El dato queda en artists.current_city/current_country (run de la fase 11). Solo se borra el alias cuyo valor coincide con el «Currently» de la ficha del propio artista.",
  }, async (context) => {
    let borrados = 0;
    for (const a of aBorrar) { await deleteAlias(context, "artist", a.artistId, a.id); borrados++; }
    return { borrados };
  });

  writeFileSync(path.join(DIR, `ubicacion-alias-limpieza-run${runId}.json`), JSON.stringify({ runId, borrados: result.borrados, fichasSinMapeo, sinDato, aBorrar }, null, 1));
  console.log(`run ${runId}: ${result.borrados} alias retirados · informe ubicacion-alias-limpieza-run${runId}.json`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
