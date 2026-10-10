BEGIN;
ALTER TABLE ingest.person_web_verifications ALTER COLUMN review_id DROP NOT NULL;
ALTER TABLE ingest.person_web_verifications ADD COLUMN person_id BIGINT REFERENCES public.persons(id) ON DELETE CASCADE;
ALTER TABLE ingest.person_web_verifications ADD CONSTRAINT person_web_verifications_subject_ck
  CHECK ((review_id IS NOT NULL) <> (person_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS person_web_verifications_person_live_uk
  ON ingest.person_web_verifications(person_id) WHERE person_id IS NOT NULL AND status='proposed';
COMMIT;
