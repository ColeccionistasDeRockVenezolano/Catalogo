BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ingest.image_curation_jobs WHERE status IN ('queued','running')) THEN
    RAISE EXCEPTION 'No se puede retirar la cola de imágenes mientras hay tareas pendientes';
  END IF;
END $$;
DROP TABLE ingest.image_curation_jobs;
COMMIT;
