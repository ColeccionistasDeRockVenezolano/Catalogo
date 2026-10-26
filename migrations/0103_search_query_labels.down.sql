BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ingest.search_query_labels) THEN
  RAISE EXCEPTION 'Hay etiquetas humanas registradas; el rollback las perdería';
 END IF;
END $$;
DROP TABLE ingest.search_query_labels;
COMMIT;
