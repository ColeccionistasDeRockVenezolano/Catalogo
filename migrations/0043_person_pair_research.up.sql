BEGIN;

ALTER TABLE ingest.person_web_verifications
  ADD COLUMN person_a_id BIGINT REFERENCES public.persons(id) ON DELETE CASCADE,
  ADD COLUMN person_b_id BIGINT REFERENCES public.persons(id) ON DELETE CASCADE;
ALTER TABLE ingest.person_web_verifications DROP CONSTRAINT person_web_verifications_subject_ck;
ALTER TABLE ingest.person_web_verifications ADD CONSTRAINT person_web_verifications_subject_ck CHECK (
  (review_id IS NOT NULL AND person_id IS NULL AND person_a_id IS NULL AND person_b_id IS NULL)
  OR (review_id IS NULL AND person_id IS NOT NULL AND person_a_id IS NULL AND person_b_id IS NULL)
  OR (review_id IS NULL AND person_id IS NULL AND person_a_id IS NOT NULL AND person_b_id IS NOT NULL AND person_a_id < person_b_id)
);
CREATE UNIQUE INDEX person_web_verifications_pair_live_uk
  ON ingest.person_web_verifications(person_a_id, person_b_id)
  WHERE person_a_id IS NOT NULL AND status='proposed';
CREATE INDEX person_web_verifications_pair_recent_idx
  ON ingest.person_web_verifications(person_a_id, person_b_id, created_at DESC)
  WHERE person_a_id IS NOT NULL;
CREATE INDEX person_web_verifications_pair_b_idx
  ON ingest.person_web_verifications(person_b_id, created_at DESC)
  WHERE person_b_id IS NOT NULL;

CREATE TABLE ingest.person_identity_research_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_a_id BIGINT NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  person_b_id BIGINT NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  error TEXT,
  verification_id BIGINT REFERENCES ingest.person_web_verifications(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  CONSTRAINT person_identity_research_job_pair_ck CHECK (person_a_id < person_b_id)
);
CREATE UNIQUE INDEX person_identity_research_job_active_uk
  ON ingest.person_identity_research_jobs(person_a_id, person_b_id)
  WHERE status IN ('queued','running');

COMMIT;
