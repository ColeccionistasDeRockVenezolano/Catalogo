// Campaña 2026-10-16 · bloque C — APLICADOR de redes sociales (libro de evidencia → catálogo).
//
// Entrada: libros de evidencia JSONL en `reports/redes-2026-10-16/` con la forma
//   {artistId, artista, urls[], guarda, fuente, …}
// (los produce `harvest-social-discogs.mts` y `harvest-social-wikidata.mts`; cada URL se mapea a su
// red por el dominio, nunca por parecido de texto).
//
// Destino:
//   instagram · facebook · x · tiktok · threads · bluesky  → public.social_links (0040)
//   youtube · bandcamp (perfil del artista)                → public.streaming_links (0039)
//
// Reglas duras:
//   · NUNCA pisa una fila `verified` ni una de `source='crv-operador'`.
//   · `verified=true` solo si el USUARIO de la red coincide con el nombre del artista
//     (normalizado, sin adornos), que es la señal medida en esta casa; si no, queda CANDIDATO
//     (verified=false: no se publica, va a Curaduría).
//   · Todo se escribe en UN run del operador (`withOperatorRun`) → reversible desde Historial.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-social-links.ts [--confirm] [--solo=discogs]
//        [--limit=N] [--dir=reports/redes-2026-10-16]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const arg = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const confirm = process.argv.includes("--confirm");
const solo = arg("--solo");
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);
const DIR = path.resolve(arg("--dir") ?? "reports/redes-2026-10-16");

interface Evidencia { artistId: number; artista: string; urls: string[]; guarda?: string; fuente?: string; }
interface Filas {
  tabla: "social" | "streaming"; artistId: number; artista: string; platform: string;
  url: string; handle: string | null; verified: boolean; nota: string;
}

const REDES_SOCIALES: Record<string, string> = {
  "instagram.com": "instagram", "facebook.com": "facebook", "fb.com": "facebook", "fb.me": "facebook",
  "twitter.com": "x", "x.com": "x", "tiktok.com": "tiktok", "threads.net": "threads",
  "threads.com": "threads", "bsky.app": "bluesky",
};
const PERFILES_ESCUCHA: Record<string, string> = { "youtube.com": "youtube", "youtu.be": "youtube", "bandcamp.com": "bandcamp" };
// Rutas que NO son un perfil (botones de compartir, buscadores, agrupaciones, login…).
const RUTAS_RESERVADAS = new Set([
  "share", "sharer", "sharer.php", "share.php", "intent", "intents", "dialog", "plugins", "watch",
  "playlist", "results", "hashtag", "explore", "login", "signup", "help", "about", "p", "reel",
  "reels", "tv", "stories", "groups", "pages", "search", "policy", "policies", "terms", "privacy",
  "settings", "account", "profile.php", "embed", "v", "c", "user", "channel", "playlists",
]);

function normalizar(texto: string): string {
  return (texto ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(/\b(?:official|oficial|music|musica|band|banda|the|el|la|los|las)\b/gu, " ")
    .replace(/[^a-z0-9]+/gu, "");
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Título real de una página (og:title o <title>) — la prueba para perfiles de escucha. */
async function tituloDe(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "CRV-reproductores/1.0 (+coleccionistasderockvenezolano.com)" },
      redirect: "follow", signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const titulo = /<meta property="og:title" content="([^"]*)"/u.exec(html)?.[1]
      ?? /<title>([^<]*)<\/title>/u.exec(html)?.[1];
    return titulo ? titulo.replace(/&amp;/gu, "&").replace(/&quot;/gu, '"').trim() : null;
  } catch {
    return null;
  }
}

/** URL → {plataforma, usuario, tabla} o null si no es una red que guardemos. */
function clasificar(url: string): { platform: string; handle: string | null; tabla: "social" | "streaming" } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./u, "").replace(/^m\./u, "");
  const sufijo = Object.keys({ ...REDES_SOCIALES, ...PERFILES_ESCUCHA }).find((d) => host === d || host.endsWith(`.${d}`));
  if (!sufijo) return null;
  const esSocial = sufijo in REDES_SOCIALES;
  const platform = esSocial ? REDES_SOCIALES[sufijo]! : PERFILES_ESCUCHA[sufijo]!;
  const segmentos = parsed.pathname.split("/").map((s) => s.trim()).filter(Boolean);
  if (segmentos.length === 0) return null;
  const primero = segmentos[0]!.toLowerCase();
  // Canal de YouTube por id (/channel/UC…): es un perfil válido, pero sin usuario legible.
  if (plataformaDe(sufijo) === "youtube" && primero === "channel" && segmentos[1]) {
    return { platform: "youtube", handle: segmentos[1]!, tabla: "streaming" };
  }
  if (RUTAS_RESERVADAS.has(primero)) return null;
  if (!esSocial && platform === "bandcamp" && !host.endsWith(".bandcamp.com")) return null;
  if (platform === "bluesky") {
    const usuario = segmentos[1] ?? "";
    return usuario ? { platform, handle: usuario.replace(/^@/u, "").toLowerCase(), tabla: "social" } : null;
  }
  const usuario = segmentos[0]!.replace(/^@/u, "");
  if (!/^[A-Za-z0-9._-]{2,}$/u.test(usuario)) return null;
  return { platform, handle: usuario.toLowerCase(), tabla: esSocial ? "social" : "streaming" };
}

function plataformaDe(sufijo: string): string {
  return REDES_SOCIALES[sufijo] ?? PERFILES_ESCUCHA[sufijo] ?? "";
}

function libros(dir: string): string[] {
  const nombres = readdirSync(dir).filter((n) => /^evidencia-.*\.jsonl$/u.test(n));
  return nombres.filter((n) => (solo ? n.includes(solo) : true)).map((n) => path.join(dir, n));
}

async function main(): Promise<void> {
  const archivos = libros(DIR);
  if (archivos.length === 0) throw new Error(`no hay libros de evidencia (evidencia-*.jsonl) en ${DIR}`);

  const filas: Filas[] = [];
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };
  const porClave = new Map<string, Filas>(); // artistId:platform (global, gana el verified)

  for (const archivo of archivos) {
    const evidencias = readFileSync(archivo, "utf8").split("\n").filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Evidencia);
    for (const e of evidencias) {
      const nombre = normalizar(e.artista);
      for (const url of e.urls ?? []) {
        const cl = clasificar(url);
        if (!cl) { sumar("url fuera de catálogo de redes"); continue; }
        let verified = false;
        if (cl.handle && nombre.length >= 4) {
          const usuario = normalizar(cl.handle);
          verified = usuario === nombre
            || (usuario.length >= 5 && (usuario.includes(nombre) || nombre.includes(usuario)));
        }
        const clave = `${e.artistId}:${cl.platform}`;
        const previa = porClave.get(clave);
        if (previa) {
          if (!previa.verified && verified) {
            previa.url = url; previa.handle = cl.handle; previa.verified = true;
            previa.nota = notaDe(e, cl.handle, verified);
          }
          continue;
        }
        const fila: Filas = {
          tabla: cl.tabla, artistId: e.artistId, artista: e.artista, platform: cl.platform,
          url: url.trim(), handle: cl.handle, verified, nota: notaDe(e, cl.handle, verified),
        };
        porClave.set(clave, fila);
        filas.push(fila);
        if (cl.tabla === "social") sumar(`${cl.tabla}:${cl.platform}:${verified ? "verificado" : "candidato"}`);
      }
    }
  }

  // Perfiles de escucha (YouTube/Bandcamp): se ABREN y se lee su título — la identidad del perfil
  // no se puede probar por el usuario, así que sin título que case queda candidato.
  const escucha = filas.filter((f) => f.tabla === "streaming");
  if (escucha.length > 0) {
    console.log(`verificando ${escucha.length} perfiles de escucha (og:title)…`);
    for (const f of escucha) {
      const titulo = await tituloDe(f.url);
      const nombre = normalizar(f.artista);
      const tituloN = normalizar(titulo ?? "");
      const coincide = nombre.length >= 4 && tituloN.length > 0 && (tituloN.includes(nombre) || nombre.includes(tituloN));
      f.verified = coincide;
      f.nota += ` · título de la página «${titulo ?? "?"}»`;
      sumar(`streaming:${f.platform}:${coincide ? "verificado" : "candidato"}`);
      await dormir(300);
    }
  }

  const objetivo = limite > 0 ? filas.slice(0, limite) : filas;
  console.log(`libros: ${archivos.map((a) => path.basename(a)).join(", ")}`);
  console.log(`filas a aplicar: ${objetivo.length}`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);
  if (objetivo.length === 0) { await closeDb(); return; }

  if (!confirm) {
    writeFileSync(path.join(DIR, "aplicacion-ensayo.json"), JSON.stringify(objetivo.slice(0, 500), null, 1));
    console.log(`ensayo: ${DIR}/aplicacion-ensayo.json (sin --confirm no se escribe nada)`);
    await closeDb();
    return;
  }

  const pool = getPool();
  const yaExiste = new Map<string, { url: string; verified: boolean; source: string }>();
  for (const tabla of ["social_links", "streaming_links"] as const) {
    const filtro = tabla === "streaming_links" ? "WHERE artist_id IS NOT NULL" : "";
    const { rows } = await pool.query<{ k: string; url: string; verified: boolean; source: string }>(`
      SELECT artist_id::text || ':' || platform AS k, url, verified, source FROM public.${tabla} ${filtro}`);
    for (const r of rows) yaExiste.set(`${tabla === "social_links" ? "social" : "streaming"}|${r.k}`, r);
  }

  const aEscribir = objetivo.filter((f) => {
    const previa = yaExiste.get(`${f.tabla}|${f.artistId}:${f.platform}`);
    if (!previa) { sumar(`${f.tabla}:${f.platform}:nueva`); return true; }
    if (previa.url === f.url) { sumar(`${f.tabla}:${f.platform}:ya estaba igual`); return false; }
    if (previa.verified || previa.source === "crv-operador") { sumar(`${f.tabla}:${f.platform}:protegida (verified/operador)`); return false; }
    sumar(`${f.tabla}:${f.platform}:actualiza candidato`);
    return true;
  });
  if (aEscribir.length === 0) { console.log("nada que escribir (todo ya estaba o está protegido)"); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:redes-discogs-wikidata",
    operator: "hermes (encargo de Brian 2026-10-16)",
    note: "Redes sociales de artistas desde las evidencias de Discogs/Wikidata (urls[] de la ficha del artista con identidad probada por disco en común o perfil de Venezuela). verified solo cuando el usuario de la red coincide con el nombre del artista; el resto queda candidato.",
  }, async (context) => {
    let nuevas = 0, actualizadas = 0;
    for (const f of aEscribir) {
      if (f.tabla === "social") {
        const { rows } = await context.client.query<{ nuevo: boolean }>(`
          INSERT INTO public.social_links(artist_id, platform, url, handle, method, source, verified, notes)
          VALUES($1,$2,$3,$4,'fuzzy','discogs-urls',$5,$6)
          ON CONFLICT (artist_id, platform) DO UPDATE SET url=EXCLUDED.url, handle=EXCLUDED.handle,
            source=EXCLUDED.source, verified=EXCLUDED.verified, notes=EXCLUDED.notes
          WHERE NOT social_links.verified AND social_links.source <> 'crv-operador'
            AND (social_links.url, social_links.verified) IS DISTINCT FROM (EXCLUDED.url, EXCLUDED.verified)
          RETURNING (xmax = 0) AS nuevo`,
        [f.artistId, f.platform, f.url, f.handle, f.verified, f.nota]);
        if (rows[0]?.nuevo) nuevas += 1; else if (rows[0]) actualizadas += 1;
      } else {
        const { rows } = await context.client.query<{ nuevo: boolean }>(`
          INSERT INTO public.streaming_links(artist_id, album_id, platform, url, external_id, method, source, verified, notes)
          VALUES($1,NULL,$2,$3,NULL,'fuzzy','discogs-urls',$4,$5)
          ON CONFLICT (artist_id, platform) WHERE artist_id IS NOT NULL
          DO UPDATE SET url=EXCLUDED.url, source=EXCLUDED.source, verified=EXCLUDED.verified, notes=EXCLUDED.notes
          WHERE NOT streaming_links.verified AND streaming_links.source <> 'crv-operador'
          RETURNING (xmax = 0) AS nuevo`,
        [f.artistId, f.platform, f.url, f.verified, f.nota]);
        if (rows[0]?.nuevo) nuevas += 1; else if (rows[0]) actualizadas += 1;
      }
    }
    return { nuevas, actualizadas };
  });

  writeFileSync(path.join(DIR, `aplicacion-run${runId}.json`), JSON.stringify({ runId, ...result, cuenta }, null, 1));
  writeFileSync(path.join(DIR, `aplicado-run${runId}.csv`),
    ["tabla,artistId,artista,platform,url,handle,verified"].concat(
      aEscribir.map((f) => [f.tabla, f.artistId, `"${f.artista.replace(/"/gu, "'")}"`, f.platform, f.url, f.handle ?? "", f.verified].join(","))).join("\n") + "\n");
  console.log(`run ${runId}: ${result.nuevas} nuevas · ${result.actualizadas} actualizadas (de ${aEscribir.length})`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);
  await closeDb();
}

function notaDe(e: Evidencia, handle: string | null, verified: boolean): string {
  const base = `Discogs/Social de «${e.artista}»${handle ? ` · usuario «${handle}»` : " · sin usuario legible"}`;
  const guarda = e.guarda ? ` · identidad: ${e.guarda}` : "";
  const fuente = e.fuente ? ` · fuente: ${e.fuente}` : "";
  return `${base}${guarda}${fuente} · ${verified ? "usuario coincide con el nombre" : "usuario NO coincide: candidato"}`.slice(0, 900);
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
