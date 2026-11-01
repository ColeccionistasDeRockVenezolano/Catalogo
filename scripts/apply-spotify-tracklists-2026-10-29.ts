// Tracklists de Spotify para álbumes del catálogo sin pistas (2026-10-29).
//
// Entrada: spotify_tracklists.json (API oficial /v1/albums). Solo se aplica si el álbum sigue sin
// pistas y el título de Spotify se parece al del catálogo (≥0,55); el resto va a revisión.
// Inserta pistas con duración y deja claim + evidencia por pista.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-spotify-tracklists-2026-10-29.ts [--confirm]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const DIR = process.env["RHV_DIR"] ?? "/home/brian/data/rockhecho";
const OUT = "reports/rockhecho-2026-10-29";
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";
const MIN_SIM = 0.55;

interface Pista { disc: number; n: number; title: string; ms: number }
interface Album { album_id: string; spotify_id: string; album: string; artistas: string[]; pistas: Pista[]; sim: number; cat_title: string }

const sha = (s: string | Buffer | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const data = JSON.parse(readFileSync(path.join(DIR, "spotify_tracklists.json"), "utf8")) as { albumes: Album[] };
  const aplicar = data.albumes.filter((a) => a.sim >= MIN_SIM);
  const revisar = data.albumes.filter((a) => a.sim < MIN_SIM);
  console.log(`álbumes con tracklist de Spotify: ${data.albumes.length} · aplicables=${aplicar.length} · a revisión=${revisar.length}`);

  const res = await withOperatorRun({
    name: "catalogo:spotify-tracklists",
    operator: "Hermes (encargo de Brian)",
    note: "Tracklist de los álbumes del catálogo que no tenían pistas, tomado de la API oficial de " +
      "Spotify del enlace que ya estaba asociado al propio álbum. Solo se aplica si el título del " +
      "álbum en Spotify coincide con el del catálogo (similitud ≥0,55); si no, queda a revisión.",
    params: { albumes: aplicar.length, confirm: CONFIRM },
  }, async (ctx) => {
    const source = await ctx.client.query<{ id: string }>(
      "SELECT id::text FROM ingest.sources WHERE slug='spotify' LIMIT 1");
    const sourceId = source.rows[0] ? Number(source.rows[0].id) : null;
    const report = { aplicados: [] as unknown[], revisar: [] as unknown[], saltados: [] as unknown[], errores: [] as unknown[] };

    for (const a of [...aplicar, ...revisar]) {
      const albumId = Number(a.album_id);
      const actual = (await ctx.client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.tracks WHERE album_id=$1", [albumId])).rows[0]?.n ?? 0;
      if (actual > 0) { report.saltados.push({ albumId, motivo: "ya tiene pistas", n: actual }); continue; }

      await ctx.client.query("SAVEPOINT tl");
      try {
        const url = `https://open.spotify.com/album/${a.spotify_id}`;
        const pistas: string[] = [];
        for (const p of a.pistas) {
          const titulo = p.title.trim().slice(0, 240);
          if (!titulo) continue;
          const dur = p.ms > 0 ? Math.round(p.ms / 1000) : null;
          const ins = await ctx.client.query<{ id: string }>(
            `INSERT INTO public.tracks(album_id,disc_number,track_number,title,duration_seconds,notes)
             VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,
            [albumId, p.disc || 1, p.n || pistas.length + 1, titulo, dur,
              `Tracklist de Spotify (${url})`]);
          const trackId = Number(ins.rows[0]!.id);
          pistas.push(titulo);
          if (sourceId !== null) {
            const c = await ctx.client.query<{ id: string }>(`
              INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,raw_hash,
                                        extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
              VALUES($1,'track',$2,'title',to_jsonb($3::text),to_jsonb($3::text),$4,'spotify-album-tracks','1','high',
                     'accepted','human',$5,$6,$7)
              ON CONFLICT DO NOTHING RETURNING id::text`,
            [sourceId, trackId, titulo, sha(["spotify", a.spotify_id, String(p.disc), String(p.n), titulo]),
              ctx.runId, `pista de ${a.album} (${url})`, `spotify:${a.spotify_id}:${p.disc}-${p.n}`]);
            if (c.rows[0]) {
              await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
                VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
              [c.rows[0].id, url, `${p.n}. ${titulo}`, sha([url, titulo])]);
            }
          }
        }
        await ctx.client.query("RELEASE SAVEPOINT tl");
        const row = { albumId, spotify: a.spotify_id, catalogo: a.cat_title, spotifyTitulo: a.album,
          sim: a.sim, pistas: pistas.length };
        if (a.sim >= MIN_SIM) report.aplicados.push(row); else report.revisar.push(row);
      } catch (error) {
        await ctx.client.query("ROLLBACK TO SAVEPOINT tl");
        report.errores.push({ albumId, error: (error as Error).message.slice(0, 200) });
      }
    }
    const pistas = (report.aplicados as Array<{ pistas: number }>).reduce((s, x) => s + x.pistas, 0);
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ aplicados: report.aplicados.length, revisar: report.revisar.length,
        saltados: report.saltados.length, errores: report.errores.length, pistas })]);
    return { ...report, pistas };
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { aplicados: unknown[]; revisar: unknown[]; saltados: unknown[]; errores: unknown[]; pistas: number };
  writeFileSync(path.join(OUT, `spotify-tracklists-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} albumes=${r.aplicados.length} ` +
    `pistas=${r.pistas} revisar=${r.revisar.length} saltados=${r.saltados.length} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 6)) console.log("  !", JSON.stringify(e).slice(0, 200));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
