import type { Pool, PoolClient } from "pg";

type Database = Pick<Pool | PoolClient, "query">;
export const EDITORIAL_EXCLUSION_MESSAGE = "Esta identidad se conserva como persona o referencia colectiva. La decisión editorial impide convertirla en artista o importar su discografía.";

export async function excludedArtist(db: Database, options: { artistId?: number | undefined; personId?: number | undefined; name?: string | undefined; names?: string[] | undefined }) {
  return (await db.query<{ artist_id: string; reason: string }>(`SELECT p.artist_id,p.reason FROM ingest.artist_editorial_policy p
    WHERE p.artist_id=$1 OR EXISTS(SELECT 1 FROM ingest.artist_editorial_persons s WHERE s.artist_id=p.artist_id AND s.person_id=$2)
    OR EXISTS(SELECT 1 FROM ingest.artist_editorial_names n WHERE n.artist_id=p.artist_id
      AND n.name_key IN (SELECT ingest.editorial_name_key(value) FROM unnest($3::text[]) value)) LIMIT 1`,
  [options.artistId ?? null,options.personId ?? null,[...(options.names??[]),...(options.name?[options.name]:[])]] )).rows[0];
}
