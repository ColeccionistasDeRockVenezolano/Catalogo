// Campaña 2026-10-16 · bloque C — cosecha de EVIDENCIA de redes sociales desde Discogs.
//
// NO escribe el catálogo: deja un libro de evidencia que `apply-social-links.ts` verifica y aplica
// en un run reversible. Fuente: `urls[]` de la ficha de artista de Discogs.
//
// La identidad se prueba con una GUARDA por artista (nada entra por parecido de nombre):
//   · disco:  algún release del artista de Discogs comparte título (normalizado, no genérico) con
//             un disco del artista en el catálogo.
//   · ficha:  la ficha cruda de `data/raw/discogs-bio/` es la ÚNICA con ese nombre en todo el pozo
//             (ni el catálogo tiene otro artista homónimo) y su perfil sitúa al artista en Venezuela.
//
// Orden de trabajo (offline primero, red después):
//   1. índice offline `reports/redes-2026-10-16/discogs-bio-indice.jsonl` (2.038 fichas crudas)
//      y `discogs-bio-busquedas.jsonl` (18.373 resultados de búsqueda ya pagados).
//   2. solo lo que quede sin candidato va a la API (`/database/search`).
//   3. la guarda de disco compartido pide `/artists/<id>/releases` (1 req) y la ficha se lee del
//      pozo o se baja (`/artists/<id>`); todo se cachea en disco (reanudable).
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/harvest-social-discogs.mts \
//        [--out-dir reports/redes-2026-10-16] [--delay-ms 1100] [--modo offline|api|ambos] [--limite N]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.resolve(ROOT, arg("--out-dir") ?? "reports/redes-2026-10-16");
const CACHE = path.join(OUT_DIR, "cache-discogs");
const EVIDENCIA = path.join(OUT_DIR, "evidencia-discogs.jsonl");
const DESCARTES = path.join(OUT_DIR, "descartes-discogs.jsonl");
const DELAY = entero("--delay-ms", 1100);
const MODO = arg("--modo") ?? "ambos";
const LIMITE = Number(arg("--limite") ?? 0);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}
function entero(name: string, porDefecto: number): number {
  const v = arg(name);
  if (v === undefined) return porDefecto;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} debe ser entero positivo`);
  return n;
}
// Normalización COMPARTIDA con `scripts/discogs-bio-index.py` (misma regla en los dos lados,
// o el pozo offline no cruzaría): sin tildes, minúsculas, sin artículos ni adornos
// (`official`, `music`, `band`, `the`, `el`, `la`…), sin signos y sin el sufijo de
// desambiguación de Discogs («Daiquiri (3)» → «daiquiri»).
const ADORNOS = /\b(?:official|oficial|music|musica|band|banda|the|el|la|los|las)\b/gu;
function clave(valor: string): string {
  return (valor ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(ADORNOS, " ").replace(/[^a-z0-9]+/gu, "");
}
function claveDiscogs(valor: string): string {
  return clave((valor ?? "").replace(/\s*\(\d+\)\s*$/u, ""));
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Títulos que NO prueban nada por sí solos (los usa cualquier disco de cualquier artista).
const GENERICOS = new Set([
  "demos", "demo", "ep", "single", "sencillo", "ineditas", "inéditas", "b-sides", "bsides",
  "acustico", "unplugged", "en vivo", "en directo", "live", "recopilatorio", "compilacion",
  "compilation", "greatest hits", "exitos", "lo mejor", "vol 1", "vol 2", "vol 3", "vol 4",
  "volumen 1", "volumen 2", "disco 1", "side a",
]);
function esGenerico(titulo: string): boolean {
  const k = clave(titulo);
  return GENERICOS.has(k) || /^demos?($| )/u.test(k) || k.length < 4;
}

interface ArtistaCatalogo { id: number; nombre: string; norm: string; discos: Set<string>; }
interface FichaCruda { id: number; name: string; norm: string; urls: string[]; perfilEsVzla: boolean; }
interface Evidencia {
  artistId: number; artista: string; discogsId: number; discogsName: string; guarda: string;
  discosCompartidos: string[]; perfilEsVzla: boolean; urls: string[]; fuente: string;
}
interface Descarte { artistId: number; artista: string; discogsId?: number | undefined; motivo: string; }

function leerJsonl<T>(ruta: string): T[] {
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

async function main(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const token = process.env["DISCOGS_TOKEN"]?.trim();
  if (MODO !== "offline" && !token) throw new Error("falta DISCOGS_TOKEN en el .env");

  // — catálogo: artistas SIN ninguna red social, con sus discos (para la guarda)
  const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const artistas = new Map<number, ArtistaCatalogo>();
  {
    const { rows } = await pool.query<{ aid: string; name: string }>(`
      SELECT a.id::text AS aid, a.name FROM public.artists a
       WHERE NOT EXISTS (SELECT 1 FROM public.social_links sl WHERE sl.artist_id = a.id)
       ORDER BY a.id`);
    for (const r of rows) artistas.set(Number(r.aid), { id: Number(r.aid), nombre: r.name, norm: clave(r.name), discos: new Set() });
    const { rows: filas } = await pool.query<{ aid: string; title: string }>(`
      SELECT al.artist_id::text AS aid, al.title FROM public.albums al
       JOIN public.artists a ON a.id = al.artist_id
       WHERE NOT EXISTS (SELECT 1 FROM public.social_links sl WHERE sl.artist_id = a.id)`);
    for (const f of filas) {
      const artista = artistas.get(Number(f.aid));
      const k = clave(f.title);
      if (artista && k.length >= 4) artista.discos.add(k);
    }
    // nombres repetidos en el catálogo: el apellido de "único" exige que el nombre no se repita
    const vistos = new Map<string, number>();
    for (const a of artistas.values()) vistos.set(a.norm, (vistos.get(a.norm) ?? 0) + 1);
    for (const a of artistas.values()) if ((vistos.get(a.norm) ?? 0) > 1) a.discos.add("\u0000homonimo");
  }
  console.log(`artistas sin red social: ${artistas.size}`);

  // — pozos offline
  const fichas = new Map<number, FichaCruda>();
  const porNombre = new Map<string, FichaCruda[]>();
  for (const r of leerJsonl<{ id: number; name: string; norm: string; urls: string[]; perfil_es_vzla: boolean }>(
    path.join(OUT_DIR, "discogs-bio-indice.jsonl"))) {
    const ficha: FichaCruda = { id: r.id, name: r.name, norm: r.norm, urls: r.urls, perfilEsVzla: r.perfil_es_vzla };
    fichas.set(ficha.id, ficha);
    const lista = porNombre.get(ficha.norm) ?? [];
    lista.push(ficha);
    porNombre.set(ficha.norm, lista);
  }
  const idsPorNombre = new Map<string, Set<number>>();
  for (const r of leerJsonl<{ norm: string; id: number }>(path.join(OUT_DIR, "discogs-bio-busquedas.jsonl"))) {
    const set = idsPorNombre.get(r.norm) ?? new Set<number>();
    set.add(r.id);
    idsPorNombre.set(r.norm, set);
  }
  console.log(`pozo offline: ${fichas.size} fichas · ${idsPorNombre.size} nombres en búsquedas`);

  // — reanudable: lo ya hecho se salta
  const hechos = new Set<number>();
  for (const e of leerJsonl<{ artistId: number }>(EVIDENCIA)) hechos.add(e.artistId);
  for (const d of leerJsonl<{ artistId: number }>(DESCARTES)) hechos.add(d.artistId);
  console.log(`ya procesados antes: ${hechos.size}`);

  const cabeceras = { "user-agent": "CRV-local-media/1.0 (+coleccionistasderockvenezolano.com)", authorization: `Discogs token=${token}` };
  let pedidos = 0;
  async function pedir<T>(url: string, cache: string): Promise<T | null> {
    const ruta = path.join(CACHE, cache);
    if (existsSync(ruta)) return JSON.parse(readFileSync(ruta, "utf8")) as T;
    for (let intento = 0; intento < 3; intento += 1) {
      if (pedidos > 0) await dormir(DELAY);
      pedidos += 1;
      try {
        const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(30_000) });
        if (r.status === 429 || r.status === 503) { await dormir(5_000 * (intento + 1)); continue; }
        if (!r.ok) return null;
        const cuerpo = (await r.json()) as T;
        writeFileSync(ruta, JSON.stringify(cuerpo));
        return cuerpo;
      } catch { await dormir(2_000); }
    }
    return null;
  }

  const pendientes = [...artistas.values()].filter((a) => !hechos.has(a.id));
  const cola = LIMITE > 0 ? pendientes.slice(0, LIMITE) : pendientes;
  console.log(`cola de esta pasada: ${cola.length} artistas (modo ${MODO})`);

  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };

  for (const [indice, artista] of cola.entries()) {
    const candidatos = new Set<number>();
    for (const f of porNombre.get(artista.norm) ?? []) candidatos.add(f.id);
    for (const id of idsPorNombre.get(artista.norm) ?? []) candidatos.add(id);
    if (candidatos.size === 0 && MODO !== "offline") {
      const encontrados = await pedir<{ results?: Array<{ id: number; title: string; type: string }> }>(
        `https://api.discogs.com/database/search?${new URLSearchParams({ q: artista.nombre, type: "artist", per_page: "10" })}`,
        `busqueda-${clave(artista.nombre).slice(0, 60)}.json`);
      for (const r of encontrados?.results ?? []) {
        if (r.type === "artist" && r.title && claveDiscogs(r.title) === artista.norm) candidatos.add(r.id);
      }
    }
    if (candidatos.size === 0) { sumar("sin candidato"); await registrarDescarte({ artistId: artista.id, artista: artista.nombre, motivo: "sin candidato Discogs (ni pozo ni búsqueda)" }); continue; }

    let aplicado = false;
    const motivos: string[] = [];
    for (const id of candidatos) {
      const cruda = fichas.get(id);
      const bajada = cruda ? null : await pedir<{ name?: string; urls?: string[]; profile?: string }>(
        `https://api.discogs.com/artists/${id}`, `artista-${id}.json`);
      const datos = cruda
        ? { name: cruda.name, urls: cruda.urls, profile: cruda.perfilEsVzla ? "Venezuela" : "" }
        : bajada;
      if (!datos) { motivos.push(`${id}: sin ficha`); continue; }
      const nombreDiscogs = claveDiscogs(String(datos.name ?? ""));
      if (nombreDiscogs !== artista.norm) { motivos.push(`${id}: el nombre de Discogs no coincide («${datos.name ?? "?"}»)`); continue; }
      const urls = (datos.urls ?? []).filter((u) => typeof u === "string" && u.trim());
      if (urls.length === 0) { motivos.push(`${id}: sin urls[]`); continue; }

      const releases = await pedir<{ releases?: Array<{ title?: string; type?: string }>; pagination?: { items?: number } }>(
        `https://api.discogs.com/artists/${id}/releases?${new URLSearchParams({ per_page: "100", sort: "year" })}`,
        `releases-${id}.json`);
      if (!releases) { motivos.push(`${id}: releases no respondió`); continue; }
      const compartidos: string[] = [];
      for (const rel of releases.releases ?? []) {
        const t = rel.title ? clave(rel.title) : "";
        if (t && !esGenerico(rel.title ?? "") && artista.discos.has(t)) compartidos.push(t);
      }
      const perfilVzla = /venezuela|caracas|venezolan/iu.test(String(datos.profile ?? ""));
      const unicoEnPozo = (porNombre.get(artista.norm) ?? []).length === 1;
      const homonimoCatalogo = artista.discos.has("\u0000homonimo");

      let guarda = "";
      if (compartidos.length > 0) guarda = `disco en común: ${compartidos.length} («${compartidos[0] ?? ""}»…)`;
      else if (unicoEnPozo && perfilVzla && !homonimoCatalogo) guarda = "nombre único en el pozo + perfil de Venezuela";
      if (!guarda) { motivos.push(`${id}: sin disco en común (${releases.pagination?.items ?? "?"} releases) ni perfil de Venezuela`); continue; }

      appendFileSync(EVIDENCIA, JSON.stringify({
        artistId: artista.id, artista: artista.nombre, discogsId: id,
        discogsName: String(datos.name ?? ""), guarda,
        discosCompartidos: compartidos.slice(0, 5), perfilEsVzla: perfilVzla, urls,
        fuente: `https://www.discogs.com/artist/${id}`,
      } satisfies Evidencia) + "\n");
      sumar(`evidencia: ${guarda.startsWith("disco") ? "disco común" : "perfil Venezuela"}`);
      aplicado = true;
      break;
    }
    if (!aplicado) {
      sumar("descartado");
      await registrarDescarte({ artistId: artista.id, artista: artista.nombre, discogsId: [...candidatos][0], motivo: motivos.join(" · ").slice(0, 400) });
    }
    if ((indice + 1) % 50 === 0 || indice + 1 === cola.length) {
      console.log(`${indice + 1}/${cola.length} · ${JSON.stringify(cuenta)}`);
    }
  }

  async function registrarDescarte(d: Descarte): Promise<void> {
    appendFileSync(DESCARTES, JSON.stringify(d) + "\n");
  }

  writeFileSync(path.join(OUT_DIR, "discogs-resumen.json"), JSON.stringify({ artistas: artistas.size, cola: cola.length, pedidos, cuenta }, null, 1));
  console.log(JSON.stringify({ cola: cola.length, pedidos, cuenta }));
  await pool.end();
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
