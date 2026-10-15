// Campaña 2026-10-16 · bloque C — cosecha de EVIDENCIA de redes sociales desde Wikidata.
//
// NO escribe el catálogo: deja `reports/redes-2026-10-16/evidencia-wikidata.jsonl` para
// `apply-social-links.ts`.
//
// Anclaje (regla dura: sin anclaje no se emite nada — se acabó el infierno de los homónimos):
//   · el artista tiene su identidad Discogs ACEPTADA en el catálogo → se busca la entidad Wikidata
//     con esa propiedad P1953 (Discogs artist ID), o
//   · identidad MusicBrainz aceptada → P434 (MusicBrainz artist ID).
// Las propiedades sociales que se leen de esa entidad anclada: P2002 X · P2013 Facebook ·
// P2003 Instagram · P7085 TikTok · P2397 canal de YouTube · P3283 Bandcamp.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/harvest-social-wikidata.mts [--out-dir reports/redes-2026-10-16]
//        [--delay-ms 600] [--lote 25]
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.resolve(ROOT, arg("--out-dir") ?? "reports/redes-2026-10-16");
const EVIDENCIA = path.join(OUT_DIR, "evidencia-wikidata.jsonl");
const ENDPOINT = "https://query.wikidata.org/sparql";
const DELAY = entero("--delay-ms", 600);
const LOTE = entero("--lote", 25);

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
}
function entero(nombre: string, porDefecto: number): number {
  const v = arg(nombre);
  if (v === undefined) return porDefecto;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${nombre} debe ser entero positivo`);
  return n;
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// propiedad Wikidata → cómo se convierte en URL del perfil
const PROPS: Record<string, (v: string) => string> = {
  P2002: (v) => `https://x.com/${v}`,
  P2013: (v) => `https://www.facebook.com/${v}`,
  P2003: (v) => `https://www.instagram.com/${v}`,
  P7085: (v) => `https://www.tiktok.com/@${v}`,
  P2397: (v) => `https://www.youtube.com/channel/${v}`,
  P3283: (v) => `https://${v}.bandcamp.com`,
};

interface Ancla { artistId: number; artista: string; tipo: "discogs" | "musicbrainz"; valor: string; }

async function sparql<T extends Record<string, { value?: string }>>(consulta: string): Promise<T[]> {
  const respuesta = await fetch(`${ENDPOINT}?${new URLSearchParams({ format: "json", query: consulta })}`, {
    headers: { accept: "application/sparql-results+json", "user-agent": "CRV-local-media/1.0 (+coleccionistasderockvenezolano.com)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!respuesta.ok) throw new Error(`Wikidata HTTP ${respuesta.status}: ${(await respuesta.text()).slice(0, 200)}`);
  const payload = (await respuesta.json()) as { results?: { bindings?: T[] } };
  return payload.results?.bindings ?? [];
}

function consultaAnclada(tipo: "discogs" | "musicbrainz", valores: string[]): string {
  const prop = tipo === "discogs" ? "wdt:P1953" : "wdt:P434";
  const lista = valores.map((v) => `"${v.replace(/"/gu, "")}"`).join(" ");
  // OJO (medido 2026-10-16): `?item ?prop ?valor . VALUES ?prop { wd:P2002 … }` devuelve CERO filas
  // en el endpoint de Wikidata — el predicado no se filtra por VALUES. Hay que ir con UNION de
  // predicados explícitos.
  const bloques = Object.keys(PROPS).map((p) => `  { ?item ${prop} ?anchored ; wdt:${p} ?valor . BIND("${p}" AS ?prop) }`).join("\n  UNION\n");
  return `SELECT ?anchored ?item ?prop ?valor WHERE {
  VALUES ?anchored { ${lista} }
${bloques}
}`;
}

function leerJsonl<T>(ruta: string): T[] {
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const { rows } = await pool.query<{ aid: string; name: string; slug: string; external_id: string }>(`
    SELECT a.id::text AS aid, a.name, s.slug, i.external_id
      FROM ingest.genre_external_identities i
      JOIN ingest.genre_external_sources s ON s.id = i.source_id
      JOIN public.artists a ON a.id = i.entity_id
     WHERE i.entity_kind = 'artist' AND i.status = 'matched' AND s.slug IN ('discogs', 'musicbrainz')
       AND NOT EXISTS (SELECT 1 FROM public.social_links sl WHERE sl.artist_id = a.id)
     ORDER BY a.id`);
  await pool.end();

  const anclas: Ancla[] = rows.map((r) => ({
    artistId: Number(r.aid), artista: r.name,
    tipo: r.slug === "discogs" ? "discogs" : "musicbrainz", valor: r.external_id,
  }));
  console.log(`anclas disponibles: ${anclas.length} (artistas sin red con identidad aceptada)`);

  const yaHechos = new Set(leerJsonl<{ artistId: number }>(EVIDENCIA).map((e) => e.artistId));
  const pendientes = anclas.filter((a) => !yaHechos.has(a.artistId));
  console.log(`pendientes: ${pendientes.length}`);

  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };

  for (const tipo of ["discogs", "musicbrainz"] as const) {
    const grupo = pendientes.filter((a) => a.tipo === tipo);
    for (let i = 0; i < grupo.length; i += LOTE) {
      const trozo = grupo.slice(i, i + LOTE);
      const porValor = new Map<string, Ancla>();
      for (const a of trozo) porValor.set(a.valor, a);
      let filas: Array<Record<string, { value?: string }>>;
      try {
        filas = await sparql(consultaAnclada(tipo, [...porValor.keys()]));
      } catch (error) {
        console.error(`lote ${i / LOTE + 1} (${tipo}): ${(error as Error).message}`);
        sumar(`error de lote (${tipo})`);
        await dormir(DELAY * 4);
        continue;
      }
      const porArtista = new Map<number, { qid: string; urls: Set<string>; props: Set<string> }>();
      for (const fila of filas) {
        const anclaValor = fila["anchored"]?.value;
        const qid = fila["item"]?.value?.split("/").pop();
        const prop = fila["prop"]?.value?.split("/").pop();
        const valor = fila["valor"]?.value;
        if (!anclaValor || !qid || !prop || !valor) continue;
        const ancla = porValor.get(anclaValor);
        const convierte = PROPS[prop];
        if (!ancla || !convierte) continue;
        const acumulado = porArtista.get(ancla.artistId) ?? { qid, urls: new Set<string>(), props: new Set<string>() };
        acumulado.urls.add(convierte(valor));
        acumulado.props.add(prop);
        porArtista.set(ancla.artistId, acumulado);
      }
      for (const ancla of trozo) {
        const encontrado = porArtista.get(ancla.artistId);
        if (!encontrado || encontrado.urls.size === 0) { sumar(`sin redes en Wikidata (${tipo})`); continue; }
        appendFileSync(EVIDENCIA, JSON.stringify({
          artistId: ancla.artistId, artista: ancla.artista, wikidataQid: encontrado.qid,
          urls: [...encontrado.urls],
          guarda: `entidad Wikidata ${encontrado.qid} anclada por ${tipo === "discogs" ? "Discogs P1953" : "MusicBrainz P434"} ${ancla.valor}`,
          fuente: `https://www.wikidata.org/wiki/${encontrado.qid}`,
        }) + "\n");
        sumar(`evidencia Wikidata (${tipo})`);
      }
      console.log(`${i + trozo.length}/${grupo.length} (${tipo}) · ${JSON.stringify(cuenta)}`);
      await dormir(DELAY);
    }
  }

  console.log(JSON.stringify({ anclas: anclas.length, pendientes: pendientes.length, cuenta }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
