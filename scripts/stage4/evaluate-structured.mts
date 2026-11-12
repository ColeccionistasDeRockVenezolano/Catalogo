/**
 * Etapa 4 · parte estructurada: evaluación sin red ni modelos.
 *   evaluate-structured.mts <dataset.json> <gated.jsonl> [--out resultado.json] [--sheet hoja-ab.md] [--sample 40]
 * Toma los planes que el modo «solo si coinciden» ya respondió (gated.jsonl, uno por consulta), ejecuta los servibles contra el
 * catálogo y mide: (1) violaciones de elegibilidad con un ORÁCULO independiente (recorre los ancestros del género, al revés
 * que el ejecutor, que baja a los descendientes); (2) consultas que hoy no devuelven nada y con el plan sí; (3) solapamiento
 * con el buscador actual. Solo lee la base.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getPool } from "../../src/db/client.js";
import type { Canonical } from "../../src/search/query-interpretation/compiler.js";
import { executeStructured, parseStructuredPlan, STRUCTURED_PLAN_VERSION, type PlanHit, type StructuredPlan } from "../../src/search/query-plan/structured.js";
import { globalSearch } from "../../src/api/repositories/search.js";

const [datasetPath, gatedPath, ...rest] = process.argv.slice(2);
const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const dataset = JSON.parse(readFileSync(datasetPath!, "utf8")) as { cases: { id: string; text: string; gold?: Canonical }[] };
const gated = new Map(readFileSync(gatedPath!, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as { id: string; canonical: Canonical; agree: boolean }).map(r => [r.id, r]));

/** Oráculo: géneros (con todos sus ancestros) de cada ficha, y años. Independiente de la consulta del ejecutor. */
async function oracle(artistIds: number[], albumIds: number[]) {
  const ancestors = `WITH RECURSIVE up(root, id, slug, parent) AS (
      SELECT g.genre_id, s.id, s.slug, s.parent_genre_id FROM {tbl} g JOIN ingest.genres s ON s.id = g.genre_id WHERE g.{key} = ANY($1::bigint[]) AND g.status = 'confirmed'
      UNION SELECT up.root, p.id, p.slug, p.parent_genre_id FROM up JOIN ingest.genres p ON p.id = up.parent)
    SELECT {key2} AS k, array_agg(DISTINCT slug) AS slugs FROM up JOIN {tbl} g ON g.genre_id = up.root AND g.{key} = ANY($1::bigint[]) AND g.status = 'confirmed' GROUP BY 1`;
  const q = (tbl: string, key: string, ids: number[], extra = "") => getPool().query<{ k: string; slugs: string[] }>(
    ancestors.replaceAll("{tbl}", tbl).replaceAll("{key2}", `g.${key}`).replaceAll("{key}", key).replaceAll("g.status = 'confirmed'", `g.status = 'confirmed'${extra}`), [ids]);
  const [ag, bg, albums, artistYears, albumArtist] = await Promise.all([
    q("ingest.artist_genres", "artist_id", artistIds), q("ingest.album_genres", "album_id", albumIds),
    getPool().query<{ id: string; artist_id: string; release_year: number | null }>(`SELECT id::text, artist_id::text, release_year FROM ingest.catalog_albums WHERE id = ANY($1::bigint[])`, [albumIds]),
    getPool().query<{ id: string; formed_year: number | null; years: number[] }>(
      `SELECT a.id::text, a.formed_year, coalesce((SELECT array_agg(x.release_year) FROM ingest.catalog_albums x WHERE x.artist_id = a.id AND x.release_year IS NOT NULL), '{}') AS years
         FROM ingest.catalog_artists a WHERE a.id = ANY($1::bigint[])`, [artistIds]),
    Promise.resolve(null),
  ]);
  void albumArtist;
  const artistSlugs = new Map(ag.rows.map(r => [Number(r.k), new Set(r.slugs)]));
  const ownAlbum = new Map(bg.rows.map(r => [Number(r.k), new Set(r.slugs)]));
  const parents = [...new Set(albums.rows.map(r => Number(r.artist_id)))];
  const inheritedFrom = (await q("ingest.artist_genres", "artist_id", parents, " AND g.role = 'primary'")).rows.map(r => [Number(r.k), new Set(r.slugs)] as const);
  const inherit = new Map(inheritedFrom);
  const hasOwnAny = new Set((await getPool().query<{ album_id: string }>(`SELECT DISTINCT album_id::text FROM ingest.album_genres WHERE album_id = ANY($1::bigint[]) AND status = 'confirmed'`, [albumIds])).rows.map(r => Number(r.album_id)));
  const albumInfo = new Map(albums.rows.map(r => [Number(r.id), { year: r.release_year, slugs: hasOwnAny.has(Number(r.id)) ? ownAlbum.get(Number(r.id)) ?? new Set<string>() : inherit.get(Number(r.artist_id)) ?? new Set<string>() }]));
  const artistInfo = new Map(artistYears.rows.map(r => [Number(r.id), { slugs: artistSlugs.get(Number(r.id)) ?? new Set<string>(), formed: r.formed_year, years: r.years }]));
  return { artistInfo, albumInfo };
}

function violations(plan: StructuredPlan, info: { slugs: Set<string>; years: (number | null)[] }): string[] {
  const out: string[] = [];
  for (const s of plan.req) if (!info.slugs.has(s)) out.push(`falta ${s}`);
  for (const s of plan.exc) if (info.slugs.has(s)) out.push(`tiene excluido ${s}`);
  for (const g of plan.any) if (!g.some(s => info.slugs.has(s))) out.push(`ninguno de ${g.join("/")}`);
  if (plan.decade && !info.years.some(y => y !== null && y >= plan.decade!.from && y <= plan.decade!.to)) out.push(`fuera de ${plan.decade.label}`);
  return out;
}

const rows: any[] = [];
const planByRow = new Map<string, StructuredPlan>();
let servable = 0, agreed = 0;
const refusals: Record<string, number> = {};
for (const c of dataset.cases) {
  const g = gated.get(c.id);
  if (!g?.agree) continue;
  agreed++;
  const parsed = parseStructuredPlan(g.canonical);
  if ("refusal" in parsed) { refusals[parsed.refusal] = (refusals[parsed.refusal] ?? 0) + 1; continue; }
  servable++;
  const result = await executeStructured(parsed.plan, 20);
  if ("refusal" in result) { refusals[result.refusal] = (refusals[result.refusal] ?? 0) + 1; continue; }
  const current = await globalSearch(c.text, 20, ["artist", "album"], () => {}, 0);
  const { artistInfo, albumInfo } = await oracle(result.artist.map(h => h.id), result.album.map(h => h.id));
  const bad: { type: string; id: number; why: string[] }[] = [];
  for (const h of result.artist) { const i = artistInfo.get(h.id); const why = violations(parsed.plan, { slugs: i?.slugs ?? new Set(), years: [i?.formed ?? null, ...(i?.years ?? [])] }); if (why.length) bad.push({ type: "artist", id: h.id, why }); }
  for (const h of result.album) { const i = albumInfo.get(h.id); const why = violations(parsed.plan, { slugs: i?.slugs ?? new Set(), years: [i?.year ?? null] }); if (why.length) bad.push({ type: "album", id: h.id, why }); }
  const ids = (hs: PlanHit[] | { id: number }[]) => new Set(hs.map(h => h.id));
  const curA = ids(current.artist), curB = ids(current.album);
  planByRow.set(c.id, parsed.plan);
  rows.push({
    id: c.id, text: c.text, interpretation: result.interpretation, totals: result.totals, ms: Math.round(result.ms), violations: bad,
    currentTotals: { artist: current.totals.artist, album: current.totals.album },
    overlapArtist: result.artist.filter(h => curA.has(h.id)).length, overlapAlbum: result.album.filter(h => curB.has(h.id)).length,
    planTop: { artist: result.artist.slice(0, 5).map(h => h.label), album: result.album.slice(0, 5).map(h => `${h.label} — ${h.context}`) },
    currentTop: { artist: current.artist.slice(0, 5).map(h => h.label), album: current.album.slice(0, 5).map(h => `${h.label} — ${h.context}`) },
  });
}
const nonEmpty = rows.filter(r => r.totals.artist + r.totals.album > 0);
const currentEmpty = rows.filter(r => r.currentTotals.artist + r.currentTotals.album === 0);
const summary = {
  version: STRUCTURED_PLAN_VERSION, dataset: datasetPath, evaluatedAt: new Date().toISOString(), cases: dataset.cases.length,
  agreed, servable, refusals,
  executed: rows.length, withResults: nonEmpty.length,
  hitsChecked: rows.reduce((n, r) => n + Math.min(20, r.totals.artist) + Math.min(20, r.totals.album), 0),
  violatingQueries: rows.filter(r => r.violations.length).length, violatingHits: rows.reduce((n, r) => n + r.violations.length, 0),
  currentEmpty: currentEmpty.length, rescued: currentEmpty.filter(r => r.totals.artist + r.totals.album > 0).length,
  planEmpty: rows.length - nonEmpty.length,
  msP95: [...rows.map(r => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length * 0.95)] ?? null,
};
// Autocomprobación del oráculo: con el plan invertido (lo requerido pasa a excluido) TODO resultado debe violar.
let selfCheck: { hits: number; flagged: number } | null = null;
const probe = rows.find(r => r.totals.artist > 0 && planByRow.get(r.id)!.req.length);
if (probe) {
  const plan = planByRow.get(probe.id)!;
  const res = await executeStructured(plan, 20);
  if (!("refusal" in res)) {
    const { artistInfo } = await oracle(res.artist.map(h => h.id), []);
    const inverted: StructuredPlan = { req: [], exc: plan.req, pref: [], any: [], decade: null };
    const flagged = res.artist.filter(h => violations(inverted, { slugs: artistInfo.get(h.id)?.slugs ?? new Set(), years: [] }).length).length;
    selfCheck = { hits: res.artist.length, flagged };
  }
}
Object.assign(summary, { oracleSelfCheck: selfCheck });
console.log(JSON.stringify(summary, null, 1));
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify({ summary, rows }, null, 1));
if (flag("--sheet")) {
  const n = Number(flag("--sample") ?? 40);
  const pick = rows.filter(r => r.totals.artist + r.totals.album > 0).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const L = (xs: string[]) => xs.length ? xs.join(" · ") : "—";
  const md = [`# Hoja A/B · plan estructurado ${STRUCTURED_PLAN_VERSION}`, "", "Para cada consulta: ¿el resultado interpretado es mejor, igual o peor que el actual? Marca A (plan), B (actual) o = .", ""];
  pick.forEach((r, i) => {
    const it = r.interpretation;
    md.push(`## ${i + 1}. «${r.text}»`, `Interpretado: requiere ${L(it.require)}${it.exclude.length ? ` · sin ${L(it.exclude)}` : ""}${it.decade ? ` · década ${it.decade}` : ""}${it.anyOf.length ? ` · alguno de ${it.anyOf.map((g: string[]) => g.join("/")).join(", ")}` : ""}`,
      `- **Plan** (${r.totals.artist} artistas, ${r.totals.album} discos): artistas ${L(r.planTop.artist)}; discos ${L(r.planTop.album)}`,
      `- **Actual** (${r.currentTotals.artist} artistas, ${r.currentTotals.album} discos): artistas ${L(r.currentTop.artist)}; discos ${L(r.currentTop.album)}`, `- Veredicto: ☐ A ☐ B ☐ =`, "");
  });
  writeFileSync(flag("--sheet")!, md.join("\n"));
}
await getPool().end();
