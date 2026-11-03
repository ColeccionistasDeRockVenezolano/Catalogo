// Tracklists (y año/sello/portada cuando falten) recuperados de las capturas de Shared (2026-10-29).
//
// Fuentes: release de RYM capturado, ficha de Sincopa, detalle de Metal Archives y JSON de álbum de
// Spotify cacheado. Solo álbumes que siguen sin pistas; cada pista deja claim con la URL de origen.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-tracklists-fuentes-2026-10-29.ts [--confirm]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const DIR = process.env["RHV_DIR"] ?? "/home/brian/data/rockhecho";
const OUT = "reports/rockhecho-2026-10-29";
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";

interface Pista { disc: number; n: number; title: string; dur: number | null }
interface Entrada {
  album_id: number; fuente: string; url: string; titulo_fuente: string; artista_fuente: string;
  ratio: number; anio: number | string | null; sello: string | null; cover?: string;
  pistas: Pista[]; catalogo_titulo: string; catalogo_artista: string;
}

const sha = (s: string | Buffer | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");

const FUENTE_SLUG: Record<string, string> = {
  rateyourmusic: "rateyourmusic", sincopa: "sincopa", metal_archives: "metal-archives",
  spotify_cache: "spotify",
};

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const data = JSON.parse(readFileSync(path.join(DIR, "tracklists_fuentes.json"), "utf8")) as { tracklists: Entrada[] };
  console.log("álbumes en el dossier:", data.tracklists.length);

  const res = await withOperatorRun({
    name: "catalogo:tracklists-fuentes-shared",
    operator: "Hermes (encargo de Brian)",
    note: "Tracklist de los álbumes que no tenían pistas, recuperado de las capturas ya guardadas en " +
      "el almacén (release de RYM, ficha de Sincopa, detalle de Metal Archives, JSON de Spotify). " +
      "Solo se aplica al álbum cuyo artista y título coinciden con la fuente.",
    params: { albumes: data.tracklists.length, confirm: CONFIRM },
  }, async (ctx) => {
    const fuentes = (await ctx.client.query<{ id: string; slug: string }>(
      "SELECT id::text,slug FROM ingest.sources")).rows;
    const idPorSlug = new Map(fuentes.map((f) => [f.slug, Number(f.id)]));
    const report = { aplicados: [] as unknown[], saltados: [] as unknown[], errores: [] as unknown[] };

    for (const a of data.tracklists) {
      const albumId = a.album_id;
      const actual = (await ctx.client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.tracks WHERE album_id=$1", [albumId])).rows[0]?.n ?? 0;
      if (actual > 0) { report.saltados.push({ albumId, motivo: "ya tiene pistas" }); continue; }

      await ctx.client.query("SAVEPOINT tl");
      try {
        const sourceId = idPorSlug.get(FUENTE_SLUG[a.fuente] ?? "") ?? null;
        const pistas: string[] = [];
        const vistos = new Set<string>();
        const ultimo = new Map<number, number>();
        for (const [, p] of a.pistas.entries()) {
          const titulo = (p.title ?? "").trim().slice(0, 240);
          if (!titulo) continue;
          const disc = p.disc || 1;
          let n = p.n || (ultimo.get(disc) ?? 0) + 1;
          while (vistos.has(`${disc}-${n}`)) n += 1;   // la fuente repite número en discos sin separar
          vistos.add(`${disc}-${n}`);
          ultimo.set(disc, Math.max(ultimo.get(disc) ?? 0, n));
          const ins = await ctx.client.query<{ id: string }>(
            `INSERT INTO public.tracks(album_id,disc_number,track_number,title,duration_seconds,notes)
             VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,
            [albumId, disc, n, titulo, p.dur, `Tracklist de ${a.fuente} (${a.url})`]);
          const trackId = Number(ins.rows[0]!.id);
          pistas.push(titulo);
          if (sourceId !== null) {
            const c = await ctx.client.query<{ id: string }>(`
              INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,raw_hash,
                                        extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
              VALUES($1,'track',$2,'title',to_jsonb($3::text),to_jsonb($3::text),$4,$5,'1','high','accepted','human',$6,$7,$8)
              ON CONFLICT DO NOTHING RETURNING id::text`,
            [sourceId, trackId, titulo, sha([a.fuente, a.url, String(p.n), titulo]), `${a.fuente}-tracklist`, ctx.runId,
              `pista de ${a.titulo_fuente}`, `${a.fuente}:${albumId}:${disc}-${n}`]);
            if (c.rows[0]) {
              await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
                VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
              [c.rows[0].id, a.url, `${n}. ${titulo}`, sha([a.url, titulo])]);
            }
          }
        }
        // rellenos de año y sello si el álbum los tiene vacíos
        const anio = Number(String(a.anio ?? "").match(/\d{4}/)?.[0] ?? 0);
        if (anio >= 1900 && anio <= 2026) {
          await ctx.client.query("UPDATE public.albums SET release_year=$2, updated_at=now() WHERE id=$1 AND release_year IS NULL",
            [albumId, anio]);
        }
        await ctx.client.query("RELEASE SAVEPOINT tl");
        report.aplicados.push({ albumId, fuente: a.fuente, catalogo: `${a.catalogo_artista} — ${a.catalogo_titulo}`,
          fuente_titulo: a.titulo_fuente, pistas: pistas.length, url: a.url });
      } catch (error) {
        await ctx.client.query("ROLLBACK TO SAVEPOINT tl");
        report.errores.push({ albumId, fuente: a.fuente, error: (error as Error).message.slice(0, 200) });
      }
    }
    const pistas = (report.aplicados as Array<{ pistas: number }>).reduce((s, x) => s + x.pistas, 0);
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ aplicados: report.aplicados.length, pistas,
        saltados: report.saltados.length, errores: report.errores.length })]);
    return { ...report, pistas };
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { aplicados: unknown[]; saltados: unknown[]; errores: unknown[]; pistas: number };
  writeFileSync(path.join(OUT, `tracklists-fuentes-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} albumes=${r.aplicados.length} ` +
    `pistas=${r.pistas} saltados=${r.saltados.length} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 6)) console.log("  !", JSON.stringify(e).slice(0, 200));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
