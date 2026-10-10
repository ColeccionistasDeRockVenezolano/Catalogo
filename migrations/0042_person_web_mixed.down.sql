BEGIN;
DROP INDEX IF EXISTS ingest.person_web_verifications_person_live_uk;
DELETE FROM ingest.person_web_verifications WHERE person_id IS NOT NULL;
ALTER TABLE ingest.person_web_verifications DROP CONSTRAINT IF EXISTS person_web_verifications_subject_ck;
ALTER TABLE ingest.person_web_verifications DROP COLUMN IF EXISTS person_id;
ALTER TABLE ingest.person_web_verifications ALTER COLUMN review_id SET NOT NULL;
COMMIT;
