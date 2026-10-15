// Campaña 2026-10-15 · FASE 7: redes sociales atribuidas desde lo capturado (reports/redes-2026-10-15/redes.jsonl).
//
//   facebook · instagram · x · tiktok · threads → public.social_links
//   youtube · bandcamp                          → public.streaming_links (perfil del artista)
//
// Verificación: las redes con muro de login no se pueden abrir de forma fiable, así que se marca
// `verified` cuando el usuario de la red COINCIDE con el nombre del artista (normalizado); si no,
// queda candidato (no se publica). YouTube y Bandcamp sí se abren y se lee su título.
// Uso: ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/08-redes.mts [--confirm] [--limit=N]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

const DIR = "reports/redes-2026-10-15";
const confirm = process.argv.includes("--confirm");
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);
const pausa = Number(process.argv.find((v) => v.startsWith("--pausa="))?.slice(8) ?? 300);

interface Fila { artistId: number; platform: string; url: string; handle: string; evidencia: string; matchHandle: boolean; nombreArchivo: string }

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase()
    .replace(/\b(?:official|oficial|music|musica|band|banda|the|el|la|los|las)\b/gu, " ")
    .replace(/[^a-z0-9]+/gu, "");
}

async function tituloDe(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "CRV-reproductores/1.0 (+coleccionistasderockvenezolano.com)" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    const html = await r.text();
    const t = /<meta property="og:title" content="([^"]*)"/u.exec(html)?.[1]
      ?? /<title>([^<]*)<\/title>/u.exec(html)?.[1];
    return t ? t.replace(/&amp;/gu, "&").replace(/&quot;/gu, '"') : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const archivo = path.join(DIR, "redes.jsonl");
  if (!existsSync(archivo)) { console.error(`no existe ${archivo} (fase 7, extracción)`); process.exit(1); }
  const todas = readFileSync(archivo, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Fila);
  const filas = limite ? todas.slice(0, limite) : todas;

  const pool = getPool();
  const artistas = new Map((await pool.query<{ id: string; name: string }>("SELECT id::text AS id, name FROM public.artists")).rows.map((r) => [Number(r.id), r.name]));
  const yaSocial = new Set((await pool.query<{ k: string }>("SELECT artist_id::text || ':' || platform AS k FROM public.social_links")).rows.map((r) => r.k));
  const yaStream = new Set((await pool.query<{ k: string }>("SELECT artist_id::text || ':' || platform AS k FROM public.streaming_links WHERE artist_id IS NOT NULL")).rows.map((r) => r.k));

  const sociales: Array<Fila & { verified: boolean; detalle: string }> = [];
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };

  for (const f of filas) {
    const nombre = artistas.get(f.artistId);
    if (!nombre) { sumar("artista inexistente"); continue; }
    if (f.platform === "youtube" || f.platform === "bandcamp") {
      if (yaStream.has(`${f.artistId}:${f.platform}`)) { sumar(`${f.platform}: ya tenía enlace`); continue; }
      await dormir(pausa);
      const titulo = await tituloDe(f.url);
      const calza = !!titulo && (normalizar(titulo).includes(normalizar(nombre)) || normalizar(nombre).includes(normalizar(f.handle)));
      sociales.push({ ...f, verified: calza, detalle: `${f.platform} · título «${titulo ?? "?"}»` });
      sumar(calza ? `${f.platform}: verificado` : `${f.platform}: candidato`);
      continue;
    }
    if (yaSocial.has(`${f.artistId}:${f.platform}`)) { sumar(`${f.platform}: ya tenía red`); continue; }
    sociales.push({ ...f, verified: f.matchHandle, detalle: `${f.platform} · usuario «${f.handle}» ${f.matchHandle ? "coincide con el nombre" : "no coincide"}` });
    sumar(f.matchHandle ? `${f.platform}: verificado` : `${f.platform}: candidato`);
  }

  console.log(`filas: ${sociales.length}`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);
  if (sociales.length === 0) { await closeDb(); return; }
  if (!confirm) { writeFileSync(path.join(DIR, "aplicacion-ensayo.json"), JSON.stringify(sociales.slice(0, 300), null, 1)); console.log("dry-run: ensayo en aplicacion-ensayo.json"); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:redes-capturas",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Redes sociales (Facebook, Instagram, X, TikTok, Threads) y perfiles de YouTube/Bandcamp atribuidos a artistas del catálogo desde las capturas en disco: verificados cuando el usuario coincide con el nombre del artista o la página lo confirma.",
  }, async (context) => {
    let nuevos = 0, actualizados = 0;
    for (const f of sociales) {
      if (f.platform === "youtube" || f.platform === "bandcamp") {
        const { rows } = await context.client.query<{ nuevo: boolean }>(`
          INSERT INTO public.streaming_links(artist_id, album_id, platform, url, external_id, method, source, verified, notes)
          VALUES($1,NULL,$2,$3,NULL,'fuzzy','capturas-redes',$4,$5)
          ON CONFLICT (artist_id, platform) WHERE artist_id IS NOT NULL
          DO UPDATE SET url=EXCLUDED.url, source=EXCLUDED.source, verified=EXCLUDED.verified, notes=EXCLUDED.notes
          WHERE NOT streaming_links.verified AND streaming_links.source <> 'crv-operador'
          RETURNING (xmax = 0) AS nuevo`, [f.artistId, f.platform, f.url, f.verified, `${f.detalle} · evidencia: ${f.evidencia} · nombre del archivo: «${f.nombreArchivo}»`]);
        if (rows[0]?.nuevo) nuevos++; else if (rows[0]) actualizados++;
        continue;
      }
      const { rows } = await context.client.query<{ nuevo: boolean }>(`
        INSERT INTO public.social_links(artist_id, platform, url, handle, method, source, verified, notes)
        VALUES($1,$2,$3,$4,'fuzzy','capturas-redes',$5,$6)
        ON CONFLICT (artist_id, platform) DO UPDATE SET url=EXCLUDED.url, handle=EXCLUDED.handle,
          source=EXCLUDED.source, verified=EXCLUDED.verified, notes=EXCLUDED.notes
        WHERE (social_links.url, social_links.verified) IS DISTINCT FROM (EXCLUDED.url, EXCLUDED.verified)
        RETURNING (xmax = 0) AS nuevo`,
      [f.artistId, f.platform, f.url, f.handle, f.verified, `${f.detalle} · evidencia: ${f.evidencia}`]);
      if (rows[0]?.nuevo) nuevos++; else if (rows[0]) actualizados++;
    }
    return { nuevos, actualizados };
  });
  writeFileSync(path.join(DIR, `aplicacion-run${runId}.json`), JSON.stringify({ runId, ...result, cuenta }, null, 1));
  console.log(`run ${runId}: ${result.nuevos} nuevas · ${result.actualizados} actualizadas (de ${sociales.length})`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
