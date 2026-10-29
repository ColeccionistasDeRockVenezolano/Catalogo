import { writeFileSync } from "node:fs";
import path from "node:path";
import { getPool, closeDb } from "../src/db/client.js";
import { loadPersonFacts } from "../src/review/person-candidates.js";
const out = process.env["LOBOTO_OUT"];
if (!out) throw new Error("LOBOTO_OUT must point to SSD staging");
try {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const facts = await loadPersonFacts(db);
    const queries: Record<string, string> = {
      persons: "SELECT id,name,biography,real_name,notes,birth_date_value,death_date_value FROM public.persons",
      artists: "SELECT id,name,artist_type,biography,origin_city,origin_country FROM public.artists",
      artistAliases: "SELECT artist_id,alias FROM ingest.artist_aliases",
      albums: "SELECT al.id,al.title,al.artist_id,al.release_year,al.label_id,al.catalog_id,al.album_type,al.notes,o.name label FROM public.albums al LEFT JOIN public.organizations o ON o.id=al.label_id",
      tracks: "SELECT id,album_id,title,disc_number,track_number,duration_seconds FROM public.tracks",
      organizations: "SELECT id,name,organization_type FROM public.organizations",
      organizationAliases: "SELECT organization_id,alias FROM ingest.organization_aliases",
      distinct: "SELECT kind,a_id,b_id,note,decided_by FROM ingest.curation_distinct_pairs",
      reviews: "SELECT id,person_a_id,person_b_id,status,resolution_note FROM ingest.review_queue WHERE kind::text IN ('person_duplicate','person_match') AND person_a_id IS NOT NULL AND person_b_id IS NOT NULL",
      sources: "SELECT id,slug,name,enabled FROM ingest.sources WHERE slug ILIKE '%loboto%'",
    };
    const result: Record<string, unknown> = { at: new Date().toISOString(), facts };
    for (const [key, sql] of Object.entries(queries)) result[key] = (await db.query(sql)).rows;
    await db.query("COMMIT");
    writeFileSync(path.join(out, "catalog-before.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Array.isArray(value) ? value.length : value]))));
  } finally { db.release(); }
} finally { await closeDb(); }
