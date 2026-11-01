// Aplica al catálogo lo recuperado de MusicBrainz (musicbrainz.jsonl).
//
// Por álbum: pistas con duración, año, sellos (organizations) y portada del Cover Art Archive.
// Solo toca álbumes que siguen sin pistas; nada se pisa.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-musicbrainz-2026-10-29.ts [--confirm] [--limite=N]
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

interface Pista { disc: number; n: number | string; title: string; dur: number | null }
interface Entrada {
  album_id: string; mbid: string; album: string; artista_mb: string; anio: string | null;
  pais: string | null; sellos: string[]; tipo: string | null; portada: string | null;
  cat_title: string; cat_artista: string; score: number; pistas: Pista[];
}

const sha = (s: string | Buffer | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");
const norm = (t: string): string => (t ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
  .replace(/[^a-z0-9ñ ]+/gu, " ").replace(/\s+/gu, " ").trim();

const TIPO: Record<string, string> = {
  Album: "studio_album", EP: "ep", Single: "single", Demo: "demo",
  Compilation: "compilation", Live: "live_album", "Live Album": "live_album", Soundtrack: "soundtrack",
};

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
    const r = await fetch(url, {
      headers: { "user-agent": "CRV-catalogo/1.0 (+coleccionistasderockvenezolano.com)" },
      redirect: "follow", signal: AbortSignal.timeout(35_000),
    });
    if (!r.ok) return null;
    return guardarBytes(Buffer.from(await r.arrayBuffer()));
  } catch { return null; }
}

function leer(): Entrada[] {
  const rows: Entrada[] = [];
  for (const line of readFileSync(path.join(DIR, "musicbrainz.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as Entrada & { motivo?: string };
      if (d.album_id && d.mbid && d.pistas?.length) rows.push(d);
    } catch { /* línea cortada */ }
  }
  return rows;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const todas = leer();
  const entradas = LIMITE ? todas.slice(0, LIMITE) : todas;
  console.log("álbumes con datos de MusicBrainz:", todas.length, "· a aplicar:", entradas.length);

  const res = await withOperatorRun({
    name: "catalogo:musicbrainz-tracklists",
    operator: "Hermes (encargo de Brian)",
    note: "Tracklist, año, sello y portada de los álbumes del catálogo sin pistas, tomados de " +
      "MusicBrainz y del Cover Art Archive. Se exige coincidencia de artista y título (≥0,80 y ≥0,85).",
    params: { albumes: entradas.length, confirm: CONFIRM },
  }, async (ctx) => {
    const src = await ctx.client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='musicbrainz' LIMIT 1");
    const sourceId = src.rows[0] ? Number(src.rows[0].id) : null;
    const report = { aplicados: [] as unknown[], saltados: [] as unknown[], errores: [] as unknown[] };
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
           VALUES($1,'record_label',$2,$3) RETURNING id::text`,
          [nombre, null, "Alta desde MusicBrainz (2026-10-29)"]);
        id = Number(ins.rows[0]!.id);
      }
      etiquetas.set(key, id);
      return id;
    }

    for (const a of entradas) {
      const albumId = Number(a.album_id);
      const actual = (await ctx.client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.tracks WHERE album_id=$1", [albumId])).rows[0]?.n ?? 0;
      if (actual > 0) { report.saltados.push({ albumId, motivo: "ya tiene pistas" }); continue; }

      await ctx.client.query("SAVEPOINT mb");
      try {
        const url = `https://musicbrainz.org/release/${a.mbid}`;
        const vistos = new Set<string>();
        let n = 0;
        for (const [i, p] of a.pistas.entries()) {
          const titulo = (p.title ?? "").trim().slice(0, 240);
          if (!titulo) continue;
          const disc = p.disc || 1;
          let pos = Number(String(p.n).match(/\d+/)?.[0] ?? i + 1) || i + 1;
          while (vistos.has(`${disc}-${pos}`)) pos += 1;
          vistos.add(`${disc}-${pos}`);
          const ins = await ctx.client.query<{ id: string }>(
            `INSERT INTO public.tracks(album_id,disc_number,track_number,title,duration_seconds,notes)
             VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,
            [albumId, disc, pos, titulo, p.dur, `Tracklist de MusicBrainz (${url})`]);
          n += 1;
          if (sourceId !== null) {
            const c = await ctx.client.query<{ id: string }>(`
              INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,raw_hash,
                                        extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
              VALUES($1,'track',$2,'title',to_jsonb($3::text),to_jsonb($3::text),$4,'musicbrainz','1','high',
                     'accepted','human',$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id::text`,
            [sourceId, Number(ins.rows[0]!.id), titulo, sha(["musicbrainz", a.mbid, String(disc), String(pos), titulo]),
              ctx.runId, `pista de ${a.album}`, `musicbrainz:${a.mbid}:${disc}-${pos}`]);
            if (c.rows[0]) {
              await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
                VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
              [c.rows[0].id, url, `${pos}. ${titulo}`, sha([url, titulo])]);
            }
          }
        }

        // portada del Cover Art Archive
        const saved = a.portada ? await bajar(a.portada) : null;
        if (saved) {
          await ctx.client.query(
            "UPDATE public.albums SET cover_url=$2, updated_at=now() WHERE id=$1 AND coalesce(cover_url,'')=''",
            [albumId, saved]);
        }
        // año y sello
        const anio = Number(String(a.anio ?? "").match(/\d{4}/)?.[0] ?? 0);
        if (anio >= 1900 && anio <= 2026) {
          await ctx.client.query("UPDATE public.albums SET release_year=$2, updated_at=now() WHERE id=$1 AND release_year IS NULL",
            [albumId, anio]);
        }
        let labelId: number | null = null;
        const sello = (a.sellos ?? []).find((s) => s && !/^\[?no label\]?$/i.test(s) && s.length <= 80);
        if (sello) {
          const found = (await ctx.client.query<{ label_id: string | null }>(
            "SELECT label_id::text FROM public.albums WHERE id=$1", [albumId])).rows[0];
          if (!found?.label_id) {
            labelId = await etiqueta(sello);
            await ctx.client.query("UPDATE public.albums SET label_id=$2, updated_at=now() WHERE id=$1 AND label_id IS NULL",
              [albumId, labelId]);
          }
        }
        // tipo, solo si el catálogo no lo tiene decidido
        const tipo = a.tipo ? TIPO[a.tipo] : undefined;
        if (tipo) {
          await ctx.client.query(
            "UPDATE public.albums SET album_type=$2::album_type, updated_at=now() WHERE id=$1 AND album_type='other'",
            [albumId, tipo]);
        }
        await ctx.client.query("RELEASE SAVEPOINT mb");
        report.aplicados.push({ albumId, mbid: a.mbid, catalogo: `${a.cat_artista} — ${a.cat_title}`,
          pistas: n, portada: Boolean(saved), anio: anio || null, sello: sello ?? null, tipo: tipo ?? null });
      } catch (error) {
        await ctx.client.query("ROLLBACK TO SAVEPOINT mb");
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
  writeFileSync(path.join(OUT, `musicbrainz-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} albumes=${r.aplicados.length} ` +
    `pistas=${r.pistas} saltados=${r.saltados.length} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 6)) console.log("  !", JSON.stringify(e).slice(0, 200));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
