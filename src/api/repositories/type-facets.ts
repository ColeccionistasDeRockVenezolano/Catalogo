import { getPool } from "../../db/client.js";

/** Conteos del catálogo completo, como los filtros de géneros y organizaciones. */
export async function getTypeFacets(kind: "artist" | "album") {
  const table = kind === "artist" ? "artists" : "albums";
  const column = kind === "artist" ? "artist_type" : "album_type";
  const { rows } = await getPool().query<{ value: string; count: string }>(
    `SELECT ${column}::text AS value, count(*)::text AS count
       FROM public.${table} GROUP BY ${column} ORDER BY ${column}`,
  );
  const types = rows.map((row) => ({ value: row.value, count: Number(row.count) }));
  const yearColumn = kind === "artist" ? "formed_year" : "release_year";
  const years = await getPool().query<{ decade: number | null; count: string }>(
    `SELECT (floor(${yearColumn} / 10.0) * 10)::int AS decade, count(*)::text AS count
       FROM public.${table} GROUP BY decade ORDER BY decade NULLS LAST`,
  );
  const decades = years.rows.filter((row) => row.decade !== null)
    .map((row) => ({ decade: row.decade!, count: Number(row.count) }));
  const withoutYear = Number(years.rows.find((row) => row.decade === null)?.count ?? 0);
  return { decades, withoutYear, total: types.reduce((sum, type) => sum + type.count, 0), types };
}
