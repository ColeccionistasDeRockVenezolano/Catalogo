-- ============================================================================
-- CRV · Migración 0063_album_discs (DOWN)
-- Quita los nombres y los enlaces de cada disco. Las pistas conservan su
-- `disc_number`; se pierden los nombres («Lado A», «DVD»…) y los enlaces de
-- escucha por disco, que no viven en otra tabla.
-- ============================================================================

BEGIN;

DELETE FROM ingest.change_journal_tables WHERE table_name IN ('public.album_discs', 'public.album_disc_links');
DROP TABLE IF EXISTS public.album_disc_links;
DROP TABLE IF EXISTS public.album_discs;

COMMIT;
