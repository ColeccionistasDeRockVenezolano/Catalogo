BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ingest.artist_editorial_admissions) THEN RAISE EXCEPTION 'Hay proyectos admitidos: conservar las decisiones editoriales.'; END IF;
END $$;
DROP TRIGGER crv_protect_editorial_admission ON ingest.artist_editorial_policy;
DROP FUNCTION ingest.protect_editorial_admission();
DELETE FROM ingest.change_journal_tables WHERE table_name='ingest.artist_editorial_admissions';
DROP TABLE ingest.artist_editorial_admissions;
COMMIT;
