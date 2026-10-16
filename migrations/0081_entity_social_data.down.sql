-- ============================================================================
-- CRV · Migración 0081_entity_social_data (DOWN)
-- Quita las cuatro tablas de datos sociales (métricas de escucha, tags de
-- usuario, comentarios y emociones). Se pierde lo poblado (no viven en
-- ninguna otra columna; las cosechas de origen siguen en reports/ y son
-- re-aplicables).
-- ============================================================================

BEGIN;

DELETE FROM ingest.change_journal_tables
 WHERE table_name IN ('public.entity_metrics', 'public.entity_user_tags',
                      'public.entity_shouts', 'public.entity_emotions');
DROP TABLE IF EXISTS public.entity_emotions;
DROP TABLE IF EXISTS public.entity_shouts;
DROP TABLE IF EXISTS public.entity_user_tags;
DROP TABLE IF EXISTS public.entity_metrics;

COMMIT;
