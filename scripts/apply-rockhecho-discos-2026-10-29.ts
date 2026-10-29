// Discos propios de rockhechovenezuela.com que faltan en el catálogo (2026-10-29).
//
// Entrada: dossier_discos_nuevos.json (132 discos filtrados: sin la pestaña Recopilaciones, con año,
// título utilizable y sin equivalente en el catálogo con similitud ≥0,86).
// Crea álbum + pistas + sello + portada, con claim y evidencia por campo, en UN run del operador.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-rockhecho-discos-2026-10-29.ts [--confirm] [--limit=N]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun, type OperatorContext } from "../src/merge/operator.js";

const DIR = process.env["RHV_DIR"] ?? "/home/brian/data/rockhecho";
const OUT = "reports/rockhecho-2026-10-29";
const MEDIA_ROOT = path.resolve("web/public/media");
const SOURCE_SLUG = "rock-hecho-en-venezuela";
const EXTRACTOR = "rockhecho-captura-2026-10-29";
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";
const LIMIT = Number((process.argv.find((v) => v.startsWith("--limit="))?.slice(8)) ?? 0);

interface Disco {
  artist_id: number; banda: string; ficha: string; tab: string; titulo: string;
  anio: number | null; anio_texto: string | null; sello: string | null; catalogo: string | null;
  media_format: string; album_type: string; temas: string[]; portada: string | null;
  formacion: string | null; invitados: string | null; header: string;
}

const sha = (s: string | Buffer | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");
const norm = (t: string): string => (t ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
  .replace(/[^a-z0-9ñ ]+/gu, " ").replace(/\s+/gu, " ").trim();

function guardarImagen(archivo: string): string | null {
  const full = path.join(DIR, "imgs", archivo);
  if (!existsSync(full)) return null;
  const bytes = readFileSync(full);
  if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) return null;
  const head = bytes.subarray(0, 12);
  const ext = head[0] === 0xff && head[1] === 0xd8 ? "jpg"
    : head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png" : "";
  if (!ext) return null;
  const digest = sha(bytes);
  const dir = path.join(MEDIA_ROOT, "curated");
  mkdirSync(dir, { recursive: true });
  copyFileSync(full, path.join(dir, `${digest}.${ext}`));
  return `/crv/media/curated/${digest}.${ext}`;
}

async function claim(
  ctx: OperatorContext, sourceId: number, kind: "album" | "track", id: number,
  field: string, value: string, url: string, excerpt: string,
): Promise<void> {
  const idCol = kind === "album" ? "album_id" : "track_id";
  const c = await ctx.client.query<{ id: string }>(`
    INSERT INTO ingest.claims(source_id,entity_kind,${idCol},field,raw_value,normalized_value,raw_hash,extractor,
                              extractor_version,confidence,status,created_by,run_id,notes,identity_key)
    VALUES($1,$2,$3,$4,to_jsonb($5::text),to_jsonb($5::text),$6,$7,'1','high','accepted','human',$8,$9,$10)
    ON CONFLICT DO NOTHING RETURNING id::text`,
  [sourceId, kind, id, field, value, sha([EXTRACTOR, kind, id, field, value]), EXTRACTOR, ctx.runId,
    `alta desde ${url}`, `${EXTRACTOR}:${kind}:${id}:${field}`]);
  if (c.rows[0]) {
    await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
      VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
    [c.rows[0].id, url, excerpt.slice(0, 480), sha([url, excerpt.slice(0, 400)])]);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const dossier = JSON.parse(readFileSync(path.join(DIR, "dossier_discos_nuevos.json"), "utf8")) as { discos: Disco[] };
  const discos = LIMIT ? dossier.discos.slice(0, LIMIT) : dossier.discos;
  console.log("discos en el dossier:", dossier.discos.length, "a procesar:", discos.length);

  const res = await withOperatorRun({
    name: "catalogo:rockhecho-discos",
    operator: "Hermes (encargo de Brian)",
    note: "Alta de los discos propios que la captura de rockhechovenezuela.com documenta y el catálogo " +
      "todavía no tiene: sin la pestaña Recopilaciones, con año y con título que no coincide con ningún " +
      "álbum existente del artista (similitud < 0,86). Cada pista y cada campo con evidencia de la ficha.",
    params: { discos: discos.length, confirm: CONFIRM },
  }, async (ctx) => {
    const src = await ctx.client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SOURCE_SLUG]);
    if (!src.rows[0]) throw new Error(`falta la fuente ${SOURCE_SLUG}`);
    const sourceId = Number(src.rows[0].id);
    const report = { creados: [] as unknown[], saltados: [] as unknown[], errores: [] as unknown[] };
    const etiquetas = new Map<string, number>();

    async function etiqueta(nombre: string): Promise<number> {
      const key = norm(nombre);
      if (etiquetas.has(key)) return etiquetas.get(key)!;
      const found = (await ctx.client.query<{ id: string }>(
        "SELECT id::text FROM public.organizations WHERE lower(name)=lower($1) LIMIT 1", [nombre])).rows[0];
      let id: number;
      if (found) id = Number(found.id);
      else {
        const ins = await ctx.client.query<{ id: string }>(
          `INSERT INTO public.organizations(name,organization_type,country,notes)
           VALUES($1,'record_label','Venezuela',$2) RETURNING id::text`,
          [nombre, `Alta desde Rock Hecho Venezuela (${EXTRACTOR})`]);
        id = Number(ins.rows[0]!.id);
      }
      etiquetas.set(key, id);
      return id;
    }

    for (const d of discos) {
      const dup = (await ctx.client.query<{ id: string }>(
        "SELECT id::text FROM public.albums WHERE artist_id=$1 AND lower(title)=lower($2) LIMIT 1",
        [d.artist_id, d.titulo])).rows[0];
      if (dup) { report.saltados.push({ banda: d.banda, titulo: d.titulo, motivo: "ya existe", id: Number(dup.id) }); continue; }

      await ctx.client.query("SAVEPOINT disco");
      try {
        let labelId: number | null = null;
        if (d.sello && d.sello.length <= 28 && !/tetero|vol\.|recopilaci/i.test(d.sello)) {
          labelId = await etiqueta(d.sello);
        }
        const cover = d.portada ? guardarImagen(d.portada) : null;
        const notes = `Alta desde Rock Hecho Venezuela (${d.ficha}) — pestaña ${d.tab}` +
          (d.header ? ` · «${d.header.slice(0, 160)}»` : "");
        const album = await ctx.client.query<{ id: string }>(`
          INSERT INTO public.albums(artist_id,title,release_year,release_date_text,album_type,media_format,
                                    label_id,catalog_id,cover_url,notes)
          VALUES($1,$2,$3,$4,$5::album_type,$6,$7,$8,$9,$10) RETURNING id::text`,
        [d.artist_id, d.titulo, d.anio, d.anio_texto, d.album_type, d.media_format, labelId,
          d.catalogo, cover, notes]);
        const albumId = Number(album.rows[0]!.id);
        await claim(ctx, sourceId, "album", albumId, "title", d.titulo, d.ficha, d.header || d.titulo);
        if (d.anio) await claim(ctx, sourceId, "album", albumId, "release_year", String(d.anio), d.ficha, d.header);
        await claim(ctx, sourceId, "album", albumId, "album_type", d.album_type, d.ficha, `pestaña ${d.tab}`);
        if (labelId) await claim(ctx, sourceId, "album", albumId, "label", d.sello!, d.ficha, d.header);

        let n = 0;
        const pistas: string[] = [];
        for (const [i, t] of d.temas.entries()) {
          const titulo = String(t).trim().slice(0, 240);
          if (!titulo) continue;
          const track = await ctx.client.query<{ id: string }>(
            `INSERT INTO public.tracks(album_id,disc_number,track_number,title,notes)
             VALUES($1,1,$2,$3,$4) RETURNING id::text`,
            [albumId, i + 1, titulo, `Tema según Rock Hecho Venezuela (${d.ficha})`]);
          await claim(ctx, sourceId, "track", Number(track.rows[0]!.id), "title", titulo, d.ficha,
            `«${titulo}» en la lista de temas de ${d.titulo}`);
          n += 1;
          pistas.push(titulo);
        }
        await ctx.client.query("RELEASE SAVEPOINT disco");
        report.creados.push({ albumId, banda: d.banda, titulo: d.titulo, anio: d.anio, tipo: d.album_type,
          formato: d.media_format, sello: d.sello, cover, pistas: n });
      } catch (error) {
        await ctx.client.query("ROLLBACK TO SAVEPOINT disco");
        report.errores.push({ banda: d.banda, titulo: d.titulo, error: (error as Error).message.slice(0, 220) });
      }
    }
    const pistas = (report.creados as Array<{ pistas: number }>).reduce((s, x) => s + x.pistas, 0);
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ creados: report.creados.length, saltados: report.saltados.length,
        errores: report.errores.length, pistas })]);
    return { ...report, pistas };
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { creados: unknown[]; saltados: unknown[]; errores: unknown[]; pistas: number };
  writeFileSync(path.join(OUT, `discos-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} creados=${r.creados.length} ` +
    `pistas=${r.pistas} saltados=${r.saltados.length} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 8)) console.log("  !", JSON.stringify(e).slice(0, 220));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
