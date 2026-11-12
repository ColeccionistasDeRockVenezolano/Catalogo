import { getPool } from "../../db/client.js";
import type { Canonical } from "../query-interpretation/compiler.js";

/**
 * Etapa 4 · parte estructurada (propuesta 2026-11-12).
 * Convierte el plan que respondió el modo «solo si coinciden» en una recuperación sobre el catálogo, y solo cuando TODAS las
 * condiciones son de género o década. Cualquier otra cosa (emoción, actividad, nombre, parecido, pendientes…) no se ejecuta:
 * el buscador de siempre sigue siendo la respuesta. Requisitos y exclusiones gobiernan la elegibilidad; el orden es
 * determinista (género principal, preferencias, tamaño del catálogo). Todo va parametrizado: el texto del visitante nunca llega a SQL.
 */
export const STRUCTURED_PLAN_VERSION = "crv-structured-plan-0.1.0";

export type PlanMode = "off" | "shadow" | "on";
export function planMode(env: NodeJS.ProcessEnv = process.env): PlanMode {
  const v = env["CRV_QUERY_PLAN"];
  return v === "shadow" || v === "on" ? v : "off";
}

export interface StructuredPlan {
  req: string[]; exc: string[]; pref: string[]; any: string[][];
  decade: { from: number; to: number; label: string } | null;
}
export type PlanRefusal = "not_query_valid" | "pending" | "entities" | "context" | "facets" | "alternatives"
  | "unsupported_condition" | "multiple_decades" | "empty" | "unknown_genre" | "invalid_decade";

const GENRE = /^genre:([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const DECADE = /^decade:(\d{4})s$/;

export function parseStructuredPlan(c: Canonical): { plan: StructuredPlan } | { refusal: PlanRefusal } {
  if (c.status !== "query_valid") return { refusal: "not_query_valid" };
  if ((c.pending ?? 0) > 0) return { refusal: "pending" };
  if ((c.ent ?? []).length) return { refusal: "entities" };
  if (c.ctx) return { refusal: "context" };
  if ((c.facets ?? []).length) return { refusal: "facets" };
  if ((c.alts ?? []).length) return { refusal: "alternatives" };
  const genres = (xs: readonly string[] | undefined): string[] | null => {
    const out: string[] = [];
    for (const t of xs ?? []) { const m = GENRE.exec(t); if (!m) return null; out.push(m[1]!); }
    return out;
  };
  const decades: string[] = [];
  const split = (xs: readonly string[] | undefined): string[] | null => {
    const g: string[] = [];
    for (const t of xs ?? []) {
      if (DECADE.test(t)) decades.push(t);
      else g.push(t);
    }
    return genres(g);
  };
  const req = split(c.req);
  if (c.exc?.some(t => DECADE.test(t)) || c.pref?.some(t => DECADE.test(t))) return { refusal: "unsupported_condition" };
  const exc = genres(c.exc), pref = genres(c.pref);
  const any: string[][] = [];
  for (const g of c.any ?? []) { if (!Array.isArray(g) || g.some(t => !GENRE.test(t))) return { refusal: "unsupported_condition" }; any.push(g.map(t => GENRE.exec(t)![1]!)); }
  if (!req || !exc || !pref) return { refusal: "unsupported_condition" };
  if (decades.length > 1) return { refusal: "multiple_decades" };
  let decade: StructuredPlan["decade"] = null;
  if (decades.length) {
    const year = Number(DECADE.exec(decades[0]!)![1]);
    if (year % 10 !== 0 || year < 1900 || year > 2020) return { refusal: "invalid_decade" };
    decade = { from: year, to: year + 9, label: `${year}s` };
  }
  if (!req.length && !any.length && !decade) return { refusal: "empty" };
  return { plan: { req, exc, pref, any, decade } };
}

export interface PlanHit { type: "artist" | "album"; id: number; label: string; context: string | null; albumId: null; imageUrl: string | null }
export interface StructuredResult {
  version: typeof STRUCTURED_PLAN_VERSION;
  interpretation: { require: string[]; exclude: string[]; prefer: string[]; anyOf: string[][]; decade: string | null };
  artist: PlanHit[]; album: PlanHit[]; totals: { artist: number; album: number };
  /** Fichas que no pudieron evaluarse por no tener el dato (género o año): no aparecen, pero no significa que no cumplan. */
  withoutData: { genre?: { artist: number; album: number }; year?: { artist: number; album: number } };
  ms: number;
}

async function genreClosure(slugs: string[]): Promise<Map<string, { name: string; ids: string[] }> | null> {
  if (!slugs.length) return new Map();
  const { rows } = await getPool().query<{ slug: string; name: string; ids: string[] }>(
    `SELECT g.slug, g.name, array_agg(DISTINCT d.id)::text[] AS ids
       FROM ingest.genres g
       JOIN ingest.genres d ON d.active AND (d.id = g.id OR d.parent_genre_id = g.id
            OR d.parent_genre_id IN (SELECT c.id FROM ingest.genres c WHERE c.parent_genre_id = g.id))
      WHERE g.slug = ANY($1::text[]) AND g.active GROUP BY g.slug, g.name`, [slugs]);
  const out = new Map(rows.map(r => [r.slug, { name: r.name, ids: r.ids }]));
  return slugs.every(s => out.has(s)) ? out : null;
}

const unknownCache = new Map<string, { at: number; value: { artist: number; album: number } }>();
async function unknownCounts(dim: "genre" | "year"): Promise<{ artist: number; album: number }> {
  const hit = unknownCache.get(dim);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const sql = dim === "genre"
    ? [`SELECT count(*) FROM ingest.catalog_artists a WHERE NOT EXISTS (SELECT 1 FROM ingest.artist_genres g WHERE g.artist_id = a.id AND g.status = 'confirmed')`,
       `SELECT count(*) FROM ingest.catalog_albums al WHERE NOT EXISTS (SELECT 1 FROM ingest.album_genres g WHERE g.album_id = al.id AND g.status = 'confirmed')
          AND NOT EXISTS (SELECT 1 FROM ingest.artist_genres g WHERE g.artist_id = al.artist_id AND g.status = 'confirmed' AND g.role = 'primary')`]
    : [`SELECT count(*) FROM ingest.catalog_artists a WHERE a.formed_year IS NULL AND NOT EXISTS (SELECT 1 FROM ingest.catalog_albums x WHERE x.artist_id = a.id AND x.release_year IS NOT NULL)`,
       `SELECT count(*) FROM ingest.catalog_albums al WHERE al.release_year IS NULL`];
  const [a, b] = await Promise.all(sql.map(s => getPool().query<{ count: string }>(s)));
  const value = { artist: Number(a!.rows[0]!.count), album: Number(b!.rows[0]!.count) };
  unknownCache.set(dim, { at: Date.now(), value });
  return value;
}

/** Cláusulas de coincidencia de género: el propio género o un descendiente; un disco sin género propio hereda solo el género PRINCIPAL de su artista (un secundario no afirma nada de cada disco: «calipso» daba 280 discos de más). */
const artistHas = (p: string) => `EXISTS (SELECT 1 FROM ingest.artist_genres g WHERE g.artist_id = a.id AND g.status = 'confirmed' AND g.genre_id = ANY(${p}::bigint[]))`;
const albumOwn = (p: string) => `EXISTS (SELECT 1 FROM ingest.album_genres g WHERE g.album_id = al.id AND g.status = 'confirmed' AND g.genre_id = ANY(${p}::bigint[]))`;
const albumHas = (p: string) => `(${albumOwn(p)} OR (NOT EXISTS (SELECT 1 FROM ingest.album_genres g WHERE g.album_id = al.id AND g.status = 'confirmed')
  AND EXISTS (SELECT 1 FROM ingest.artist_genres g WHERE g.artist_id = al.artist_id AND g.status = 'confirmed' AND g.role = 'primary' AND g.genre_id = ANY(${p}::bigint[]))))`;

export async function executeStructured(plan: StructuredPlan, limit = 20): Promise<StructuredResult | { refusal: PlanRefusal }> {
  const t0 = performance.now();
  const slugs = [...new Set([...plan.req, ...plan.exc, ...plan.pref, ...plan.any.flat()])];
  const closure = await genreClosure(slugs);
  if (!closure) return { refusal: "unknown_genre" };
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const ids = (slug: string) => add(closure.get(slug)!.ids);
  const union = (list: string[]) => add([...new Set(list.flatMap(s => closure.get(s)!.ids))]);

  const artistWhere: string[] = [], albumWhere: string[] = [];
  for (const s of plan.req) { const p = ids(s); artistWhere.push(artistHas(p)); albumWhere.push(albumHas(p)); }
  for (const s of plan.exc) { const p = ids(s); artistWhere.push(`NOT ${artistHas(p)}`); albumWhere.push(`NOT ${albumHas(p)}`); }
  for (const group of plan.any) {
    const p = union(group); artistWhere.push(artistHas(p)); albumWhere.push(albumHas(p));
  }
  if (plan.decade) {
    const from = add(plan.decade.from), to = add(plan.decade.to);
    artistWhere.push(`(a.formed_year BETWEEN ${from} AND ${to} OR EXISTS (SELECT 1 FROM ingest.catalog_albums x WHERE x.artist_id = a.id AND x.release_year BETWEEN ${from} AND ${to}))`);
    albumWhere.push(`al.release_year BETWEEN ${from} AND ${to}`);
  }
  const wanted = union([...plan.req, ...plan.any.flat()]);
  const preferred = union(plan.pref);
  const lim = add(Math.max(1, Math.min(50, Math.floor(limit))));

  const artistSql = `SELECT a.id::text AS id, a.name, a.origin_city AS context, coalesce(a.picture_url, a.logo_url) AS image_url, count(*) OVER() AS total
      FROM ingest.catalog_artists a WHERE lower(a.name) <> 'various artists' AND ${artistWhere.join(" AND ") || "true"}
      ORDER BY (SELECT count(*) FROM ingest.artist_genres g WHERE g.artist_id = a.id AND g.status = 'confirmed' AND g.role = 'primary' AND g.genre_id = ANY(${wanted}::bigint[])) DESC,
               (SELECT count(*) FROM ingest.artist_genres g WHERE g.artist_id = a.id AND g.status = 'confirmed' AND g.genre_id = ANY(${preferred}::bigint[])) DESC,
               (SELECT count(*) FROM ingest.catalog_albums x WHERE x.artist_id = a.id) DESC, a.name, a.id
      LIMIT ${lim}`;
  const albumSql = `SELECT al.id::text AS id, al.title AS name, a.name AS context, al.cover_url AS image_url, count(*) OVER() AS total
      FROM ingest.catalog_albums al JOIN ingest.catalog_artists a ON a.id = al.artist_id WHERE ${albumWhere.join(" AND ") || "true"}
      ORDER BY (CASE WHEN ${albumOwn(wanted)} THEN 1 ELSE 0 END) DESC,
               (CASE WHEN ${albumOwn(preferred)} THEN 1 ELSE 0 END) DESC,
               coalesce(al.rym_ratings_count, 0) DESC, al.release_year NULLS LAST, al.id
      LIMIT ${lim}`;
  type Row = { id: string; name: string; context: string | null; image_url: string | null; total: string };
  const [artists, albums] = await Promise.all([getPool().query<Row>(artistSql, params), getPool().query<Row>(albumSql, params)]);
  const hit = (type: PlanHit["type"]) => (r: Row): PlanHit => ({ type, id: Number(r.id), label: r.name, context: r.context, albumId: null, imageUrl: r.image_url });
  const withoutData: StructuredResult["withoutData"] = {};
  if (plan.req.length || plan.exc.length || plan.any.length) withoutData.genre = await unknownCounts("genre");
  if (plan.decade) withoutData.year = await unknownCounts("year");
  const name = (s: string) => closure.get(s)!.name;
  return {
    version: STRUCTURED_PLAN_VERSION,
    interpretation: { require: plan.req.map(name), exclude: plan.exc.map(name), prefer: plan.pref.map(name), anyOf: plan.any.map(g => g.map(name)), decade: plan.decade?.label ?? null },
    artist: artists.rows.map(hit("artist")), album: albums.rows.map(hit("album")),
    totals: { artist: Number(artists.rows[0]?.total ?? 0), album: Number(albums.rows[0]?.total ?? 0) },
    withoutData, ms: performance.now() - t0,
  };
}
