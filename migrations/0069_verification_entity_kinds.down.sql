BEGIN;
-- A rollback must never delete investigations to satisfy an older constraint.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ingest.entity_verification_reports WHERE entity_kind IN ('organization','track'))
 OR EXISTS(SELECT 1 FROM ingest.entity_verification_jobs WHERE entity_kind IN ('organization','track'))
 OR EXISTS(SELECT 1 FROM ingest.entity_verification_research_state WHERE entity_kind IN ('organization','track'))
 OR EXISTS(SELECT 1 FROM ingest.entity_verification_research_versions WHERE entity_kind IN ('organization','track'))
 THEN RAISE EXCEPTION 'Rollback 0069 requires preserving organization/track research outside the older schema first'; END IF;
END $$;
ALTER TABLE ingest.entity_verification_reports DROP CONSTRAINT entity_verification_reports_entity_kind_check;
ALTER TABLE ingest.entity_verification_reports ADD CONSTRAINT entity_verification_reports_entity_kind_check CHECK(entity_kind IN ('artist','person','album'));
ALTER TABLE ingest.entity_verification_jobs DROP CONSTRAINT entity_verification_jobs_entity_kind_check;
ALTER TABLE ingest.entity_verification_jobs ADD CONSTRAINT entity_verification_jobs_entity_kind_check CHECK(entity_kind IN ('artist','person','album'));
ALTER TABLE ingest.entity_verification_research_state DROP CONSTRAINT entity_verification_research_state_entity_kind_check;
ALTER TABLE ingest.entity_verification_research_state ADD CONSTRAINT entity_verification_research_state_entity_kind_check CHECK(entity_kind IN ('artist','person','album'));
ALTER TABLE ingest.entity_verification_research_versions DROP CONSTRAINT entity_verification_research_versions_entity_kind_check;
ALTER TABLE ingest.entity_verification_research_versions ADD CONSTRAINT entity_verification_research_versions_entity_kind_check CHECK(entity_kind IN ('artist','person','album'));
COMMIT;
