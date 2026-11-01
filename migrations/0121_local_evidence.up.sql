-- 0121 · Evidencia local del almacén de 1 TB para la IA del catálogo.
--
-- Guarda fragmentos citables de capturas propias (RHV, RYM, Hippito, Discogs,
-- Last.fm, Wikipedia, etc.). No es el archivo completo: el indexador recorta el
-- texto y conserva fuente, URL, artista y fecha para que el veredicto cite.
CREATE TABLE ingest.local_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  source_path text NOT NULL,
  artist_name text,
  artist_key text,
  title text,
  url text,
  body text NOT NULL,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_path, artist_key, url)
);
CREATE INDEX local_evidence_artist_idx
  ON ingest.local_evidence(artist_key);
CREATE INDEX local_evidence_search_idx
  ON ingest.local_evidence
  USING gin (to_tsvector('spanish', coalesce(artist_name,'') || ' ' || coalesce(title,'') || ' ' || body));
