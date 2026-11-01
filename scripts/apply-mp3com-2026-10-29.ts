// Aplica la discografía de mp3.com 2003 (discografia-venezolanos.jsonl) a los álbumes sin pistas.
//
// 401 artistas venezolanos con álbumes, pistas, sello y créditos por tema. Se cruza por artista y
// título exactos y solo se rellena lo vacío: pistas, sello (organizations) y una nota con los
// créditos que declara la fuente.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-mp3com-2026-10-29.ts [--confirm]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const DIR = process.env["RHV_DIR"] ?? "/home/brian/data/rockhecho";
const OUT = "reports/rockhecho-2026-10-29";
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";

interface Pista { disc: number; n: number; title: string; dur: number | null; credits?: string | null }
interface Entrada {
  album_id: number; cat_artista: string; cat_title: string; album: string;
  sello: string | null; pistas: Pista[]; creditos: string[];
}

const sha = (s: string | Buffer | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");
const norm = (t: string): string => (t ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
  .replace(/[^a-z0-9ñ ]+/gu, " ").replace(/\s+/gu, " ").trim();

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const entradas = JSON.parse(readFileSync(path.join(DIR, "mp3com_cruce.json"), "utf8")) as Entrada[];
  console.log("álbumes cruzados con mp3.com 2003:", entradas.length);

  const res = await withOperatorRun({
    name: "catalogo:mp3com-2003",
    operator: "Hermes (encargo de Brian)",
    note: "Pistas, sello y créditos de la discografía venezolana compilada de mp3.com (captura de " +
      "2003, 401 artistas). Solo se rellena lo vacío en los álbumes que ya existen.",
    params: { albumes: entradas.length, confirm: CONFIRM },
  }, async (ctx) => {
    const src = await ctx.client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='mp3-com-2003-project' LIMIT 1");
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
          `INSERT INTO public.organizations(name,organization_type,notes) VALUES($1,'record_label',$2) RETURNING id::text`,
          [nombre, "Alta desde mp3.com 2003 (2026-10-29)"]);
        id = Number(ins.rows[0]!.id);
      }
      etiquetas.set(key, id);
      return id;
    }

    for (const a of entradas) {
      const albumId = a.album_id;
      await ctx.client.query("SAVEPOINT mc");
      try {
        const actual = (await ctx.client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM public.tracks WHERE album_id=$1", [albumId])).rows[0]?.n ?? 0;
        let n = 0;
        if (actual === 0) {
          const vistos = new Set<number>();
          for (const [i, p] of a.pistas.entries()) {
            const titulo = (p.title ?? "").trim().slice(0, 240);
            if (!titulo) continue;
            let pos = p.n || i + 1;
            while (vistos.has(pos)) pos += 1;
            vistos.add(pos);
            const ins = await ctx.client.query<{ id: string }>(
              `INSERT INTO public.tracks(album_id,disc_number,track_number,title,notes)
               VALUES($1,1,$2,$3,$4) RETURNING id::text`,
              [albumId, pos, titulo, `Tema de la ficha de mp3.com 2003 (${a.album})`]);
            n += 1;
            if (sourceId !== null) {
              const c = await ctx.client.query<{ id: string }>(`
                INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,raw_hash,
                                          extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
                VALUES($1,'track',$2,'title',to_jsonb($3::text),to_jsonb($3::text),$4,'mp3com-2003','1','medium',
                       'accepted','human',$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id::text`,
              [sourceId, Number(ins.rows[0]!.id), titulo, sha(["mp3com", String(albumId), String(pos), titulo]),
                ctx.runId, `tema de ${a.album}`, `mp3com:${albumId}:${pos}`]);
              if (c.rows[0]) {
                const url = "https://web.archive.org/web/2003/http://mp3.com/";
                await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
                  VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
                [c.rows[0].id, url, `${pos}. ${titulo}${p.credits ? ` — ${p.credits}` : ""}`, sha([url, titulo])]);
              }
            }
          }
        }
        let labelId: number | null = null;
        if (a.sello && a.sello.length <= 80) {
          const found = (await ctx.client.query<{ label_id: string | null }>(
            "SELECT label_id::text FROM public.albums WHERE id=$1", [albumId])).rows[0];
          if (!found?.label_id) {
            labelId = await etiqueta(a.sello);
            await ctx.client.query("UPDATE public.albums SET label_id=$2, updated_at=now() WHERE id=$1 AND label_id IS NULL",
              [albumId, labelId]);
          }
        }
        if (a.creditos.length > 0) {
          const nota = `Créditos (mp3.com 2003): ${a.creditos.join("; ").slice(0, 900)}`;
          await ctx.client.query(
            `UPDATE public.albums SET notes = trim(both E'\\n' from coalesce(notes,'') || E'\\n' || $2), updated_at=now()
             WHERE id=$1 AND coalesce(notes,'') NOT LIKE '%mp3.com 2003%'`, [albumId, nota]);
        }
        await ctx.client.query("RELEASE SAVEPOINT mc");
        report.aplicados.push({ albumId, catalogo: `${a.cat_artista} — ${a.cat_title}`,
          pistas: n, sello: a.sello ?? null, creditos: a.creditos.length > 0 });
      } catch (error) {
        await ctx.client.query("ROLLBACK TO SAVEPOINT mc");
        report.errores.push({ albumId, error: (error as Error).message.slice(0, 200) });
      }
    }
    const pistas = (report.aplicados as Array<{ pistas: number }>).reduce((s, x) => s + x.pistas, 0);
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ aplicados: report.aplicados.length, pistas,
        errores: report.errores.length })]);
    return { ...report, pistas };
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { aplicados: unknown[]; errores: unknown[]; pistas: number };
  writeFileSync(path.join(OUT, `mp3com-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} albumes=${r.aplicados.length} ` +
    `pistas=${r.pistas} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 6)) console.log("  !", JSON.stringify(e).slice(0, 180));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
