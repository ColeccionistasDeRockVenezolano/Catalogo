// Campaña RYM 2026-10-15 · FASE 3: campos del disco que la ficha de RYM sí trae y el catálogo no.
//
//   catalog_id        n.º de catálogo del sello (1.352 útiles)
//   media_format      formato (Vinyl LP, CD, Cassette, Digital File…)
//   release_date_text fecha completa como la publica la ficha («5 June 2026»)
//   release_year      solo si al disco le falta el año
//
// NADA se pisa: cada campo se escribe únicamente si está vacío en el catálogo.
// Uso: ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/04-campos.mts [--confirm] [--limit=N]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { updateEntity, withOperatorRun } from "../../src/merge/operator.js";

const DIR = "reports/rym-2026-10-15";
const V4 = "reports/rym-v4-2026-10-04/albumes.jsonl";
const confirm = process.argv.includes("--confirm");
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);

interface Cruce { slug: string; albumId: number; artistId: number; fechaTexto: string | null }
interface Rico {
  slug: string; titulo: string; formato: string | null; catalog_no: string | null;
  released_text: string | null; anio: number | null;
}

const sinBasura = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  if (!t || ["n/a", "N/A", "none", "None", "-"].includes(t)) return null;
  return t.slice(0, 200);
};

/** La fecha se guarda como la publica la ficha, en español llano («5 June 2026» → «5 de junio de 2026»). */
const MESES: Record<string, string> = { january: "enero", february: "febrero", march: "marzo", april: "abril", may: "mayo", june: "junio", july: "julio", august: "agosto", september: "septiembre", october: "octubre", november: "noviembre", december: "diciembre" };
function fechaEspanol(texto: string | null): string | null {
  const limpio = (texto ?? "").replace(/\s+on\s+.*$/iu, "").trim();
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/u.exec(limpio);
  if (!m) return /^\d{4}$/u.test(limpio) ? limpio : null;
  const mes = MESES[m[2]!.toLowerCase()];
  return mes ? `${Number(m[1])} de ${mes} de ${m[3]}` : null;
}

async function main(): Promise<void> {
  if (!existsSync(path.join(DIR, "cruce.jsonl"))) { console.error("falta cruce.jsonl (fase 1)"); process.exit(1); }
  const cruce = new Map<string, Cruce>();
  for (const l of readFileSync(path.join(DIR, "cruce.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const d = JSON.parse(l) as Cruce;
    cruce.set(d.slug, d);
  }
  const ricos = new Map<string, Rico>();
  for (const l of readFileSync(V4, "utf8").split("\n").filter(Boolean)) {
    const d = JSON.parse(l) as Rico;
    ricos.set(d.slug, d);
  }

  const pool = getPool();
  const actuales = new Map((await pool.query<{ id: string; catalog_id: string | null; media_format: string | null; release_date_text: string | null; release_year: number | null }>(
    "SELECT id::text AS id, catalog_id, media_format, release_date_text, release_year FROM public.albums")).rows
    .map((r) => [Number(r.id), r]));

  const trabajos: Array<{ albumId: number; slug: string; titulo: string; cambios: Record<string, string | number> }> = [];
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };

  for (const [slug, fila] of ricos) {
    const c = cruce.get(slug);
    if (!c) continue;
    const actual = actuales.get(c.albumId);
    if (!actual) { sumar("disco inexistente"); continue; }
    const cambios: Record<string, string | number> = {};
    const catalogo = sinBasura(fila.catalog_no);
    if (catalogo && !actual.catalog_id) cambios["catalog_id"] = catalogo;
    const formato = sinBasura(fila.formato);
    if (formato && !actual.media_format) cambios["media_format"] = formato;
    const fecha = fechaEspanol(fila.released_text ?? c.fechaTexto);
    if (fecha && !actual.release_date_text) cambios["release_date_text"] = fecha;
    if (fila.anio && !actual.release_year) cambios["release_year"] = fila.anio;
    if (Object.keys(cambios).length === 0) { sumar("sin hueco que llenar"); continue; }
    trabajos.push({ albumId: c.albumId, slug, titulo: fila.titulo, cambios });
    for (const k of Object.keys(cambios)) sumar(k);
  }
  const lista = limite ? trabajos.slice(0, limite) : trabajos;
  console.log(`discos con algo que llenar: ${lista.length} (de ${cruce.size} fichas casadas)`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);

  if (lista.length === 0) { await closeDb(); return; }
  if (!confirm) { writeFileSync(path.join(DIR, "campos-ensayo.json"), JSON.stringify(lista.slice(0, 200), null, 1)); console.log("dry-run: repite con --confirm (muestra en campos-ensayo.json)"); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:rym-campos",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Campos de disco de las fichas de RYM (n.º de catálogo, formato, fecha completa, año): solo se llenan huecos.",
  }, async (context) => {
    let escritos = 0;
    for (const t of lista) {
      await updateEntity(context, "album", t.albumId, t.cambios);
      escritos++;
    }
    return { escritos };
  });
  writeFileSync(path.join(DIR, `campos-run${runId}.json`), JSON.stringify({ runId, ...result, cuenta }, null, 1));
  console.log(`run ${runId}: ${result.escritos} discos actualizados`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
