// Campaña RYM 2026-10-15 · FASE 2: aplica al catálogo los enlaces de escucha de las fichas de
// RYM (reports/rym-2026-10-15/enlaces.jsonl) en UN run reversible.
//
// Nada entra sin verificar: cada enlace se comprueba contra la plataforma y su título se compara con
// el del disco del catálogo.
//   spotify     → oEmbed público (open.spotify.com/oembed)         · title
//   apple_music → iTunes lookup (itunes.apple.com/lookup?id=)      · collectionName
//   deezer      → api.deezer.com/album/<id>                        · title
//   tidal       → openapi.tidal.com/v2/albums/<id> (token oficial)  · data.attributes.title
//   bandcamp    → la propia página (og:title)                      · og:title
//   youtube     → youtube.com/oembed                               · title (solo existencia: es vídeo)
//   soundcloud  → NO aquí: va por scripts/apply-soundcloud-chatgpt.ts (lotes en lotes-soundcloud/)
// Existe y coincide → verified=true. Existe y no coincide → verified=false (candidato). No existe →
// se descarta y se reporta.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/03-apply-enlaces.ts [--confirm]
//          [--limit=50] [--plataforma=spotify] [--pausa=300]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

// La campaña «resto» (2026-10-16) reusa esta fase: --dir apunta a sus informes.
const argumento = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const DIR = argumento("--dir") ?? "reports/rym-2026-10-15";
const confirm = process.argv.includes("--confirm");
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);
const solo = process.argv.find((v) => v.startsWith("--plataforma="))?.slice(13);
const pausa = Number(process.argv.find((v) => v.startsWith("--pausa="))?.slice(8) ?? 300);

interface Enlace { albumId: number; platform: string; id: string; url: string; tipo: string; slug: string; titulo: string }
interface Fila { albumId: number; platform: string; url: string; externalId: string | null; verified: boolean; nota: string }

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ").trim();
}

function mismoTitulo(a: string, b: string): boolean {
  const na = normalizar(a), nb = normalizar(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 8 && (nb.startsWith(na) || na.startsWith(nb))) return true;
  const ta = new Set(na.split(" ")), tb = nb.split(" ");
  const comunes = tb.filter((t) => ta.has(t)).length;
  return comunes / Math.max(ta.size, tb.length) >= 0.8;
}

async function json(url: string, init?: RequestInit): Promise<{ status: number; data: unknown }> {
  const r = await fetch(url, { ...init, headers: { "accept": "application/json", "user-agent": "CRV-reproductores/1.0 (+coleccionistasderockvenezolano.com)", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(25000) });
  let data: unknown = null;
  try { data = await r.json(); } catch { /* sin json */ }
  return { status: r.status, data };
}

let tokenTidal: { valor: string; vence: number } | null = null;

async function tituloDe(platform: string, url: string, id: string): Promise<{ ok: boolean; titulo: string | null; detalle: string }> {
  try {
    if (platform === "spotify") {
      const { status, data } = await json(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
      const d = data as { title?: string } | null;
      return { ok: status === 200, titulo: d?.title ?? null, detalle: `spotify oEmbed ${status}` };
    }
    if (platform === "apple_music") {
      const { status, data } = await json(`https://itunes.apple.com/lookup?id=${id}&entity=album`);
      const d = data as { resultCount?: number; results?: Array<{ collectionName?: string }> } | null;
      return { ok: (d?.resultCount ?? 0) > 0, titulo: d?.results?.[0]?.collectionName ?? null, detalle: `itunes lookup ${status}` };
    }
    if (platform === "deezer") {
      const { status, data } = await json(`https://api.deezer.com/album/${id}`);
      const d = data as { id?: number; title?: string; error?: unknown } | null;
      return { ok: status === 200 && !!d?.id, titulo: d?.title ?? null, detalle: `deezer api ${status}` };
    }
    if (platform === "tidal") {
      const cid = process.env["TIDAL_CLIENT_ID"], sec = process.env["TIDAL_CLIENT_SECRET"];
      if (!cid || !sec) return { ok: false, titulo: null, detalle: "faltan credenciales TIDAL" };
      if (!tokenTidal || Date.now() > tokenTidal.vence) {
        const r = await fetch("https://auth.tidal.com/v1/oauth2/token", {
          method: "POST", headers: { "authorization": `Basic ${Buffer.from(`${cid}:${sec}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
          body: "grant_type=client_credentials", signal: AbortSignal.timeout(25000),
        });
        const d = await r.json() as { access_token?: string; expires_in?: number };
        if (!d.access_token) return { ok: false, titulo: null, detalle: `tidal auth ${r.status}` };
        tokenTidal = { valor: d.access_token, vence: Date.now() + (d.expires_in ?? 3600) * 1000 - 120000 };
      }
      const { status, data } = await json(`https://openapi.tidal.com/v2/albums/${id}`, {
        headers: { "authorization": `Bearer ${tokenTidal.valor}`, "accept": "application/vnd.api+json" },
      });
      const d = data as { data?: { attributes?: { title?: string } } } | null;
      return { ok: status === 200 && !!d?.data, titulo: d?.data?.attributes?.title ?? null, detalle: `tidal api ${status}` };
    }
    if (platform === "bandcamp") {
      const r = await fetch(url, { headers: { "user-agent": "CRV-reproductores/1.0" }, signal: AbortSignal.timeout(25000) });
      const html = r.ok ? await r.text() : "";
      const t = /<meta property="og:title" content="([^"]*)"/u.exec(html)?.[1] ?? null;
      return { ok: r.ok && !!t, titulo: t ? t.replace(/&amp;/gu, "&").replace(/&quot;/gu, '"') : null, detalle: `bandcamp ${r.status}` };
    }
    if (platform === "youtube") {
      const { status, data } = await json(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      const d = data as { title?: string } | null;
      return { ok: status === 200, titulo: d?.title ?? null, detalle: `youtube oEmbed ${status}` };
    }
  } catch (error) {
    return { ok: false, titulo: null, detalle: `error de red: ${(error as Error).message}` };
  }
  return { ok: false, titulo: null, detalle: `plataforma sin verificador: ${platform}` };
}

async function main(): Promise<void> {
  const archivo = path.join(DIR, "enlaces.jsonl");
  if (!existsSync(archivo)) { console.error(`no existe ${archivo}`); process.exit(1); }
  const todos = readFileSync(archivo, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Enlace);
  const enlaces = todos.filter((e) => (!solo || e.platform === solo) && e.platform !== "soundcloud");
  const recorte = limite ? enlaces.slice(0, limite) : enlaces;

  const pool = getPool();
  const discos = new Map((await pool.query<{ id: string; artist_id: string; title: string }>(
    "SELECT id::text AS id, artist_id::text AS artist_id, title FROM public.albums WHERE artist_id IS NOT NULL")).rows
    .map((r) => [Number(r.id), { artistId: Number(r.artist_id), title: r.title }]));
  const intocable = new Set((await pool.query<{ k: string }>(`
    SELECT 'd:' || album_id || ':' || platform AS k FROM public.streaming_links
     WHERE album_id IS NOT NULL AND (verified OR source = 'crv-operador')`)).rows.map((r) => r.k));

  const filas: Fila[] = [];
  const verificados: Array<Record<string, unknown>> = [];
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };

  for (const e of recorte) {
    const disco = discos.get(e.albumId);
    if (!disco) { sumar("disco inexistente"); continue; }
    if (intocable.has(`d:${e.albumId}:${e.platform}`)) { sumar(`${e.platform}: ya verificado`); continue; }
    await dormir(pausa);
    const { ok, titulo, detalle } = await tituloDe(e.platform, e.url, e.id);
    if (!ok) { sumar(`${e.platform}: descartado (${detalle})`); verificados.push({ ...e, veredicto: "descartado", detalle }); continue; }
    const calza = titulo ? mismoTitulo(disco.title, titulo) : false;
    const externalId = e.platform === "bandcamp" ? `album=${e.id}` : e.id;
    filas.push({ albumId: e.albumId, platform: e.platform, url: e.url, externalId, verified: calza,
      nota: `RYM · ficha «${e.titulo}» · plataforma: «${titulo ?? "?"}»${calza ? "" : " (título distinto)"}` });
    verificados.push({ ...e, tituloPlataforma: titulo, veredicto: calza ? "verificado" : "candidato (título distinto)", detalle });
    sumar(calza ? `${e.platform}: verificado` : `${e.platform}: candidato`);
  }

  console.log(`enlaces a revisar: ${recorte.length} · filas a escribir: ${filas.length}`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, "verificacion-enlaces.json"), JSON.stringify({ revisados: recorte.length, verificados }, null, 1));

  if (filas.length === 0) { console.log("nada que escribir"); await closeDb(); return; }
  if (!confirm) { writeFileSync(path.join(DIR, "enlaces-ensayo.json"), JSON.stringify(filas, null, 1)); console.log("dry-run: repite con --confirm"); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:rym-enlaces",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Enlaces de escucha de las fichas de RYM capturadas (data-links), verificados contra cada plataforma y con el título del disco comprobado.",
  }, async (context) => {
    let nuevos = 0, actualizados = 0;
    for (const f of filas) {
      const { rows } = await context.client.query<{ nuevo: boolean }>(`
        INSERT INTO public.streaming_links(artist_id, album_id, platform, url, external_id, method, source, verified, notes)
        VALUES(NULL,$1,$2,$3,$4,'exact','rym-data-links',$5,$6)
        ON CONFLICT (album_id, platform) WHERE album_id IS NOT NULL
        DO UPDATE SET url=EXCLUDED.url, external_id=EXCLUDED.external_id, source=EXCLUDED.source,
          verified=EXCLUDED.verified, notes=EXCLUDED.notes
        WHERE NOT streaming_links.verified AND streaming_links.source <> 'crv-operador'
        RETURNING (xmax = 0) AS nuevo`, [f.albumId, f.platform, f.url, f.externalId, f.verified, f.nota]);
      if (rows[0]?.nuevo) nuevos++; else if (rows[0]) actualizados++;
    }
    return { nuevos, actualizados };
  });
  writeFileSync(path.join(DIR, `enlaces-run${runId}.json`), JSON.stringify({ runId, ...result, cuenta }, null, 1));
  console.log(`run ${runId}: ${result.nuevos} nuevos · ${result.actualizados} actualizados (de ${filas.length})`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
