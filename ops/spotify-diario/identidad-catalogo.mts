import { readFileSync, writeFileSync } from "node:fs";
import { getPool, closeDb } from "../../src/db/client.js";
const ids: number[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const pool = getPool();
const { rows } = await pool.query(`
  select a.id::int, a.name, coalesce(a.biography,'') bio, a.origin_country pais, a.origin_city ciudad, a.formed_year, a.picture_url,
    coalesce((select json_agg(json_build_object('platform',l.platform,'url',l.url,'externalId',l.external_id,'verified',l.verified))
              from public.streaming_links l where l.artist_id=a.id), '[]') links,
    coalesce((select json_agg(distinct b.title) from public.albums b where b.artist_id=a.id), '[]') discos,
    coalesce((select json_agg(distinct t.title) from public.track_credits c join public.tracks t on t.id=c.track_id where c.artist_id=a.id), '[]') pistas,
    coalesce((select json_agg(distinct x.alias) from ingest.artist_aliases x where x.artist_id=a.id), '[]') alias
  from public.artists a where a.id = any($1)`, [ids]);
writeFileSync(process.argv[3], JSON.stringify(rows, null, 1));
console.log(rows.length);
await closeDb();
