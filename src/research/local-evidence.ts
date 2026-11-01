// CRV · Recuperación de evidencia local para el clasificador.
//
// Devuelve solo fragmentos cortos y citables; nunca rutas de archivo ni el
// cuerpo completo. Si el índice no está construido, devuelve vacío y la
// verificación sigue funcionando con la base.
import type { PoolClient } from "pg";
import { nameKey } from "../curation/lexicon.js";

export interface LocalEvidence {
  source: string;
  title: string | null;
  url: string | null;
  artistName: string | null;
  capturedAt: string | null;
  snippet: string;
  score: number;
}

const SOURCE_PRIORITY = `CASE source
  WHEN 'rhv' THEN 0 WHEN 'rym' THEN 1 WHEN 'hippito' THEN 2
  WHEN 'discogs' THEN 3 WHEN 'musicbrainz' THEN 4 WHEN 'wikipedia' THEN 5
  WHEN 'lastfm' THEN 6 ELSE 9 END`;

function snippet(body: string, names: string[]): string {
  const text = body.replaceAll(/\s+/gu, " ").trim();
  if (text.length <= 700) return text;
  const lower = text.toLocaleLowerCase("es");
  const hit = names.map((name) => lower.indexOf(name.toLocaleLowerCase("es"))).find((index) => index >= 0) ?? -1;
  const start = hit >= 0 ? Math.max(0, hit - 180) : 0;
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 700)}${start + 700 < text.length ? "…" : ""}`;
}

export async function searchLocalEvidence(
  queryable: Pick<PoolClient, "query">, names: string[], limit = 5,
): Promise<LocalEvidence[]> {
  const clean = [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 1))];
  if (!clean.length) return [];
  const keys = [...new Set(clean.map((name) => nameKey(name)).filter((key) => key.length > 1))];
  const textQuery = clean.join(" ");
  try {
    const { rows } = await queryable.query<{
      source: string; title: string | null; url: string | null; artist_name: string | null;
      body: string; captured_at: string | null; score: number;
    }>(`
      SELECT source, title, url, artist_name, body, captured_at::text,
             ts_rank(to_tsvector('spanish', coalesce(artist_name,'') || ' ' || coalesce(title,'') || ' ' || body),
                     plainto_tsquery('spanish', $2)) AS score
        FROM ingest.local_evidence
       WHERE artist_key = ANY($1::text[])
          OR to_tsvector('spanish', coalesce(artist_name,'') || ' ' || coalesce(title,'') || ' ' || body)
             @@ plainto_tsquery('spanish', $2)
       ORDER BY (artist_key = ANY($1::text[])) DESC, ${SOURCE_PRIORITY}, captured_at DESC NULLS LAST, score DESC
       LIMIT $3`, [keys, textQuery, limit]);
    const seen = new Set<string>();
    return rows.filter((row) => {
      const hash = `${row.source}|${row.url ?? ""}|${row.body.slice(0, 200)}`;
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    }).map((row) => ({
      source: row.source, title: row.title, url: row.url, artistName: row.artist_name,
      capturedAt: row.captured_at, snippet: snippet(row.body, clean), score: Number(row.score ?? 0),
    }));
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
}
