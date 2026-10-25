// Campaña RYM 2026-10-15 · FASE 11: la ubicación ACTUAL del artista (campo «Currently» de la ficha
// de RYM) al campo propio del core `artists.current_city` / `current_country` (migración 0083,
// undécima excepción al core; pedido de Brian 2026-10-16: «Quiero tener este dato en un campo
// separado asi como RYM, no me gustaria perderlos»).
//
// Por qué existe: la fase 06 leyó «Currently» como si fuera un alias («otro nombre del proyecto») y
// escribió 515 ciudades como name_variant. Este backfill recupera el valor REAL de las fichas
// capturadas (reports/rym-v4-2026-10-04/artistas.jsonl), lo reparte en ciudad/país y lo guarda en
// el campo nuevo. Solo huecos: no pisa un valor ya presente. Los casos sin mapeo único o sin forma
// de ubicación NO se aplican y salen en el informe de dudosos.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/11-ubicacion-actual.mts [--confirm]
//      [--v4=…] [--dir=…] [--limit=N]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { updateEntity, withOperatorRun } from "../../src/merge/operator.js";

const argumento = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const DIR = argumento("--dir") ?? "reports/rym-2026-10-15";
const V4 = argumento("--v4") ?? "reports/rym-v4-2026-10-04/artistas.jsonl";
const confirm = process.argv.includes("--confirm");
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);

interface Ficha { slug: string; nombre: string; info: Record<string, string> }

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

// Países (inglés, como los escribe RYM, y español; sin tildes por la normalización).
const PAISES = new Set([
  "venezuela", "usa", "united states", "estados unidos", "uk", "united kingdom", "reino unido", "england", "scotland", "wales",
  "spain", "espana", "mexico", "colombia", "argentina", "chile", "peru", "cuba", "ecuador", "bolivia", "uruguay", "paraguay",
  "panama", "costa rica", "nicaragua", "honduras", "guatemala", "el salvador", "dominican republic", "republica dominicana",
  "puerto rico", "aruba", "curacao", "brazil", "brasil", "canada", "france", "francia", "germany", "alemania", "italy", "italia",
  "portugal", "netherlands", "paises bajos", "belgium", "belgica", "austria", "switzerland", "suiza", "sweden", "suecia",
  "norway", "noruega", "denmark", "dinamarca", "finland", "finlandia", "ireland", "irlanda", "poland", "polonia", "russia", "rusia",
  "ukraine", "ucrania", "australia", "japan", "japon", "israel", "china", "india", "south africa", "sudafrica", "morocco", "marruecos",
  "egypt", "egipto", "turkey", "turquia", "greece", "grecia", "croatia", "croacia", "serbia", "czech republic", "republica checa",
  "hungary", "hungria", "romania", "rumania", "bulgaria", "slovakia", "slovenia", "lithuania", "latvia", "estonia", "iceland", "islandia",
  "luxembourg", "malta", "cyprus", "south korea", "corea del sur", "singapore", "singapur", "thailand", "tailandia", "indonesia",
  "philippines", "filipinas", "malaysia", "vietnam", "new zealand", "nueva zelanda", "haiti", "jamaica", "bahamas", "barbados",
  "trinidad and tobago", "guyana", "suriname", "belize", "andorra", "monaco", "liechtenstein", "san marino", "angola", "mozambique",
  "nigeria", "kenya", "ethiopia", "ghana", "senegal", "tunisia", "algeria", "libya", "lebanon", "jordan", "iran", "iraq", "saudi arabia",
  "united arab emirates", "emiratos arabes unidos", "qatar", "kuwait", "pakistan", "bangladesh", "sri lanka", "nepal", "taiwan", "hong kong",
]);

interface Reparto { city: string | null; country: string | null; dudoso: string | null }

/** «Miami, FL, United States» → { city: 'Miami, FL', country: 'United States' }
 *  «Bogotá, Colombia» → { city: 'Bogotá', country: 'Colombia' }
 *  «Venezuela» → { country: 'Venezuela' }  ·  «Casablanca» → { city: 'Casablanca', dudoso }
 *  `paisesExtra`: últimos segmentos vistos en el propio dataset (auto-derivados). */
function repartir(valor: string, paisesExtra: Set<string>): Reparto {
  const partes = valor.split(",").map((p) => p.trim()).filter(Boolean);
  if (partes.length === 0) return { city: null, country: null, dudoso: "vacío" };
  if (partes.length === 1) {
    const p = normalizar(partes[0]!);
    if (PAISES.has(p) || paisesExtra.has(p)) return { city: null, country: partes[0]!.slice(0, 120), dudoso: null };
    return { city: partes[0]!.slice(0, 120), country: null, dudoso: "un solo segmento y no es país reconocido: se asumió ciudad" };
  }
  const country = partes.at(-1)!;
  const city = partes.slice(0, -1).join(", ");
  if (city.length > 120 || country.length > 120) return { city: city.slice(0, 120) || null, country: country.slice(0, 120), dudoso: "valor recortado a 120" };
  return { city, country, dudoso: null };
}

async function main(): Promise<void> {
  if (!existsSync(V4)) { console.error(`falta ${V4}`); process.exit(1); }
  const fichas = readFileSync(V4, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ficha);
  const conCurrently = fichas.filter((f) => (f.info?.["Currently"] ?? "").trim().length > 0);

  // Países autoderivados: últimos segmentos de los valores multi-segmento del propio dataset.
  const extra = new Set<string>();
  for (const f of conCurrently) {
    const partes = (f.info["Currently"] ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 2) extra.add(normalizar(partes.at(-1)!));
  }

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
  // La ficha RYM «X» es la ficha del catálogo LLAMADA «X»: si el nombre exacto es único, manda
  // sobre el mapeo con alias (los «Also Known As» recíprocos de RYM — Aseari↔Hibai Rekondo,
  // Replinter↔Próxima Estación, Hocus Potus↔Soos Days — duplican el mapeo y lo vuelven ambiguo).
  const porNombreExacto = new Map<string, number[]>();
  for (const a of artistas.values()) porNombreExacto.set(normalizar(a.name), [...(porNombreExacto.get(normalizar(a.name)) ?? []), a.id]);
  const fichaDe = (nombre: string): number[] => {
    const exacto = porNombreExacto.get(normalizar(nombre)) ?? [];
    return exacto.length === 1 ? exacto : [...new Set(porNombre.get(normalizar(nombre)) ?? [])];
  };

  const trabajos: Array<{ artistId: number; nombre: string; valor: string; cambios: Record<string, string> }> = [];
  const dudosos: Array<{ artista: string; valor: string; motivo: string }> = [];
  const cuenta: Record<string, number> = {};
  const sumarCuenta = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };

  for (const f of conCurrently) {
    const valor = (f.info["Currently"] ?? "").replace(/\s+/gu, " ").trim();
    const ids = fichaDe(f.nombre ?? "");
    if (ids.length !== 1) { dudosos.push({ artista: f.nombre, valor, motivo: ids.length === 0 ? "artista sin ficha en el catálogo" : "artista ambiguo" }); sumarCuenta("dudoso: sin mapeo único"); continue; }
    const artistId = ids[0]!;
    const actual = artistas.get(artistId)!;
    const reparto = repartir(valor, extra);
    if (reparto.dudoso) dudosos.push({ artista: actual.name, valor, motivo: reparto.dudoso });
    const cambios: Record<string, string> = {};
    if (reparto.city && !actual.current_city) cambios["current_city"] = reparto.city;
    if (reparto.country && !actual.current_country) cambios["current_country"] = reparto.country;
    if (!Object.keys(cambios).length) { sumarCuenta("hueco ya lleno o sin valor que aplicar"); continue; }
    trabajos.push({ artistId, nombre: actual.name, valor, cambios });
  }

  const lista = limite ? trabajos.slice(0, limite) : trabajos;
  console.log(`fichas con «Currently»: ${conCurrently.length} · artistas con algo que aplicar: ${lista.length}`);
  for (const [k, v] of Object.entries(cuenta).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log(`dudosos (no aplicados o marcados): ${dudosos.length}`);

  if (!confirm) {
    writeFileSync(path.join(DIR, "ubicacion-actual-ensayo.json"), JSON.stringify({ trabajos: lista.slice(0, 300), dudosos }, null, 1));
    console.log("dry-run: muestra en ubicacion-actual-ensayo.json; luego --confirm");
    await closeDb();
    return;
  }

  const { runId, result } = await withOperatorRun({
    name: "hermes:rym-ubicacion-actual",
    operator: "hermes (encargo de Brian 2026-10-16)",
    note: "Ubicación actual del artista (campo «Currently» de RYM) a artists.current_city/current_country (migración 0083). El dato estaba escrito como alias por error de la fase 06 del lote 2026-10-15; solo se llenan huecos.",
  }, async (context) => {
    let campos = 0;
    for (const t of lista) { await updateEntity(context, "artist", t.artistId, t.cambios); campos++; }
    return { campos };
  });

  const informe = { runId, fichas: conCurrently.length, aplicados: result.campos, dudosos, trabajos: lista.map((t) => ({ artistId: t.artistId, nombre: t.nombre, ...t.cambios })) };
  writeFileSync(path.join(DIR, `ubicacion-actual-run${runId}.json`), JSON.stringify(informe, null, 1));
  console.log(`run ${runId}: ${result.campos} artistas actualizados · informe ubicacion-actual-run${runId}.json`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
