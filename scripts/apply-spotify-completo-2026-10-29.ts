// Aplica al catálogo lo capturado del web player de Spotify (spotify_completo.jsonl).
//
// Por álbum: pistas con duración, portada localizada en media/curated, año y, si los hay, los
// créditos como nota del álbum con su claim (el texto del modal no es estructurado: no se inventan
// personas a partir de él). Solo toca álbumes que siguen sin pistas.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-spotify-completo-2026-10-29.ts [--confirm] [--limite=N]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const DIR = process.env["RHV_DIR"] ?? "/home/brian/data/rockhecho";
const OUT = "reports/rockhecho-2026-10-29";
const MEDIA_ROOT = path.resolve("web/public/media");
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";
const LIMITE = Number((process.argv.find((v) => v.startsWith("--limite="))?.slice(9)) ?? 0);

interface Pista { disc: number; n: number; title: string; dur: string | null }
interface Entrada {
  album_id: string; spotify_id: string; album: string; anio: string | null; portada: string | null;
  artistas: string[] | null; creditos: string | null; cat_title: string; cat_artista: string; pistas: Pista[];
}

const sha = (s: string | Buffer | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");

function segundos(d: string | null): number | null {
  const m = d ? /^(\d{1,2}):(\d{2})$/u.exec(d.trim()) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function guardarBytes(bytes: Buffer): string | null {
  if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) return null;
  const head = bytes.subarray(0, 12);
  const ext = head[0] === 0xff && head[1] === 0xd8 ? "jpg"
    : head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png" : "";
  if (!ext) return null;
  const digest = sha(bytes);
  const dir = path.join(MEDIA_ROOT, "curated");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${digest}.${ext}`), bytes);
  return `/crv/media/curated/${digest}.${ext}`;
}

async function bajar(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    return guardarBytes(Buffer.from(await r.arrayBuffer()));
  } catch { return null; }
}

function mainSync(): Entrada[] {
  const rows: Entrada[] = [];
  for (const line of readFileSync(path.join(DIR, "spotify_completo.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as Entrada & { motivo?: string };
      if (d.album_id && d.spotify_id && d.pistas?.length) rows.push(d);
    } catch { /* línea incompleta al cortar el proceso */ }
  }
  return rows;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const todas = mainSync();
  const entradas = LIMITE ? todas.slice(0, LIMITE) : todas;
  console.log("álbumes capturados con datos:", todas.length, "· a aplicar:", entradas.length);

  const res = await withOperatorRun({
    name: "catalogo:spotify-web-completo",
    operator: "Hermes (encargo de Brian)",
    note: "Datos de álbum (pistas con duración, portada, año y créditos) leídos del reproductor web " +
      "de Spotify con la sesión del dueño, para los álbumes del catálogo que no tenían pistas.",
    params: { albumes: entradas.length, confirm: CONFIRM },
  }, async (ctx) => {
    const src = await ctx.client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='spotify' LIMIT 1");
    const sourceId = src.rows[0] ? Number(src.rows[0].id) : null;
    const report = { aplicados: [] as unknown[], saltados: [] as unknown[], errores: [] as unknown[] };

    for (const a of entradas) {
      const albumId = Number(a.album_id);
      const actual = (await ctx.client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.tracks WHERE album_id=$1", [albumId])).rows[0]?.n ?? 0;
      if (actual > 0) { report.saltados.push({ albumId, motivo: "ya tiene pistas" }); continue; }

      await ctx.client.query("SAVEPOINT sp");
      try {
        const url = `https://open.spotify.com/album/${a.spotify_id}`;
        const vistos = new Set<string>();
        let n = 0;
        for (const [i, p] of a.pistas.entries()) {
          const titulo = (p.title ?? "").trim().slice(0, 240);
          if (!titulo) continue;
          let pos = p.n || i + 1;
          while (vistos.has(`${pos}`)) pos += 1;
          vistos.add(`${pos}`);
          const ins = await ctx.client.query<{ id: string }>(
            `INSERT INTO public.tracks(album_id,disc_number,track_number,title,duration_seconds,notes)
             VALUES($1,1,$2,$3,$4,$5) RETURNING id::text`,
            [albumId, pos, titulo, segundos(p.dur), `Tracklist del reproductor de Spotify (${url})`]);
          n += 1;
          if (sourceId !== null) {
            const c = await ctx.client.query<{ id: string }>(`
              INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,raw_hash,
                                        extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
              VALUES($1,'track',$2,'title',to_jsonb($3::text),to_jsonb($3::text),$4,'spotify-web','1','high',
                     'accepted','human',$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id::text`,
            [sourceId, Number(ins.rows[0]!.id), titulo, sha(["spotify-web", a.spotify_id, String(pos), titulo]),
              ctx.runId, `pista de ${a.album}`, `spotify-web:${a.spotify_id}:${pos}`]);
            if (c.rows[0]) {
              await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
                VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
              [c.rows[0].id, url, `${pos}. ${titulo}`, sha([url, titulo])]);
            }
          }
        }
        // portada, año y créditos
        const saved = a.portada ? await bajar(a.portada) : null;
        if (saved) {
          await ctx.client.query("UPDATE public.albums SET cover_url=$2, updated_at=now() WHERE id=$1 AND coalesce(cover_url,'')=''",
            [albumId, saved]);
        }
        const anio = Number(String(a.anio ?? "").match(/\d{4}/)?.[0] ?? 0);
        if (anio >= 1900 && anio <= 2026) {
          await ctx.client.query("UPDATE public.albums SET release_year=$2, updated_at=now() WHERE id=$1 AND release_year IS NULL",
            [albumId, anio]);
        }
        if (a.creditos && a.creditos.trim().length > 20) {
          const nota = `Créditos (Spotify, ${url}): ${a.creditos.replace(/\s+/gu, " ").slice(0, 1500)}`;
          await ctx.client.query(
            `UPDATE public.albums SET notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n' || $2), updated_at=now()
             WHERE id=$1 AND coalesce(notes,'') NOT LIKE '%Créditos (Spotify%'`, [albumId, nota]);
        }
        await ctx.client.query("RELEASE SAVEPOINT sp");
        report.aplicados.push({ albumId, spotify: a.spotify_id, catalogo: `${a.cat_artista} — ${a.cat_title}`,
          pistas: n, portada: Boolean(saved), anio: anio || null, creditos: Boolean(a.creditos) });
      } catch (error) {
        await ctx.client.query("ROLLBACK TO SAVEPOINT sp");
        report.errores.push({ albumId, error: (error as Error).message.slice(0, 200) });
      }
    }
    const pistas = (report.aplicados as Array<{ pistas: number }>).reduce((s, x) => s + x.pistas, 0);
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ aplicados: report.aplicados.length, pistas,
        saltados: report.saltados.length, errores: report.errores.length })]);
    return { ...report, pistas };
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { aplicados: unknown[]; saltados: unknown[]; errores: unknown[]; pistas: number };
  writeFileSync(path.join(OUT, `spotify-completo-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} albumes=${r.aplicados.length} ` +
    `pistas=${r.pistas} saltados=${r.saltados.length} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 6)) console.log("  !", JSON.stringify(e).slice(0, 200));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
