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
import { updateEntity } from "../../src/merge/operator.js";
import { validateRymCross } from "../../src/verification/rym-identity.js";
import { applyRymBatches } from "../../src/verification/rym-batches.js";
import { rymReleaseDateText } from "../../src/verification/rym-release-plan.js";

// La campaña «resto» (2026-10-16) reusa esta fase: --dir (informes) y --v4 (re-parseo) apuntan a lo suyo.
const argumento = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const DIR = argumento("--dir") ?? "reports/rym-2026-10-15";
const V4 = argumento("--v4") ?? "reports/rym-v4-2026-10-04/albumes.jsonl";
const confirm = process.argv.includes("--confirm");
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);

interface Cruce { slug: string; albumId: number; artistId: number; tituloCatalogo: string; fechaTexto: string | null }
interface Rico {
  slug: string; titulo: string; formato: string | null; catalog_no: string | null;
  released_text: string | null; anio: number | null;
  rating?: number | null; n_ratings?: number | null;
}

const sinBasura = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  if (!t || ["n/a", "N/A", "none", "None", "-"].includes(t)) return null;
  return t.slice(0, 200);
};

async function main(): Promise<void> {
  await validateRymCross(getPool(), DIR);
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
  const actuales = new Map((await pool.query<{ id: string; catalog_id: string | null; media_format: string | null; release_date_text: string | null; release_year: number | null; rym_rating: string | null; rym_ratings_count: number | null }>(
    "SELECT id::text AS id, catalog_id, media_format, release_date_text, release_year, rym_rating::text AS rym_rating, rym_ratings_count FROM public.albums")).rows
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
    if (catalogo && catalogo.length <= 80 && !actual.catalog_id) cambios["catalog_id"] = catalogo;
    const formato = sinBasura(fila.formato);
    if (formato && formato.length <= 50 && !actual.media_format) cambios["media_format"] = formato;
    const fecha = rymReleaseDateText(fila.released_text ?? c.fechaTexto);
    if (fecha && !actual.release_date_text) cambios["release_date_text"] = fecha;
    if (fila.anio && !actual.release_year) cambios["release_year"] = fila.anio;
    // Puntuación agregada de RYM (migración 0095): solo se rellena si el disco no la tiene.
    if (typeof fila.rating === "number" && fila.rating >= 0 && fila.rating <= 5 && !actual.rym_rating) cambios["rym_rating"] = Number(fila.rating.toFixed(2));
    if (typeof fila.n_ratings === "number" && fila.n_ratings > 0 && !actual.rym_ratings_count) cambios["rym_ratings_count"] = fila.n_ratings;
    if (Object.keys(cambios).length === 0) { sumar("sin hueco que llenar"); continue; }
    trabajos.push({ albumId: c.albumId, slug, titulo: fila.titulo, cambios });
    for (const k of Object.keys(cambios)) sumar(k);
  }
  const values = new Map<string, Set<string>>();
  for (const job of trabajos) for (const [field, value] of Object.entries(job.cambios)) {
    const key = `${job.albumId}:${field}`; values.set(key, new Set([...(values.get(key) ?? []), String(value)]));
  }
  const conflicts = trabajos.flatMap(job => Object.entries(job.cambios).filter(([field]) => values.get(`${job.albumId}:${field}`)!.size > 1).map(([field, value]) => ({ albumId: job.albumId, slug: job.slug, field, value })));
  writeFileSync(path.join(DIR, 'campos-conflictos.json'), JSON.stringify(conflicts, null, 2)+'\n');
  const merged = new Map<number, (typeof trabajos)[number]>();
  for (const job of trabajos) {
    const changes = Object.fromEntries(Object.entries(job.cambios).filter(([field]) => values.get(`${job.albumId}:${field}`)!.size === 1));
    const previous = merged.get(job.albumId);
    merged.set(job.albumId, { ...job, cambios: { ...previous?.cambios, ...changes } });
  }
  const unique = [...merged.values()].filter(job => Object.keys(job.cambios).length);
  const lista = limite ? unique.slice(0, limite) : unique;
  console.log(`discos con algo que llenar: ${lista.length} (de ${cruce.size} fichas casadas)`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);

  if (lista.length === 0) { await closeDb(); return; }
  if (!confirm) { writeFileSync(path.join(DIR, "campos-ensayo.json"), JSON.stringify(lista, null, 1)); console.log("dry-run: repite con --confirm (plan completo en campos-ensayo.json)"); await closeDb(); return; }

  const result = await applyRymBatches({ directory: DIR, phase: 'campos', items: lista,
    apply: async (context, item) => {
      const current = (await context.client.query<Record<string, unknown>>('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE', [item.albumId])).rows[0];
      if (!current) throw new Error('Disco retirado durante el lote');
      const target = cruce.get(item.slug);
      if (!target || Number(current['artist_id']) !== target.artistId || current['title'] !== target.tituloCatalogo) throw new Error('Destino RYM cambió durante el lote');
      const fields = Object.fromEntries(Object.entries(item.cambios).filter(([field]) => current[field] === null || current[field] === ''));
      if (!Object.keys(fields).length) return false;
      await updateEntity(context, 'album', item.albumId, fields); return true;
    } });
  writeFileSync(path.join(DIR, 'campos-aplicado.json'), JSON.stringify({ ...result, cuenta }, null, 2)+'\n');
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
