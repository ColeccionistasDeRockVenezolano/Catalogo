// Entrada de la cosecha de reproductores (2026-10-13): artistas, sus discos y los enlaces de
// escucha que ya tienen, leídos de la BD viva para que la cosecha trabaje sobre ids actuales.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/streaming-embeds-entrada.ts reports/streaming-embeds-2026-10-13
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";

const DIR = process.argv[2] ?? "reports/streaming-embeds-2026-10-13";

async function main(): Promise<void> {
  const pool = getPool();
  const artistas = await pool.query(`
    SELECT a.id::int AS id, a.name,
      COALESCE((SELECT jsonb_object_agg(sl.platform, jsonb_build_object('url', sl.url, 'id', sl.external_id, 'verified', sl.verified))
        FROM public.streaming_links sl WHERE sl.artist_id = a.id), '{}'::jsonb) AS links,
      COALESCE((SELECT jsonb_agg(al.alias) FROM ingest.artist_aliases al WHERE al.artist_id = a.id), '[]'::jsonb) AS aliases
    FROM public.artists a
    WHERE a.name NOT ILIKE 'various%' AND a.name NOT ILIKE 'varios%'
      AND EXISTS (SELECT 1 FROM public.albums x WHERE x.artist_id = a.id)
    ORDER BY a.id`);
  const discos = await pool.query(`
    SELECT al.id::int AS id, al.artist_id::int AS "artistId", al.title, al.release_year AS year,
      COALESCE((SELECT jsonb_object_agg(sl.platform, jsonb_build_object('url', sl.url, 'id', sl.external_id, 'verified', sl.verified))
        FROM public.streaming_links sl WHERE sl.album_id = al.id), '{}'::jsonb) AS links
    FROM public.albums al ORDER BY al.artist_id, al.id`);
  mkdirSync(path.join(DIR, "entrada"), { recursive: true });
  writeFileSync(path.join(DIR, "entrada", "artistas.jsonl"), artistas.rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(path.join(DIR, "entrada", "discos.jsonl"), discos.rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`artistas ${artistas.rowCount} · discos ${discos.rowCount}`);
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exit(1); });
