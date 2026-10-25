import { classificationFilterKey } from "../../shared/classification-filters.js";
import { isMusicalClassification } from "../../catalog/album-classifications.js";
import { getPool } from "../../db/client.js";
import { B_SIDES_FILTER, B_SIDES_SQL, LIVE_FILTER, LIVE_SQL } from "./albums.js";
import { ARTIST_GROUPS, artistGroupSql } from "./artist-groups.js";
import { EXTRA_ALBUM_CATEGORIES } from "./album-categories.js";

/** Conteos del catálogo completo, como los filtros de géneros y organizaciones. */
export async function getTypeFacets(kind: "artist" | "album") {
  const table = kind === "artist" ? "artists" : "albums";
  // Los artistas se cuentan por grupo (Bandas, Solistas, Dúos: artist-groups.ts),
  // en ese orden; los discos, por `album_type`.
  const column = kind === "artist" ? artistGroupSql("t") : "t.album_type::text";
  const { rows } = await getPool().query<{ value: string; count: string }>(
    `SELECT ${column} AS value, count(*)::text AS count
       FROM ingest.catalog_${table} t GROUP BY 1 ORDER BY 1`,
  );
  const order = (value: string) => {
    const index = (ARTIST_GROUPS as readonly string[]).indexOf(value);
    return index === -1 ? ARTIST_GROUPS.length : index;
  };
  const types = rows.map((row) => ({ value: row.value, count: Number(row.count) }))
    .sort((a, b) => (kind === "artist" ? order(a.value) - order(b.value) : 0));
  if (kind === "album") {
    // Los B-Sides no son un `album_type` del core: suman aparte, sin entrar en el total.
    const extras = await getPool().query<{ b_sides: string; live: string }>(
      `SELECT count(*) FILTER (WHERE ${B_SIDES_SQL})::text AS b_sides,
              count(*) FILTER (WHERE ${LIVE_SQL})::text AS live FROM ingest.catalog_albums al`,
    );
    const count = Number(extras.rows[0]?.b_sides ?? 0);
    if (count > 0) types.push({ value: B_SIDES_FILTER, count });
    const live = Number(extras.rows[0]?.live ?? 0);
    if (live > 0) types.push({ value: LIVE_FILTER, count: live });
    // Las fichas mixtas conservan su tipo y participan en sus categorías.
    const classified = await getPool().query<{ value: string; count: string }>(`
      SELECT category.value, count(al.id)::text AS count
        FROM (VALUES ('ep','EP'), ('demo','Demos'), ('compilation','Compilation Album')) category(value,label)
        LEFT JOIN ingest.catalog_albums al ON al.album_type::text=category.value OR EXISTS (
          SELECT 1 FROM ingest.effective_album_classifications c WHERE c.album_id=al.id AND c.classification=category.label)
       GROUP BY category.value`);
    for (const row of classified.rows) {
      const existing = types.find(type => type.value === row.value);
      if (existing) existing.count = Number(row.count);
      else if (Number(row.count) > 0) types.push({ value: row.value, count: Number(row.count) });
    }
    const classifications=(await getPool().query<{classification:string}>("SELECT DISTINCT classification FROM ingest.effective_album_classifications ORDER BY classification")).rows;
    const byKey=new Map<string,string[]>();
    for(const {classification} of classifications) if(isMusicalClassification(classification)) {
      const key=classificationFilterKey(classification);byKey.set(key,[...(byKey.get(key)??[]),classification]);
    }
    for(const [key,labels] of byKey) {
      if(['b_sides','live','acoustic','instrumental','remix'].includes(key))continue;
      const count=Number((await getPool().query<{n:string}>(`SELECT count(*)::text AS n FROM ingest.catalog_albums a WHERE a.album_type::text=$1 OR EXISTS(SELECT 1 FROM ingest.effective_album_classifications c WHERE c.album_id=a.id AND c.classification=ANY($2::text[]))`,[key,labels])).rows[0]!.n);
      const existing=types.find(t=>t.value===key);if(existing)existing.count=count;else if(count)types.push({value:key,count});
    }
    const characteristicCounts = (await getPool().query<Record<string, number>>(`SELECT
      ${EXTRA_ALBUM_CATEGORIES.map(category => `count(*) FILTER (WHERE ${category.sql})::int AS "${category.key}"`).join(", ")}
      FROM ingest.catalog_albums al`)).rows[0]!;
    for (const category of EXTRA_ALBUM_CATEGORIES) {
      const count = characteristicCounts[category.key] ?? 0;
      const existing = types.find(type => type.value === category.key);
      if (existing) existing.count = count;
      else if (count > 0) types.push({ value: category.key, count });
    }
  }
  const yearColumn = kind === "artist" ? "formed_year" : "release_year";
  const years = await getPool().query<{ decade: number | null; count: string }>(
    `SELECT (floor(${yearColumn} / 10.0) * 10)::int AS decade, count(*)::text AS count
       FROM ingest.catalog_${table} GROUP BY decade ORDER BY decade NULLS LAST`,
  );
  const decades = years.rows.filter((row) => row.decade !== null)
    .map((row) => ({ decade: row.decade!, count: Number(row.count) }));
  const withoutYear = Number(years.rows.find((row) => row.decade === null)?.count ?? 0);
  return { decades, withoutYear, total: rows.reduce((sum, row) => sum + Number(row.count), 0), types };
}
