// Rellenos de rockhechovenezuela.com sobre el catálogo (2026-10-29).
//
// La absorción del directorio ya se hizo el 2026-10-25 (run 33519, 869 discos nuevos). Este script
// NO repite aquello: solo rellena lo que sigue vacío hoy, campo a campo, con evidencia de la ficha.
//
//   artistas : origin_city · formed_year · picture_url · social_links
//   álbumes  : label_id · cover_url · pistas que falten en un tracklist incompleto
//
// Escritura directa al core dentro de UN run del operador, con claim + claim_evidence + merge_audit
// por campo (mismo patrón que apply-biographies.ts) para que todo se deshaga con `runs undo <run>`.
// Nunca pisa: cada UPDATE exige que la columna siga NULL.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-rockhecho-2026-10-29.ts [--confirm]
//        [--fase=artistas|albumes|todas] [--solo="Nombre"] [--limit=N]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun, type OperatorContext } from "../src/merge/operator.js";

const DIR = process.env["RHV_DIR"] ?? "/home/brian/data/rockhecho";
const OUT = "reports/rockhecho-2026-10-29";
const MEDIA_ROOT = path.resolve("web/public/media");
const SOURCE_SLUG = "rock-hecho-en-venezuela";
const EXTRACTOR = "rockhecho-captura-2026-10-29";

const arg = (n: string): string | undefined => {
  const eq = process.argv.find((v) => v.startsWith(`${n}=`));
  if (eq) return eq.slice(n.length + 1);
  const i = process.argv.indexOf(n);
  return i < 0 ? undefined : process.argv[i + 1];
};
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";
const FASE = arg("--fase") ?? "todas";
const SOLO = arg("--solo");
const LIMIT = Number((process.argv.find((v) => v.startsWith("--limit="))?.slice(8)) ?? 0);

const sha = (s: string | Buffer | unknown[]): string =>
  createHash("sha256").update(Array.isArray(s) ? JSON.stringify(s) : s).digest("hex");
const norm = (t: string): string => (t ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
  .replace(/[^a-z0-9ñ ]+/gu, " ").replace(/\s+/gu, " ").trim();

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function csv(file: string): Array<Record<string, string>> {
  const lines = readFileSync(path.join(DIR, file), "utf8").split(/\r?\n/u).filter((l) => l.length > 0);
  const head = parseCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    head.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

interface Band {
  title: string; url: string; categories: string[]; picture: string | null;
  bio_facts: { formed_year: number | null; formed_phrase: string | null };
  socials: Array<{ net: string; url: string }>;
}
interface Match { title: string; url: string; matches: Array<{ score: number; id: number; name: string }> }

const bands: Band[] = (JSON.parse(readFileSync(path.join(DIR, "bands.json"), "utf8")) as { bands: Band[] }).bands;
const matches: Match[] = JSON.parse(readFileSync(path.join(DIR, "match.json"), "utf8")) as Match[];
const discos = csv("discos_cruce.csv");
const portadas = csv("portadas.csv");

const matchByUrl = new Map(matches.map((m) => [m.url, m]));
const portadaIdx = new Map<string, string>();
for (const p of portadas) {
  if (p["estado_img"] === "ok" || p["estado_img"] === "cached") {
    portadaIdx.set(`${norm(p["banda"] ?? "")}|${norm(p["titulo"] ?? "")}|${p["anio"] ?? ""}`, p["archivo"] ?? "");
  }
}

// social_links tiene CHECK cerrado (instagram, facebook, x, tiktok, threads, bluesky, website,
// store, linktree); youtube/bandcamp/soundcloud/spotify van a streaming_links.
const REDES: Record<string, string> = {
  "instagram.com": "instagram", "facebook.com": "facebook", "fb.com": "facebook", "fb.me": "facebook",
  "twitter.com": "x", "x.com": "x", "tiktok.com": "tiktok", "threads.net": "threads",
  "threads.com": "threads", "bsky.app": "bluesky",
};
const ESCUCHA: Record<string, string> = {
  "youtube.com": "youtube", "youtu.be": "youtube", "bandcamp.com": "bandcamp",
  "soundcloud.com": "soundcloud", "spotify.com": "spotify", "music.apple.com": "apple_music",
  "deezer.com": "deezer",
};

function clasificar(url: string): { platform: string; handle: string | null; tabla: "social" | "streaming" } | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./u, "").replace(/^m\./u, "");
  const sufSocial = Object.keys(REDES).find((d) => host === d || host.endsWith(`.${d}`));
  const sufEscucha = Object.keys(ESCUCHA).find((d) => host === d || host.endsWith(`.${d}`));
  if (!sufSocial && !sufEscucha) return null;
  const segs = u.pathname.split("/").map((s) => s.trim()).filter(Boolean);
  const primero = segs[0]?.toLowerCase() ?? "";
  const handle = segs[0] && !["share", "intent", "watch", "playlist", "results", "channel", "p", "reel", "user"].includes(primero)
    ? segs[0]!.replace(/^@/u, "") : null;
  if (sufSocial) return { platform: REDES[sufSocial]!, handle, tabla: "social" };
  return { platform: ESCUCHA[sufEscucha!]!, handle, tabla: "streaming" };
}

function guardarBytes(bytes: Buffer): { url: string; sha256: string; bytes: number } | null {
  if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) return null;
  const head = bytes.subarray(0, 12);
  const ext = head[0] === 0xff && head[1] === 0xd8 ? "jpg"
    : head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png"
      : head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP" ? "webp"
        : "";
  if (!ext) return null;
  const digest = sha(bytes);
  const dir = path.join(MEDIA_ROOT, "curated");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${digest}.${ext}`), bytes);
  return { url: `/crv/media/curated/${digest}.${ext}`, sha256: digest, bytes: bytes.length };
}

function guardarLocal(archivo: string): { url: string; sha256: string; bytes: number } | null {
  const full = path.join(DIR, "imgs", archivo);
  if (!existsSync(full)) return null;
  return guardarBytes(readFileSync(full));
}

async function guardarRemota(url: string): Promise<{ url: string; sha256: string; bytes: number } | null> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "CRV-catalogo/1.0 (+coleccionistasderockvenezolano.com)" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return null;
    return guardarBytes(Buffer.from(await r.arrayBuffer()));
  } catch { return null; }
}

interface Contexto { ctx: OperatorContext; sourceId: number; runId: number }

/** Aísla un ítem en un SAVEPOINT: un CHECK o un duplicado no tumba el lote. */
async function intentar<T>(ctx: OperatorContext, fn: () => Promise<T>):
  Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  await ctx.client.query("SAVEPOINT item");
  try {
    const value = await fn();
    await ctx.client.query("RELEASE SAVEPOINT item");
    return { ok: true, value };
  } catch (error) {
    await ctx.client.query("ROLLBACK TO SAVEPOINT item");
    return { ok: false, error: (error as Error).message.slice(0, 240) };
  }
}

/**
 * Escribe un campo del core solo si sigue vacío, y deja claim + evidencia + auditoría.
 * Devuelve "aplicado" | "ocupado" | "error".
 */
async function escribirCampo(
  c: Contexto, kind: "artist" | "album", id: number, field: string, column: string,
  value: string | number, url: string, excerpt: string,
): Promise<"aplicado" | "ocupado" | "error"> {
  const tabla = kind === "artist" ? "public.artists" : "public.albums";
  const idCol = kind === "artist" ? "artist_id" : "album_id";
  const client: PoolClient = c.ctx.client;
  const upd = await client.query(
    `UPDATE ${tabla} SET ${column}=$2, updated_at=now() WHERE id=$1 AND ${column} IS NULL RETURNING id`,
    [id, value]);
  if (upd.rowCount === 0) return "ocupado";
  const claim = await client.query<{ id: string }>(`
    INSERT INTO ingest.claims(source_id,entity_kind,${idCol},field,raw_value,normalized_value,raw_hash,extractor,
                              extractor_version,confidence,status,created_by,run_id,notes,identity_key)
    VALUES($1,$2,$3,$4,to_jsonb($5::text),to_jsonb($5::text),$6,$7,'1','medium','accepted','human',$8,$9,$10)
    ON CONFLICT DO NOTHING RETURNING id::text`,
  [c.sourceId, kind, id, field, String(value), sha([EXTRACTOR, kind, id, field, String(value)]), EXTRACTOR,
    c.runId, `relleno desde ${url}`, `${EXTRACTOR}:${kind}:${id}:${field}`]);
  const claimId = claim.rows[0]?.id;
  if (claimId) {
    await client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
      VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`, [claimId, url, excerpt.slice(0, 480), sha([url, excerpt.slice(0, 480)])]);
    const audit = await client.query<{ id: string }>(`
      INSERT INTO ingest.merge_audit(run_id,entity_kind,${idCol},field,old_value,new_value,reason,confidence,performed_by)
      VALUES($1,$2,$3,$4,NULL,to_jsonb($5::text),$6,'medium','human') RETURNING id::text`,
    [c.runId, kind, id, field, String(value), `relleno RHV: ${excerpt.slice(0, 200)}`]);
    if (audit.rows[0]) {
      await client.query("INSERT INTO ingest.merge_audit_claims(merge_audit_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [audit.rows[0].id, claimId]);
    }
  }
  return "aplicado";
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const res = await withOperatorRun({
    name: "catalogo:rockhecho-rellenos-2026-10-29",
    operator: "Hermes (encargo de Brian)",
    note: "Rellenar solo campos vacíos del catálogo con la captura de rockhechovenezuela.com del " +
      "2026-10-29: ciudad y año de formación, foto, redes, sello, portada y pistas que faltan en un " +
      "tracklist incompleto. La absorción de discos ya se hizo en el run 33519; aquí no se crean discos.",
    params: { fase: FASE, solo: SOLO ?? null, confirm: CONFIRM },
  }, async (ctx) => {
    const src = await ctx.client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SOURCE_SLUG]);
    if (!src.rows[0]) throw new Error(`falta la fuente ${SOURCE_SLUG}`);
    const c: Contexto = { ctx, sourceId: Number(src.rows[0].id), runId: ctx.runId };
    const report = {
      ciudad: [] as unknown[], anio: [] as unknown[], foto: [] as unknown[], redes: [] as unknown[],
      ocupado: 0, errores: [] as unknown[],
      sello: [] as unknown[], portada: [] as unknown[], pistas: [] as unknown[],
    };

    if (FASE === "todas" || FASE === "artistas") {
      const ciudades = new Set((await ctx.client.query<{ c: string }>(
        "SELECT DISTINCT origin_city AS c FROM public.artists WHERE origin_city IS NOT NULL")).rows.map((r) => norm(r.c)));
      let n = 0;
      for (const band of bands) {
        if (LIMIT && n >= LIMIT) break;
        if (SOLO && norm(band.title) !== norm(SOLO)) continue;
        const top = matchByUrl.get(band.url)?.matches?.[0];
        if (!top || top.score < 0.92) continue;
        const cur = (await ctx.client.query<{ origin_city: string | null; formed_year: number | null; picture_url: string | null }>(
          "SELECT origin_city, formed_year, picture_url FROM public.artists WHERE id=$1", [top.id])).rows[0];
        if (!cur) continue;
        let tocado = false;

        if (!cur.origin_city) {
          const ciudad = (band.categories ?? []).map((x) => x.trim()).find((x) => {
            const k = norm(x);
            if (k.length < 3) return false;
            return ciudades.has(k) || [...ciudades].some((y) => y === k || y.startsWith(`${k} `) || k.startsWith(`${y} `));
          });
          if (ciudad) {
            const r = await escribirCampo(c, "artist", top.id, "origin_city", "origin_city", ciudad, band.url,
              `categorías de la ficha: ${(band.categories ?? []).join(", ")}`);
            if (r === "aplicado") { report.ciudad.push({ id: top.id, name: top.name, valor: ciudad }); tocado = true; }
            else if (r === "ocupado") report.ocupado += 1;
          }
        }

        if (cur.formed_year === null) {
          const y = band.bio_facts.formed_year;
          if (y && y >= 1950 && y <= 2026) {
            const r = await escribirCampo(c, "artist", top.id, "formed_year", "formed_year", y, band.url,
              `«${(band.bio_facts.formed_phrase ?? "").replace(/\s+/gu, " ").slice(0, 300)}»`);
            if (r === "aplicado") { report.anio.push({ id: top.id, name: top.name, valor: y, frase: band.bio_facts.formed_phrase }); tocado = true; }
            else if (r === "ocupado") report.ocupado += 1;
          }
        }

        if (!cur.picture_url && band.picture) {
          const saved = await guardarRemota(band.picture);
          if (saved) {
            const r = await escribirCampo(c, "artist", top.id, "picture_url", "picture_url", saved.url, band.url,
              `imagen principal de la ficha (${band.picture})`);
            if (r === "aplicado") { report.foto.push({ id: top.id, name: top.name, url: saved.url, origen: band.picture }); tocado = true; }
            else if (r === "ocupado") report.ocupado += 1;
          }
        }

        if ((band.socials ?? []).length > 0) {
          const existentes = (await ctx.client.query<{ platform: string; url: string }>(
            "SELECT platform, url FROM public.social_links WHERE artist_id=$1", [top.id])).rows;
          const stream = (await ctx.client.query<{ platform: string; url: string }>(
            "SELECT platform, url FROM public.streaming_links WHERE artist_id=$1", [top.id])).rows;
          const plat = new Set([...existentes, ...stream].map((e) => e.platform));
          const urls = new Set([...existentes, ...stream].map((e) => e.url.replace(/\/+$/u, "").toLowerCase()));
          for (const s of band.socials) {
            const cls = clasificar(s.url);
            if (!cls) continue;
            if (plat.has(cls.platform)) continue;
            if (urls.has(s.url.replace(/\/+$/u, "").toLowerCase())) continue;
            const ins = await intentar(ctx, () => cls.tabla === "social"
              ? ctx.client.query(
                `INSERT INTO public.social_links(artist_id,platform,url,handle,method,source,verified,notes)
                 VALUES($1,$2,$3,$4,'scrape',$5,false,$6) RETURNING id`,
                [top.id, cls.platform, s.url, cls.handle, SOURCE_SLUG, `Red social declarada en ${band.url}`])
              : ctx.client.query(
                `INSERT INTO public.streaming_links(artist_id,platform,url,method,source,verified,notes)
                 VALUES($1,$2,$3,'scrape',$4,false,$5) RETURNING id`,
                [top.id, cls.platform, s.url, SOURCE_SLUG, `Perfil de escucha declarado en ${band.url}`]));
            if (!ins.ok) { report.errores.push({ fase: "red", id: top.id, url: s.url, error: ins.error }); continue; }
            if (ins.value.rowCount) {
              plat.add(cls.platform); urls.add(s.url.toLowerCase());
              report.redes.push({ id: top.id, name: top.name, red: cls.platform, url: s.url });
              tocado = true;
            }
          }
        }
        if (tocado) n += 1;
      }
    }

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
        const claim = await ctx.client.query<{ id: string }>(`
          INSERT INTO ingest.claims(source_id,entity_kind,organization_id,field,raw_value,normalized_value,raw_hash,
                                    extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
          VALUES($1,'organization',$2,'name',to_jsonb($3::text),to_jsonb($3::text),$4,$5,'1','medium','accepted','human',$6,$7,$8)
          ON CONFLICT DO NOTHING RETURNING id::text`,
        [c.sourceId, id, nombre, sha([EXTRACTOR, "org", nombre]), EXTRACTOR, c.runId,
          "sello citado en la discografía de la fuente", `${EXTRACTOR}:organization:${id}:name`]);
        if (claim.rows[0]) {
          await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
            VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
          [claim.rows[0].id, `crv-catalogo://${SOURCE_SLUG}`, `sello «${nombre}» citado en RHV`, sha([nombre])]);
        }
      }
      etiquetas.set(key, id);
      return id;
    }

    if (FASE === "todas" || FASE === "albumes") {
      for (const row of discos) {
        if (SOLO && norm(row["banda"] ?? "") !== norm(SOLO)) continue;
        if (row["estado"] === "NUEVO" || !row["album_id"]) continue;
        const albumId = Number(row["album_id"]);
        const url = row["banda_url"] ?? "";

        const selloOk = (row["sello"] ?? "").length > 1 && (row["sello"] ?? "").length <= 28
          && !/tetero|vol\.|recopilaci/i.test(row["sello"] ?? "");
        if (row["sello_tipo"] === "real" && !row["cat_label"] && row["sello"] && selloOk) {
          const id = await etiqueta(row["sello"]);
          const r = await escribirCampo(c, "album", albumId, "label_id", "label_id", id, url,
            `sello «${row["sello"]}» en la ficha del disco «${row["titulo"]}»`);
          if (r === "aplicado") report.sello.push({ albumId, banda: row["banda"], titulo: row["titulo"], sello: row["sello"], labelId: id });
          else if (r === "ocupado") report.ocupado += 1;
        }

        if (row["cat_cover"] === "no") {
          const archivo = portadaIdx.get(`${norm(row["banda"]!)}|${norm(row["titulo"]!)}|${row["anio"] ?? ""}`);
          const saved = archivo ? guardarLocal(archivo) : null;
          if (saved) {
            const r = await escribirCampo(c, "album", albumId, "cover_url", "cover_url", saved.url, url,
              `portada de «${row["titulo"]}» en la ficha (160×160, referencia)`);
            if (r === "aplicado") report.portada.push({ albumId, banda: row["banda"], titulo: row["titulo"], url: saved.url });
            else if (r === "ocupado") report.ocupado += 1;
          }
        }

        const nTemas = Number(row["n_temas"] ?? 0);
        const catTracks = Number(row["cat_tracks"] ?? 0);
        if (nTemas > catTracks && nTemas > 0) {
          const temas = (row["temas"] ?? "").split("|").map((t) => t.trim()).filter((t) => t && t.length <= 240);
          const actuales = new Set((await ctx.client.query<{ title: string }>(
            "SELECT title FROM public.tracks WHERE album_id=$1", [albumId])).rows.map((t) => norm(t.title)));
          let pos = (await ctx.client.query<{ n: number }>(
            "SELECT COALESCE(MAX(track_number),0) AS n FROM public.tracks WHERE album_id=$1 AND disc_number=1", [albumId])).rows[0]?.n ?? 0;
          const añadidos: Array<{ id: number; title: string }> = [];
          for (const t of temas) {
            if (actuales.has(norm(t))) continue;
            pos += 1;
            const ins = await ctx.client.query<{ id: string }>(
              `INSERT INTO public.tracks(album_id,disc_number,track_number,title,notes)
               VALUES($1,1,$2,$3,$4) RETURNING id::text`,
              [albumId, pos, t, `Pista añadida desde Rock Hecho Venezuela (${url}) — posición al final, revisar orden`]);
            const trackId = Number(ins.rows[0]!.id);
            actuales.add(norm(t));
            añadidos.push({ id: trackId, title: t });
            const claim = await ctx.client.query<{ id: string }>(`
              INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,raw_hash,
                                        extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
              VALUES($1,'track',$2,'title',to_jsonb($3::text),to_jsonb($3::text),$4,$5,'1','medium','accepted','human',$6,$7,$8)
              ON CONFLICT DO NOTHING RETURNING id::text`,
            [c.sourceId, trackId, t, sha([EXTRACTOR, "track", String(trackId), t]), EXTRACTOR, c.runId,
              `lista de temas de la ficha de ${row["banda"]}`, `${EXTRACTOR}:track:${trackId}:title`]);
            if (claim.rows[0]) {
              await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
                VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
              [claim.rows[0].id, url, `«${t}» en la lista de temas de «${row["titulo"]}»`, sha([url, t])]);
            }
          }
          if (añadidos.length > 0) report.pistas.push({ albumId, banda: row["banda"], titulo: row["titulo"], añadidas: añadidos.length, temas: añadidos.map((x) => x.title) });
        }
      }
    }

    const total = report.ciudad.length + report.anio.length + report.foto.length + report.redes.length
      + report.sello.length + report.portada.length + report.pistas.length;
    await ctx.client.query(
      "UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ ciudad: report.ciudad.length, anio: report.anio.length, foto: report.foto.length,
        redes: report.redes.length, sello: report.sello.length, portada: report.portada.length,
        pistas: report.pistas.length, ocupado: report.ocupado, total })]);
    return report;
  }, { rollbackOnly: !CONFIRM });

  const out = { dryRun: !CONFIRM, fase: FASE, runId: CONFIRM ? res.runId : null, ...(res.result as object) };
  writeFileSync(path.join(OUT, `rellenos-${CONFIRM ? "real" : "ensayo"}-${FASE}.json`), JSON.stringify(out, null, 2) + "\n");
  const r = res.result;
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} · ciudad=${r["ciudad"]!.length} año=${r["anio"]!.length} ` +
    `foto=${r["foto"]!.length} redes=${r["redes"]!.length} sello=${r["sello"]!.length} portada=${r["portada"]!.length} ` +
    `pistas=${r["pistas"]!.length} ocupado=${r["ocupado"]} errores=${r["errores"]!.length}`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
