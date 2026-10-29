// CRV · Prensa de Rock Hecho en Venezuela (rockhechovzla.blogspot.com),
// captura completa del 2026-10-25 (data/raw/deep-rhv-blogspot-2026-10-25).
//
// Sus 18 fichas ya están en el catálogo; el resto del blog (264 entradas) son
// reseñas, notas de prensa, lanzamientos, entrevistas y eventos. No se deduce
// de ellas ningún dato del core: cada entrada queda como documento del artista
// (media.artist_documents) cuando su TÍTULO nombra a un artista del catálogo
// sin ambigüedad. Reglas del cruce:
//   · nombre o alias del catálogo (variantes predecibles), un solo artista;
//   · nombres de una palabra solo si el título los escribe en MAYÚSCULAS (la
//     convención del blog para bandas) o el texto los repite ≥ 2 veces;
//   · nombres de menos de 4 letras no cuentan.
//
//   RHVB_OUT=…/dir ./scripts/with-node22.sh npx tsx scripts/rhv-blogspot-press.mts [--confirm]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { predictableNameVariants } from "../src/normalization/entity-name.js";

const TAG = "rhv-blogspot-2026-10-25";
const POSTS = "data/raw/deep-rhv-blogspot-2026-10-25/posts.jsonl";
const OUT = process.env["RHVB_OUT"];
const CONFIRM = process.argv.includes("--confirm");
if (!OUT) throw new Error("falta RHVB_OUT");
const VARIOUS = 257;

interface Post { post_id: string; url: string; titulo: string; fecha: string; etiquetas: string[]; content_text: string }
const posts = readFileSync(POSTS, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Post);

const fold = (value: string): string => value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
const words = (value: string): string[] => value.split(/[\s.,:;!?¡¿()«»"“”'’\-–—/…]+/u).filter(Boolean);
function categoryOf(tags: string[]): string {
  if (tags.includes("entrevistas")) return "interview";
  if (tags.includes("criticas") || tags.includes("reseñas")) return "review";
  if (tags.includes("leyendas") || tags.includes("antologías")) return "article";
  if (tags.includes("eventos") && !tags.includes("lanzamientos")) return "event";
  return "news";
}

// Palabras comunes que coinciden con un artista del catálogo pero en estos títulos no lo nombran.
const STOP = new Set(["the", "nada", "sangre", "fusion", "resistencia", "exilio", "trauma", "matter", "averno", "marshall", "edicion", "metal", "rock", "fest"]);
// Revisados en el simulacro: frases comunes («esa es la cuestión», «la banda», «primera edición»,
// «la gente buena», «desde el averno») que coinciden con un nombre o alias del catálogo.
const EXCLUDED_ARTISTS = new Set([1504, 4628, 31, 2783, 2311, 1661, 210, 5805, 3052]);
const report = {
  mode: CONFIRM ? "confirm" : "dry-run", runId: 0, posts: posts.length,
  documents: 0, alreadyThere: 0, postsLinked: 0, postsWithoutArtist: [] as string[], ambiguous: [] as unknown[],
  links: [] as Array<{ post: string; artistId: number; artist: string; category: string }>,
};

async function apply(client: PoolClient, runId: number): Promise<void> {
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query<T>(sql, params)).rows;
  const names = new Map<number, string>();
  const byVariant = new Map<string, Set<number>>();
  const add = (name: string, id: number): void => {
    if (id === VARIOUS || fold(name).replace(/[^a-z0-9]/g, "").length < 4) return;
    for (const variant of predictableNameVariants(name)) (byVariant.get(variant) ?? byVariant.set(variant, new Set()).get(variant)!).add(id);
  };
  for (const row of await q<{ id: string; name: string }>("SELECT id::text,name FROM public.artists")) { names.set(Number(row.id), row.name); add(row.name, Number(row.id)); }
  for (const row of await q<{ artist_id: string; alias: string }>("SELECT artist_id::text,alias FROM ingest.artist_aliases")) add(row.alias, Number(row.artist_id));
  const existing = new Set((await q<{ k: string }>("SELECT artist_id||'|'||source_url k FROM media.artist_documents WHERE source_url IS NOT NULL")).map((row) => row.k));

  for (const post of posts) {
    // Lo que va entre comillas es un título de canción o disco, no la banda.
    const unquoted = post.titulo.replace(/[“"«][^”"»]*[”"»]/gu, " | ");
    const tokens = words(unquoted);
    const found = new Map<number, string>();
    const ambiguous: string[] = [];
    // Ventanas de 1 a 6 palabras del título, de la más larga a la más corta.
    const covered = new Set<number>();
    for (let size = Math.min(6, tokens.length); size >= 1; size -= 1) {
      for (let start = 0; start + size <= tokens.length; start += 1) {
        if ([...Array(size).keys()].some((offset) => covered.has(start + offset))) continue;
        const phrase = tokens.slice(start, start + size).join(" ");
        const ids = new Set<number>();
        for (const variant of predictableNameVariants(phrase)) for (const id of byVariant.get(variant) ?? []) ids.add(id);
        if (!ids.size) continue;
        if (size === 1) {
          // Una palabra sola: en MAYÚSCULAS dentro de un título que no lo está entero, o al inicio del título.
          const upper = phrase === phrase.toUpperCase() && /\p{Lu}{4}/u.test(phrase);
          const shouting = unquoted.replace(/[^\p{L}]/gu, "").length > 0 && unquoted.replace(/[^\p{Lu}]/gu, "").length / unquoted.replace(/[^\p{L}]/gu, "").length > 0.8;
          if (!(upper && (!shouting || start === 0)) || STOP.has(fold(phrase))) continue;
        }
        if (ids.size > 1) { ambiguous.push(phrase); continue; }
        found.set([...ids][0]!, phrase);
        for (let offset = 0; offset < size; offset += 1) covered.add(start + offset);
      }
    }
    if (ambiguous.length) report.ambiguous.push({ post: post.titulo, phrases: ambiguous });
    if (!found.size) { report.postsWithoutArtist.push(post.titulo); continue; }
    report.postsLinked += 1;
    const category = categoryOf(post.etiquetas);
    for (const artistId of [...found.keys()].filter((id) => !EXCLUDED_ARTISTS.has(id))) {
      report.links.push({ post: post.titulo, artistId, artist: names.get(artistId)!, category });
      if (existing.has(`${artistId}|${post.url}`)) { report.alreadyThere += 1; continue; }
      await client.query(`
        INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,date_text,tags,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [artistId, `${TAG}:${post.post_id}:${artistId}`, category, post.titulo.trim(), post.content_text.trim(), post.url, post.fecha.slice(0, 10),
        [TAG, ...post.etiquetas], JSON.stringify({ campaign: TAG, source: "rhv-blogspot", runId })]);
      existing.add(`${artistId}|${post.url}`);
      report.documents += 1;
    }
  }
}

const pool = getPool();
if (CONFIRM) {
  const outcome = await withOperatorRun({ name: "rhv-blogspot:press", operator: "claude-code (encargo de Brian)",
    note: "Prensa de rockhechovzla.blogspot.com como documentos del artista (captura 2026-10-25)", params: { campaign: TAG } },
  async (context) => { report.runId = context.runId; await apply(context.client, context.runId); });
  report.runId = outcome.runId;
} else {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await apply(client, 0); } finally { await client.query("ROLLBACK"); client.release(); }
}
mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, CONFIRM ? "prensa.json" : "prensa-dry-run.json");
writeFileSync(file, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, links: report.links.length, postsWithoutArtist: report.postsWithoutArtist.length, ambiguous: report.ambiguous.length }, null, 1));
console.log(`-> ${file}`);
await closeDb();
