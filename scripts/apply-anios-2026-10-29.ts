// CRV · Corrige el año de publicación de los discos donde el sitio y el catálogo
// discrepan, cuando una fuente externa lo resuelve (2026-10-29).
//
// Entrada: <ANIOS_DIR>/decisiones.csv (scripts/anios-2026-10-29/resolver.py).
// Solo toca discos con album_id, propuesta externa y veredicto «confirma_sitio»
// o «tercer_valor»; nunca cambia un año sin evidencia enlazada. Un run del
// operador, reversible con `runs undo`.
//
// Uso: ANIOS_DIR=… ./scripts/with-node22.sh npx tsx scripts/apply-anios-2026-10-29.ts [--confirm]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun, type OperatorContext } from "../src/merge/operator.js";

const DIR = process.env["ANIOS_DIR"] ?? "reports/anios-2026-10-29";
const OUT = DIR;
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";
const SOURCE_SLUG = "rock-hecho-en-venezuela";
const EXTRACTOR = "anios-externos-2026-10-29";

interface Fila {
  artista: string; album: string; album_id: string; anio_catalogo: string; anios_sitio: string;
  discogs: string; discogs_url: string; musicbrainz: string; mb_url: string;
  spotify: string; spotify_url: string; propuesta: string; criterio: string; veredicto: string;
}

const sha = (s: string | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");

async function claim(
  ctx: OperatorContext, sourceId: number, albumId: number, field: string,
  value: string, url: string, excerpt: string,
): Promise<void> {
  const c = await ctx.client.query<{ id: string }>(`
    INSERT INTO ingest.claims(source_id,entity_kind,album_id,field,raw_value,normalized_value,raw_hash,extractor,
                              extractor_version,confidence,status,created_by,run_id,notes,identity_key)
    VALUES($1,'album',$2,$3,to_jsonb($4::text),to_jsonb($4::text),$5,$6,'1','high','accepted','human',$7,$8,$9)
    ON CONFLICT DO NOTHING RETURNING id::text`,
  [sourceId, albumId, field, value, sha([EXTRACTOR, albumId, field, value]), EXTRACTOR, ctx.runId,
    `Año resuelto con fuente externa (${EXTRACTOR})`, `${albumId}|${field}`]);
  if (c.rows[0]) {
    await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
      VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
    [c.rows[0].id, url, (excerpt ?? "").slice(0, 480), sha([url, (excerpt ?? "").slice(0, 400)])]);
  }
}

function parseCsv(text: string): Fila[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0]!.split(",").map((h) => h.trim());
  // los campos no llevan comas internas: split simple, con comillas si aparecen
  const split = (line: string): string[] => {
    const out: string[] = []; let cur = ""; let q = false;
    for (const ch of line) {
      if (ch === '"') { q = !q; continue; }
      if (ch === "," && !q) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  };
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    head.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row as unknown as Fila;
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const filas = parseCsv(readFileSync(path.join(DIR, "decisiones.csv"), "utf8"));
  const aplicables = filas.filter((f) =>
    f.album_id && f.propuesta && f.veredicto === "corregir_antes" &&
    /discogs|mb/.test(f.criterio) &&
    Number(f.propuesta) < Number(f.anio_catalogo || 9999));
  console.log("filas:", filas.length, "aplicables:", aplicables.length);
  const porVeredicto: Record<string, number> = {};
  for (const f of aplicables) porVeredicto[`${f.veredicto}/${f.criterio}`] = (porVeredicto[`${f.veredicto}/${f.criterio}`] ?? 0) + 1;
  console.log("reparto:", JSON.stringify(porVeredicto));

  const res = await withOperatorRun({
    name: "catalogo:anios-externos",
    operator: "Hermes (encargo de Brian)",
    note: "Corrección del año de publicación donde el sitio de rockhechovenezuela.com y el catálogo " +
      "discrepaban, resuelto contra Discogs/MusicBrainz/Spotify (consenso de fuentes o coincidencia con " +
      "el sitio). Cada cambio lleva su claim y la URL de la evidencia.",
    params: { filas: aplicables.length, confirm: CONFIRM },
  }, async (ctx) => {
    const src = await ctx.client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SOURCE_SLUG]);
    if (!src.rows[0]) throw new Error(`falta la fuente ${SOURCE_SLUG}`);
    const sourceId = Number(src.rows[0].id);
    const report = { cambiados: [] as unknown[], saltados: [] as unknown[], errores: [] as unknown[] };

    for (const f of aplicables) {
      const albumId = Number(f.album_id);
      const anio = Number(f.propuesta);
      try {
        const cur = await ctx.client.query<{ release_year: number | null; title: string }>(
          "SELECT release_year, title FROM public.albums WHERE id=$1", [albumId]);
        if (!cur.rows[0]) { report.saltados.push({ album_id: albumId, motivo: "no existe" }); continue; }
        if (cur.rows[0].release_year === anio) { report.saltados.push({ album_id: albumId, motivo: "ya tiene ese año" }); continue; }
        const url = f.discogs && f.discogs.split(";").includes(String(anio)) ? f.discogs_url
          : f.musicbrainz && f.musicbrainz.split(";").includes(String(anio)) ? f.mb_url : f.spotify_url;
        const excerpt = `Año ${anio}: Discogs [${f.discogs}] MusicBrainz [${f.musicbrainz}] ` +
          `Spotify [${f.spotify}]; sitio [${f.anios_sitio}]; catálogo anterior ${f.anio_catalogo}`;
        await ctx.client.query("UPDATE public.albums SET release_year=$2, updated_at=now() WHERE id=$1",
          [albumId, anio]);
        await claim(ctx, sourceId, albumId, "release_year", String(anio), url, excerpt);
        report.cambiados.push({ album_id: albumId, artista: f.artista, album: f.album,
          antes: f.anio_catalogo, despues: anio, veredicto: f.veredicto, criterio: f.criterio });
      } catch (error) {
        report.errores.push({ album_id: albumId, error: (error as Error).message.slice(0, 200) });
      }
    }
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ cambiados: report.cambiados.length, saltados: report.saltados.length,
        errores: report.errores.length })]);
    return report;
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { cambiados: unknown[]; saltados: unknown[]; errores: unknown[] };
  writeFileSync(path.join(OUT, `anios-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} cambiados=${r.cambiados.length} ` +
    `saltados=${r.saltados.length} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 5)) console.log("  !", JSON.stringify(e).slice(0, 200));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
