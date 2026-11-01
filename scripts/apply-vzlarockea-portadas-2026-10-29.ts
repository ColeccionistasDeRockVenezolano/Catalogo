// Portadas de vzlarockea para álbumes del catálogo sin imagen (vzlarockea_datos.json).
//
// Cada post del blog trae la portada del disco. Se descarga, se valida por magic bytes, se guarda en
// media/curated y se pone solo donde el álbum no tiene portada.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-vzlarockea-portadas-2026-10-29.ts [--confirm]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const DIR = process.env["RHV_DIR"] ?? "/home/brian/data/rockhecho";
const OUT = "reports/rockhecho-2026-10-29";
const MEDIA_ROOT = path.resolve("web/public/media");
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";

interface Entrada {
  album_id: string; artista: string; titulo: string; portada: string | null; archivo: string | null;
}

const sha = (s: string | Buffer | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");

function guardar(bytes: Buffer): string | null {
  if (bytes.length < 2000 || bytes.length > 16 * 1024 * 1024) return null;
  const h = bytes.subarray(0, 12);
  const ext = h[0] === 0xff && h[1] === 0xd8 ? "jpg"
    : h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png"
      : h.subarray(0, 4).toString() === "RIFF" && h.subarray(8, 12).toString() === "WEBP" ? "webp" : "";
  if (!ext) return null;
  const digest = sha(bytes);
  const dir = path.join(MEDIA_ROOT, "curated");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${digest}.${ext}`), bytes);
  return `/crv/media/curated/${digest}.${ext}`;
}

async function bajar(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; CRV-catalogo/1.0)" },
      redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    return guardar(Buffer.from(await r.arrayBuffer()));
  } catch { return null; }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const todas = (JSON.parse(readFileSync(path.join(DIR, "vzlarockea_datos.json"), "utf8")) as Entrada[])
    .filter((x) => x.portada && x.album_id);
  console.log("portadas candidatas:", todas.length);

  const res = await withOperatorRun({
    name: "catalogo:portadas-vzlarockea",
    operator: "Hermes (encargo de Brian)",
    note: "Portadas de las fichas del blog vzlarockea.com para álbumes del catálogo sin imagen. " +
      "Se aplana el sufijo /s320/ a /s1600/ para pedir la imagen grande.",
    params: { candidatas: todas.length, confirm: CONFIRM },
  }, async (ctx) => {
    const src = await ctx.client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='vzlarockea' LIMIT 1");
    const sourceId = src.rows[0] ? Number(src.rows[0].id) : null;
    const report = { aplicados: [] as unknown[], saltados: [] as unknown[], errores: [] as unknown[] };

    for (const a of todas) {
      const albumId = Number(a.album_id);
      const actual = (await ctx.client.query<{ cover_url: string | null }>(
        "SELECT cover_url FROM public.albums WHERE id=$1", [albumId])).rows[0];
      if (!actual) { report.errores.push({ albumId, error: "álbum inexistente" }); continue; }
      if ((actual.cover_url ?? "") !== "") { report.saltados.push({ albumId, motivo: "ya tiene portada" }); continue; }
      const guardada = await bajar(a.portada!);
      if (!guardada) { report.errores.push({ albumId, error: "descarga o formato no válido" }); continue; }
      const up = await ctx.client.query(
        "UPDATE public.albums SET cover_url=$2, updated_at=now() WHERE id=$1 AND coalesce(cover_url,'')='' RETURNING id",
        [albumId, guardada]);
      if (up.rowCount === 0) { report.saltados.push({ albumId, motivo: "cambió mientras se descargaba" }); continue; }
      if (sourceId !== null) {
        await ctx.client.query(`
          INSERT INTO ingest.claims(source_id,entity_kind,album_id,field,raw_value,normalized_value,raw_hash,
                                    extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
          VALUES($1,'album',$2,'cover_url',to_jsonb($3::text),to_jsonb($4::text),$5,'vzlarockea','1','medium',
                 'accepted','human',$6,$7,$8) ON CONFLICT DO NOTHING`,
        [sourceId, albumId, a.portada, guardada, sha(["vzlarockea", String(albumId), a.portada!]),
          ctx.runId, `portada del post ${a.archivo}`, `vzlarockea:${albumId}`]);
      }
      report.aplicados.push({ albumId, catalogo: `${a.artista} — ${a.titulo}`, archivo: guardada });
    }
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ aplicados: report.aplicados.length, saltados: report.saltados.length,
        errores: report.errores.length })]);
    return report;
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { aplicados: unknown[]; saltados: unknown[]; errores: unknown[] };
  writeFileSync(path.join(OUT, `vzlarockea-portadas-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} portadas=${r.aplicados.length} ` +
    `saltados=${r.saltados.length} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 6)) console.log("  !", JSON.stringify(e).slice(0, 160));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
