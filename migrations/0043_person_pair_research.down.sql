BEGIN;
DROP TABLE IF EXISTS ingest.person_identity_research_jobs;
DROP INDEX IF EXISTS ingest.person_web_verifications_pair_b_idx;
DROP INDEX IF EXISTS ingest.person_web_verifications_pair_recent_idx;
DROP INDEX IF EXISTS ingest.person_web_verifications_pair_live_uk;
ALTER TABLE ingest.person_web_verifications DROP CONSTRAINT IF EXISTS person_web_verifications_subject_ck;
DELETE FROM ingest.person_web_verifications WHERE person_a_id IS NOT NULL;
ALTER TABLE ingest.person_web_verifications DROP COLUMN IF EXISTS person_a_id;
ALTER TABLE ingest.person_web_verifications DROP COLUMN IF EXISTS person_b_id;
ALTER TABLE ingest.person_web_verifications ADD CONSTRAINT person_web_verifications_subject_ck
  CHECK ((review_id IS NOT NULL) <> (person_id IS NOT NULL));
COMMIT;
