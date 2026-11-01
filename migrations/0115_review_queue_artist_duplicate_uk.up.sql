-- ============================================================================
-- CRV · Migración 0115_review_queue_artist_duplicate_uk (UP)
-- Un solo careo vivo por par no ordenado de artistas.
--
-- POR QUÉ: el detector de candidatos de artista (`src/review/artist-candidates.ts`)
--   puede correr todos los días. Sin esta restricción, cada corrida abriría
--   otra revisión del mismo par y la cola de «Fichas repetidas» se llenaría de
--   propuestas idénticas. Con el índice parcial, proponer dos veces el mismo
--   par mientras la revisión sigue viva es un no-op (`ON CONFLICT DO NOTHING`).
--
-- ALCANCE: solo `possible_duplicate` con los dos lados de artista y en estado
--   vivo (open/in_progress). Los careos de disco y de persona que ya usan ese
--   mismo kind no tienen `artist_a_id` y quedan fuera del índice. Un par
--   descartado («son distintas», `dismissed`) no bloquea nada aquí: que no
--   vuelva a proponerse lo decide el detector al leer las revisiones cerradas.
--
-- REGLAS DE GOBIERNO: el schema `public` (core) NO se toca. Idempotente y
--   reversible.
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS review_queue_artist_duplicate_live_uk
  ON ingest.review_queue (LEAST(artist_a_id, artist_b_id), GREATEST(artist_a_id, artist_b_id))
  WHERE kind = 'possible_duplicate'
    AND status IN ('open', 'in_progress')
    AND artist_a_id IS NOT NULL
    AND artist_b_id IS NOT NULL;

COMMIT;
