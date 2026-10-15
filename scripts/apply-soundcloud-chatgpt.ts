// Aplica al catálogo las investigaciones de SoundCloud hechas por ChatGPT (2026-10-15, encargo de
// Brian): los lotes de reports/soundcloud-2026-10-15/lotes/ vuelven como archivos
// `soundcloud-lote-NNN.json` (esquema en PROMPT_CHATGPT.md) y aquí se convierten en filas de
// `public.streaming_links` en UN run reversible.
//
// Regla de oro: ChatGPT puede equivocarse o inventar, así que NADA entra sin verificar. Cada URL se
// abre en su página canónica de soundcloud.com (sin parámetros: el robots de SoundCloud prohíbe
// `/*?`, o sea que el endpoint oEmbed con query NO se usa aquí) y se leen sus etiquetas og:
//   * 404  → la URL no existe: se descarta y se reporta.
//   * 200  → og:type dice qué es (music.musician = perfil, music.playlist = set, music.song = pista)
//            y og:title el nombre real. Perfil con og:title coincidente con el nombre del artista
//            (o sus alias) = verified; set con og:title coincidente con el disco = verified. Lo que
//            exista pero no coincida queda candidato (verified=false) para Curaduría.
// El reproductor (iframe) se construye aquí igual que en web/src/lib/embeds.ts y queda en el
// informe de verificación, para que Brian lo vea sin abrir SoundCloud.
//
// Uso:
//   ./scripts/with-node22.sh npx tsx scripts/apply-soundcloud-chatgpt.ts \
//        [reports/soundcloud-2026-10-15/recibidos] [--confirm] [--lotes=1,2,3] [--pausa=400] [--sin-red]
//   Sin --confirm: dry-run (sí verifica por red; escribe el informe de verificación).
//   Con --sin-red: no toca la red y toma por buenas las URLs que traiga el archivo (solo para
//   revisar el formato de un lote; nunca para aplicar).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const DIR = process.argv.slice(2).find((v) => !v.startsWith("--")) ?? "reports/soundcloud-2026-10-15/recibidos";
const confirm = process.argv.includes("--confirm");
const sinRed = process.argv.includes("--sin-red");
const soloLotes = process.argv.find((v) => v.startsWith("--lotes="))?.slice("--lotes=".length)
  ?.split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
const pausa = Number(process.argv.find((v) => v.startsWith("--pausa="))?.slice("--pausa=".length) ?? 400);

const UA = { "User-Agent": "CRV-reproductores/1.0 (+coleccionistasderockvenezolano.com)" };

interface DiscoLoto {
  albumId: number;
  titulo: string;
  url: string | null;
  confianza?: string | null;
  evidencia?: string | null;
  nota?: string | null;
}
interface ArtistaLote {
  artistId: number;
  nombre?: string;
  soundcloud?: { url?: string | null; confianza?: string | null; evidencia?: string | null; motivo?: string | null } | null;
  discos?: DiscoLoto[];
}
interface Lote { lote?: number; artistas?: ArtistaLote[] }

interface Fila {
  artistId: number | null;
  albumId: number | null;
  url: string;
  externalId: string | null;
  verified: boolean;
  nota: string;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** minúsculas, sin tildes, sin signos: «Billo's» = «Billos», «Los Melódicos» = «los melodicos». */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/\b(?:official|oficial|music|musica|band|banda|ve|vzla|venezuela)\b/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

/** El `author_name` de SoundCloud trae adornos («Kraptor Official», «Guaco Music»). */
function mismoNombre(a: string, b: string): boolean {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return corto.length >= 1 && corto.every((t) => largo.includes(t));
}

/** «Álbum (Remastered 2019)» ≈ «Álbum»; pero «Álbum II» ≠ «Álbum».
 *  En los sets, el oEmbed devuelve el título con el autor pegado («Night of the living dead by
 *  Kraptor», medido 2026-10-15): se prueba también sin ese sufijo, y solo vale si el resto es
 *  idéntico al título del catálogo. Los singles digitales suelen titularse «Canción (feat. X)» o
 *  «Canción ⠀⠀(feat. X)»: se acepta que la página EMPIECE por el título del disco (guardas: título
 *  de al menos 8 caracteres, y la identidad del autor se comprueba aparte). */
function mismoTitulo(a: string, b: string): boolean {
  const limpiar = (t: string) => normalizar(t.replace(/\((?:[^)]*(?:remaster|reedici[oó]n|deluxe|edici[oó]n|version)[^)]*)\)/giu, " "));
  const na = limpiar(a);
  const nb = limpiar(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sinAutor = nb.replace(/\s+by\s+[a-z0-9 ]+$/u, "").trim();
  if (sinAutor !== nb && sinAutor === na) return true;
  return na.length >= 8 && nb.startsWith(na);
}

/** ¿El título de la página CONTIENE el del disco como palabras completas? («Arca - Arca (full
 *  Album)» ≈ «Arca»). Solo se usa con pistas del propio artista: el dueño ya está comprobado. */
function contieneTitulo(a: string, b: string): boolean {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb || na.length < 3) return false;
  return new RegExp(`(?:^| )${na.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?: |$)`, "u").test(nb);
}

/** Quita la basura de un copiar-pegar: espacios, markdown, comillas, parámetros de seguimiento. */
function limpiarUrl(cruda: string | null | undefined): string | null {
  if (!cruda) return null;
  let u = cruda.trim().replace(/^[<"'([]+|[>"')\]]+$/gu, "").trim();
  u = u.split(/\s+/u)[0] ?? "";
  if (!/^https?:\/\//iu.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (!/(?:^|\.)soundcloud\.com$/iu.test(parsed.hostname)) return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/u, "");
  } catch {
    return null;
  }
}

interface Pagina { ok: boolean; status: number; tipo?: string | undefined; titulo?: string | undefined; descripcion?: string | undefined }

const cache = new Map<string, Pagina>();

/** Las etiquetas og: vienen con entidades HTML («&quot;», «&amp;») que rompen la comparación. */
const entidades = (t: string): string => t
  .replace(/&quot;/gu, "\"").replace(/&#0?39;|&apos;/gu, "'").replace(/&amp;/gu, "&")
  .replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&nbsp;/gu, " ");

const OG = (html: string, campo: string): string | undefined => {
  const valor = new RegExp(`<meta property="og:${campo}" content="([^"]*)"`, "u").exec(html)?.[1];
  return valor === undefined ? undefined : entidades(valor);
};

/** Rutas que el robots de SoundCloud bloquea o que no son fichas de entidad. */
const RESERVADAS = new Set(["search", "you", "stream", "upload", "settings", "messages", "discover",
  "stories", "topic", "pro", "download", "jobs", "go", "getstarted", "company", "sitemap",
  "sitemapindex", "terms-of-use", "community-guidelines", "transparency-reports",
  "accessibility-statement", "imprint", "charts", "feed", "library", "notifications", "signup",
  "login", "logout", "pages", "popular", "tags", "explore"]);

/** Solo páginas canónicas: perfil (usuario), pista (usuario/pista) o set (usuario/sets/slug).
 *  Nunca rutas que el robots de SoundCloud prohíbe (/search, /you, /stream…) ni con parámetros. */
function urlAceptable(u: string): boolean {
  try {
    const p = new URL(u);
    if (p.hostname !== "soundcloud.com") return false;
    if (p.search || p.hash) return false;
    const seg = p.pathname.split("/").filter(Boolean);
    if (seg.length === 0 || RESERVADAS.has(seg[0]!.toLowerCase())) return false;
    if (seg.length === 1 || seg.length === 2) return true;
    return seg.length === 3 && seg[1] === "sets";
  } catch { return false; }
}

async function pagina(url: string): Promise<Pagina> {
  const previo = cache.get(url);
  if (previo) return previo;
  if (sinRed) return { ok: true, status: 200, tipo: "sin-red", titulo: "(sin verificar)" };
  await dormir(pausa);
  let out: Pagina;
  try {
    const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(25000) });
    const html = r.ok ? await r.text() : "";
    out = { ok: r.ok, status: r.status, tipo: OG(html, "type"), titulo: OG(html, "title"), descripcion: OG(html, "description") };
  } catch (error) {
    out = { ok: false, status: -1, descripcion: (error as Error).message };
  }
  cache.set(url, out);
  await dormir(pausa);
  return out;
}

/** El reproductor que inserta la web, igual que web/src/lib/embeds.ts. */
function iframe(url: string): string {
  const params = new URLSearchParams({ url, color: "#e50914", auto_play: "false", hide_related: "true", show_comments: "false", show_reposts: "false", visual: "false" });
  return `<iframe width="100%" height="450" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?${params}"></iframe>`;
}

/** Saca todos los objetos {…"artistas":[…]} de un archivo: sirve tanto un .json limpio como un
 *  volcado de chat (.txt/.md) con varios bloques ```json pegados en las respuestas. */
function bloques(texto: string): Lote[] {
  const salida: Lote[] = [];
  const probar = (t: string) => {
    try {
      const o = JSON.parse(t) as Lote;
      if (o && typeof o === "object" && Array.isArray(o.artistas)) salida.push(o);
    } catch { /* no era un lote */ }
  };
  // Un archivo limpio se lee entero y ya (si no, el escaneo de llaves lo encontraría otra vez).
  const limpio = texto.trim();
  probar(limpio);
  if (salida.length > 0) return salida;
  let i = 0;
  while (i < texto.length) {
    const inicio = texto.indexOf("{", i);
    if (inicio === -1) break;
    let profundidad = 0, enCadena = false, escape = false, fin = -1;
    for (let j = inicio; j < texto.length; j++) {
      const c = texto[j]!;
      if (enCadena) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') enCadena = false;
      } else if (c === '"') enCadena = true;
      else if (c === "{") profundidad++;
      else if (c === "}" && --profundidad === 0) { fin = j; break; }
    }
    if (fin === -1) break;
    probar(texto.slice(inicio, fin + 1));
    i = fin + 1;
  }
  return salida;
}

async function main(): Promise<void> {
  if (!existsSync(DIR)) {
    console.error(`no existe ${DIR}: guarda ahí los archivos soundcloud-lote-NNN.json o el volcado del chat`);
    process.exit(1);
  }
  const archivos = readdirSync(DIR)
    .filter((n) => /\.(?:json|txt|md)$/iu.test(n))
    // Ni los informes de corridas anteriores: si no, la segunda corrida lee los suyos.
    .filter((n) => n !== "verificacion.json" && !n.startsWith("aplicacion-"))
    .sort();
  if (archivos.length === 0) {
    console.error(`sin archivos .json/.txt/.md en ${DIR}`);
    process.exit(1);
  }

  const pool = getPool();
  const artistas = new Map((await pool.query<{ id: string; name: string }>(
    "SELECT id::text AS id, name FROM public.artists")).rows.map((r) => [Number(r.id), r.name]));
  const aliasDe = new Map<number, string[]>();
  for (const r of (await pool.query<{ artist_id: string; alias: string }>(
    "SELECT artist_id::text AS artist_id, alias FROM ingest.artist_aliases WHERE is_primary IS NOT TRUE")).rows) {
    const id = Number(r.artist_id);
    aliasDe.set(id, [...(aliasDe.get(id) ?? []), r.alias]);
  }
  const discos = new Map((await pool.query<{ id: string; artist_id: string; title: string }>(
    "SELECT id::text AS id, artist_id::text AS artist_id, title FROM public.albums")).rows
    .map((r) => [Number(r.id), { artistId: Number(r.artist_id), title: r.title }]));
  const intocable = new Set((await pool.query<{ k: string }>(`
    SELECT CASE WHEN album_id IS NOT NULL THEN 'd:' || album_id ELSE 'a:' || artist_id END || ':soundcloud' AS k
      FROM public.streaming_links WHERE platform = 'soundcloud' AND (verified OR source = 'crv-operador')`)).rows.map((r) => r.k));
  // Perfil verificado de cada artista → su usuario de SoundCloud (para saber si una pista es suya).
  const slugDe = new Map<number, string>();
  for (const r of (await pool.query<{ artist_id: string; url: string }>(
    "SELECT artist_id::text AS artist_id, url FROM public.streaming_links WHERE platform = 'soundcloud' AND artist_id IS NOT NULL AND verified")).rows) {
    const usuario = new URL(r.url).pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    if (usuario) slugDe.set(Number(r.artist_id), usuario);
  }

  const filas: Fila[] = [];
  const verificados: Array<Record<string, unknown>> = [];
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };
  // Global a propósito: el mismo artista repite entre lotes y archivos (el paquete de ChatGPT trae
  // «múltiples apariciones del mismo artistId»), y no se puede contar ni escribir dos veces.
  const vistos = new Set<string>();
  let leidos = 0, revisados = 0;

  const pendientes: Lote[] = [];
  for (const archivo of archivos) {
    const lotes = bloques(readFileSync(path.join(DIR, archivo), "utf8"));
    if (lotes.length === 0) { sumar(`sin bloques json: ${archivo}`); continue; }
    if (lotes.length > 1) console.log(`${archivo}: ${lotes.length} bloques json`);
    pendientes.push(...lotes);
  }
  for (const lote of pendientes) {
    if (soloLotes && lote.lote && !soloLotes.includes(lote.lote)) continue;
    leidos++;

    for (const entrada of lote.artistas ?? []) {
      const artistId = Number(entrada.artistId);
      const nombreCatalogo = artistas.get(artistId);
      if (!nombreCatalogo) { sumar("artista inexistente"); continue; }
      const nombres = [nombreCatalogo, ...(aliasDe.get(artistId) ?? [])];

      // ── perfil del artista ────────────────────────────────────────────────────────────────────
      const urlPerfil = limpiarUrl(entrada.soundcloud?.url);
      if (urlPerfil && !urlAceptable(urlPerfil)) {
        sumar("perfil: URL no canónica"); verificados.push({ tipo: "artista", artistId, nombre: nombreCatalogo, url: urlPerfil, veredicto: "descartado", motivo: "ruta no canónica o con parámetros" });
      } else if (urlPerfil) {
        const clave = `a:${artistId}:soundcloud`;
        if (intocable.has(clave)) { sumar("perfil ya verificado"); }
        else if (vistos.has(clave)) { sumar("perfil repetido en el archivo"); }
        else {
          vistos.add(clave);
          revisados++;
          const info = await pagina(urlPerfil);
          const evidencia = limpiarUrl(entrada.soundcloud?.evidencia);
          if (!info.ok) {
            sumar(`perfil descartado (HTTP ${info.status})`);
            verificados.push({ tipo: "artista", artistId, nombre: nombreCatalogo, url: urlPerfil, veredicto: "descartado", motivo: `HTTP ${info.status}` });
          } else if (!info.titulo) {
            // SoundCloud responde 200 con un cascarón vacío en las fichas que no existen (medido 2026-10-15):
            // la señal de vida es la etiqueta og:title.
            sumar("perfil descartado (perfil inexistente)");
            verificados.push({ tipo: "artista", artistId, nombre: nombreCatalogo, url: urlPerfil, veredicto: "descartado", motivo: "página sin og:title: el perfil no existe" });
          } else if (info.tipo !== "music.musician") {
            sumar("perfil descartado (no es perfil)");
            verificados.push({ tipo: "artista", artistId, nombre: nombreCatalogo, url: urlPerfil, tipoSoundcloud: info.tipo, veredicto: "descartado", motivo: `og:type=${info.tipo ?? "?"} (no es un perfil)` });
          } else {
            const calza = nombres.some((n) => mismoNombre(n, info.titulo ?? ""));
            filas.push({ artistId, albumId: null, url: urlPerfil, externalId: null, verified: calza,
              nota: `perfil «${info.titulo ?? "?"}»${calza ? " · nombre coincide" : ` · NO coincide con «${nombreCatalogo}»`}`
                + `${entrada.soundcloud?.confianza ? ` · confianza ChatGPT: ${entrada.soundcloud.confianza}` : ""}`
                + `${evidencia ? ` · visto en ${evidencia}` : ""}` });
            verificados.push({ tipo: "artista", artistId, nombre: nombreCatalogo, url: urlPerfil, tituloSoundcloud: info.titulo,
              veredicto: calza ? "verificado" : "candidato (nombre no coincide)", embed: iframe(urlPerfil) });
            sumar(calza ? "perfil verificado" : "perfil candidato");
          }
        }
      } else if (entrada.soundcloud?.motivo) {
        sumar("perfil no encontrado");
      }

      // ── discos ───────────────────────────────────────────────────────────────────────────────
      for (const d of entrada.discos ?? []) {
        const albumId = Number(d.albumId);
        const disco = discos.get(albumId);
        if (!disco || disco.artistId !== artistId) { sumar("disco movido o de otro artista"); continue; }
        const url = limpiarUrl(d.url);
        if (!url) continue;
        const clave = `d:${albumId}:soundcloud`;
        if (intocable.has(clave)) { sumar("disco ya verificado"); continue; }
        if (vistos.has(clave)) { sumar("disco repetido en el archivo"); continue; }
        if (!urlAceptable(url)) {
          sumar("disco: URL no canónica");
          verificados.push({ tipo: "disco", albumId, titulo: disco.title, artista: nombreCatalogo, url, veredicto: "descartado", motivo: "ruta no canónica o con parámetros" });
          continue;
        }
        vistos.add(clave);
        revisados++;
        const info = await pagina(url);
        if (!info.ok) {
          sumar(`disco descartado (HTTP ${info.status})`);
          verificados.push({ tipo: "disco", albumId, titulo: disco.title, artista: nombreCatalogo, url, veredicto: "descartado", motivo: `HTTP ${info.status}` });
          continue;
        }
        if (!info.titulo) {
          sumar("disco descartado (set inexistente)");
          verificados.push({ tipo: "disco", albumId, titulo: disco.title, artista: nombreCatalogo, url, veredicto: "descartado", motivo: "página sin og:title: el set o la pista no existe" });
          continue;
        }
        const esSet = info.tipo === "music.playlist";
        const esPista = info.tipo === "music.song";
        // Un single digital vive como PISTA, no como set: vale si el título coincide Y la página es
        // del propio artista (mismo usuario que su perfil verificado, o su nombre en la descripción).
        const usuario = new URL(url).pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
        const delArtista = usuario === (slugDe.get(artistId) ?? "")
          || nombres.some((n) => (info.descripcion ?? "").toLowerCase().includes(n.toLowerCase()));
        const calzaTitulo = mismoTitulo(disco.title, info.titulo ?? "");
        const calza = (esSet && calzaTitulo)
          || (esPista && delArtista && (calzaTitulo || contieneTitulo(disco.title, info.titulo ?? "")));
        const veredicto = calza ? "verificado"
          : calzaTitulo && esPista ? "candidato (pista de un usuario que no es el artista)"
          : esSet || esPista ? "candidato (título no coincide)"
          : `candidato (og:type=${info.tipo ?? "?"})`;
        filas.push({ artistId: null, albumId, url, externalId: null, verified: calza,
          nota: `${esSet ? "set" : esPista ? "pista" : (info.tipo ?? "página")} «${info.titulo ?? "?"}»`
            + `${calza ? (esSet ? " · título coincide" : " · pista del propio artista") : ` · NO coincide con «${disco.title}»`}`
            + `${d.nota ? ` · ${d.nota}` : ""}` });
        verificados.push({ tipo: "disco", albumId, titulo: disco.title, artista: nombreCatalogo, url, tipoSoundcloud: info.tipo, tituloSoundcloud: info.titulo,
          veredicto, embed: iframe(url) });
        sumar(calza ? "disco verificado" : "disco candidato");
      }
    }
  }

  const resumen: Record<string, number> = {};
  for (const f of filas) { const k = `${f.albumId ? "disco" : "artista"}:${f.verified ? "verificado" : "candidato"}`; resumen[k] = (resumen[k] ?? 0) + 1; }
  const destino = DIR;   // informes junto a la entrada, para que cada corrida conserve su evidencia
  console.log(`archivos ${leidos} · URLs revisadas por red ${revisados} · filas a escribir ${filas.length}`);
  for (const [k, v] of Object.entries(resumen).sort()) console.log(`  ${k.padEnd(26)} ${v}`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);
  writeFileSync(path.join(destino, "verificacion.json"), JSON.stringify({ archivos: leidos, revisados, resumen, cuenta, verificados }, null, 1));
  console.log(`informe con los iframes verificados: ${path.join(destino, "verificacion.json")}`);

  if (filas.length === 0) {
    console.log("nada nuevo que escribir: sin run");
    await closeDb();
    return;
  }
  if (!confirm) {
    writeFileSync(path.join(destino, "aplicacion-ensayo.json"), JSON.stringify({ filas, resumen, cuenta }, null, 1));
    console.log("dry-run: repite con --confirm para escribir");
    await closeDb();
    return;
  }

  const { runId, result } = await withOperatorRun({
    name: "hermes:soundcloud-chatgpt",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Enlaces de SoundCloud investigados por ChatGPT y verificados contra la página canónica de SoundCloud (og:type + og:title): perfil con nombre coincidente y sets con título coincidente = verified; el resto queda candidato para Curaduría.",
  }, async (context) => {
    let nuevos = 0, actualizados = 0;
    for (const f of filas) {
      const col = f.artistId ? "artist_id" : "album_id";
      const { rows } = await context.client.query<{ nuevo: boolean }>(`
        INSERT INTO public.streaming_links(artist_id, album_id, platform, url, external_id, method, source, verified, notes)
        VALUES($1,$2,'soundcloud',$3,$4,$5,'soundcloud-chatgpt',$6,$7)
        ON CONFLICT (${col}, platform) WHERE ${col} IS NOT NULL
        DO UPDATE SET url=EXCLUDED.url, external_id=EXCLUDED.external_id, method=EXCLUDED.method,
          source=EXCLUDED.source, verified=EXCLUDED.verified, notes=EXCLUDED.notes
        WHERE NOT streaming_links.verified AND streaming_links.source <> 'crv-operador'
        RETURNING (xmax = 0) AS nuevo`,
      [f.artistId, f.albumId, f.url, f.externalId, f.verified ? "exact" : "fuzzy", f.verified, f.nota]);
      if (rows[0]?.nuevo) nuevos++; else if (rows[0]) actualizados++;
    }
    return { nuevos, actualizados };
  });
  mkdirSync(destino, { recursive: true });
  writeFileSync(path.join(destino, `aplicacion-run${runId}.json`), JSON.stringify({ runId, filas: filas.length, ...result, resumen, cuenta }, null, 1));
  console.log(`run ${runId}: ${result.nuevos} nuevos · ${result.actualizados} actualizados (de ${filas.length})`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
