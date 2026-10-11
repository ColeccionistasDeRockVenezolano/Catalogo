BEGIN;

-- Preserve complete evidence and decisions across feature rollback/reapply.
-- Remove external FKs while dormant so older auxiliary migrations can revert.
CREATE SCHEMA IF NOT EXISTS crv_evidence_archive;
DO $$ DECLARE name text; constraint_name text; BEGIN
  FOREACH name IN ARRAY ARRAY['evidence_documents','evidence_reads','evidence_fragments','catalog_facts','catalog_fact_evidence','catalog_fact_bindings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS crv_evidence_immutable ON ingest.%I',name);
    EXECUTE format('DROP TRIGGER IF EXISTS crv_journal ON ingest.%I',name);
  END LOOP;
  FOREACH constraint_name IN ARRAY ARRAY['catalog_fact_bindings_artist_fk','catalog_fact_bindings_person_fk','catalog_fact_bindings_organization_fk','catalog_fact_bindings_album_fk','catalog_fact_bindings_track_fk'] LOOP
    EXECUTE format('ALTER TABLE ingest.catalog_fact_bindings DROP CONSTRAINT IF EXISTS %I',constraint_name);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS crv_evidence_fragment_check ON ingest.evidence_fragments;
DROP TRIGGER IF EXISTS crv_fact_verified_check ON ingest.catalog_facts;
DROP TRIGGER IF EXISTS crv_fact_value_check ON ingest.catalog_facts;
DROP TRIGGER IF EXISTS crv_fact_binding_check ON ingest.catalog_fact_bindings;
DROP FUNCTION ingest.crv_evidence_immutable();
DROP FUNCTION ingest.crv_evidence_fragment_check();
DROP FUNCTION ingest.crv_fact_verified_check();
DROP FUNCTION ingest.crv_fact_value_check();
DROP FUNCTION ingest.crv_date_value_valid(jsonb);
DROP FUNCTION ingest.crv_fact_binding_check();
DELETE FROM ingest.change_journal_tables WHERE table_name='ingest.catalog_fact_bindings';

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['evidence_documents','evidence_reads','evidence_fragments','catalog_facts','catalog_fact_evidence','catalog_fact_bindings'] LOOP
    IF to_regclass('crv_evidence_archive.' || name) IS NOT NULL THEN
      RAISE EXCEPTION 'cannot overwrite archived evidence: %',name;
    END IF;
    EXECUTE format('ALTER TABLE ingest.%I SET SCHEMA crv_evidence_archive',name);
  END LOOP;
END $$;

COMMIT;
