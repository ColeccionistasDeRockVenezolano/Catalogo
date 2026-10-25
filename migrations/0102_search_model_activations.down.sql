BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ingest.search_model_activations) THEN
  RAISE EXCEPTION 'Hay activaciones registradas; el rollback perdería la atribución de modelos';
 END IF;
END $$;
DROP VIEW ingest.search_model_active;
DROP TABLE ingest.search_model_activations;
DROP FUNCTION ingest.crv_search_model_activations_append_only();
COMMIT;
