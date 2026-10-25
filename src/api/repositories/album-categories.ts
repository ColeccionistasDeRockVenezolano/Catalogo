import { ALBUM_CHARACTERISTICS, ALBUM_EDITION_TYPES } from "../../shared/album-categories.js";

/** SQL solo de vocabulario interno, nunca de valores recibidos de la API. */
export const EXTRA_ALBUM_CATEGORIES = [
  ...ALBUM_CHARACTERISTICS.map(category => ({
    key: category.key,
    sql: `(EXISTS (SELECT 1 FROM ingest.effective_album_classifications c WHERE c.album_id=al.id AND ${category.key === "acoustic" ? "c.classification IN ('Acústico','Unplugged')" : `c.classification='${category.classification}'`})${category.key === "remix" ? " OR al.album_type='remix'" : ""})`,
  })),
  ...ALBUM_EDITION_TYPES.map(category => ({
    key: category.key,
    sql: `EXISTS (SELECT 1 FROM ingest.album_versions v WHERE v.album_id=al.id AND v.edition_types @> ARRAY['${category.key}']::text[])`,
  })),
];

/** La expresión recibida es SQL interno, nunca texto de la petición. */
export const extraAlbumFilterSql = (valueSql: string) => EXTRA_ALBUM_CATEGORIES
  .map(category => `(${valueSql}='${category.key}' AND ${category.sql})`).join(" OR ");
export const ALBUM_EDITION_TYPES_SQL = `coalesce((SELECT jsonb_agg(DISTINCT kind ORDER BY kind)
  FROM ingest.album_versions v CROSS JOIN LATERAL unnest(v.edition_types) kind WHERE v.album_id=al.id),'[]'::jsonb)`;
