import { getPool } from "../../db/client.js";
import { genreFacets } from "../../genres/public.js";

/** El menú solo necesita totales y atajos, nunca créditos ni tipos de publicación. */
export async function getCatalogOverview() {
  const [counts, years, genres] = await Promise.all([
    getPool().query<{ artists: number; albums: number; persons: number; organizations: number }>(`
      SELECT (SELECT count(*)::int FROM ingest.catalog_artists) AS artists,
             (SELECT count(*)::int FROM ingest.catalog_albums) AS albums,
             (SELECT count(*)::int FROM public.persons) AS persons,
             (SELECT count(*)::int FROM public.organizations) AS organizations`),
    getPool().query<{ decade: number }>(`
      SELECT DISTINCT (floor(release_year / 10.0) * 10)::int AS decade
        FROM ingest.catalog_albums WHERE release_year >= 1960 ORDER BY decade`),
    genreFacets("artist"),
  ]);
  const totals = counts.rows[0]!;
  return {
    totals: { "/artistas": totals.artists, "/discos": totals.albums, "/personas": totals.persons, "/organizaciones": totals.organizations },
    genres: [...genres.families].sort((a, b) => b.count - a.count).slice(0, 8).map(({ slug, name }) => ({ slug, name })),
    decades: years.rows.map(({ decade }) => decade),
  };
}
