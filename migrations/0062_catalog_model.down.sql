BEGIN;
-- Keep all model rows, sequences and internal FKs for a lossless reapply.
DO $$ DECLARE n text; c record; BEGIN
 FOREACH n IN ARRAY ARRAY['support_tracks','scoped_genres','musical_identities','edition_support_details','catalog_edition_details','catalog_works'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS crv_journal ON ingest.%I',n);
  EXECUTE format('DROP TRIGGER IF EXISTS crv_catalog_model_check ON ingest.%I',n);
  DELETE FROM ingest.change_journal_tables WHERE table_name='ingest.'||n;
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid=('ingest.'||n)::regclass AND
      ((contype='f' AND confrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace OR oid='ingest.genres'::regclass))
       OR (contype='c' AND pg_get_constraintdef(oid) LIKE '%crv_date_value_valid%')) LOOP
    EXECUTE format('ALTER TABLE ingest.%I DROP CONSTRAINT %I',n,c.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE ingest.%I SET SCHEMA crv_evidence_archive',n);
 END LOOP;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['public.albums','public.album_formats','public.tracks','crv_evidence_archive.catalog_works'] LOOP
  EXECUTE format('DROP TRIGGER crv_catalog_model_parent_check ON %s',t);
 END LOOP;
END $$;
DROP FUNCTION ingest.crv_catalog_model_parent_check();
DROP FUNCTION ingest.crv_catalog_model_check();
COMMIT;
