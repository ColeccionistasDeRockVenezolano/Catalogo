BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.launch_contacts) THEN
    RAISE EXCEPTION 'Hay inscripciones de lanzamiento: conservarlas antes de retirar la tabla.';
  END IF;
END $$;
DROP TABLE auth.launch_contacts;
COMMIT;
