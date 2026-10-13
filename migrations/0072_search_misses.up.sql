-- CRV · Búsquedas sin resultados (2026-10-13).
-- Conteo agregado de lo que el público busca y no encuentra, para descubrir
-- siglas, apodos y grafías que faltan como alias. Sin IP, sin usuario y sin
-- hora exacta por búsqueda: solo la consulta normalizada, un ejemplo tal como
-- se escribió y cuántas veces falló. La API lo vuelca por lotes (tope de
-- claves por lote) y poda lo que lleva 180 días sin repetirse.
BEGIN;
CREATE TABLE ingest.search_misses (
  normalized_query TEXT PRIMARY KEY CHECK (length(normalized_query) BETWEEN 1 AND 100),
  sample_query TEXT NOT NULL CHECK (length(sample_query) BETWEEN 1 AND 100),
  misses INTEGER NOT NULL CHECK (misses > 0),
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX search_misses_last_seen_idx ON ingest.search_misses (last_seen);
COMMIT;
