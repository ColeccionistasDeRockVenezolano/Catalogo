-- Immutable capture/annotation staging. Editorial authority stays in review_queue
-- and existing assignment tables; this migration never writes public.*.
CREATE TABLE ingest.search_knowledge_jobs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_key text NOT NULL UNIQUE,
 resource_id text NOT NULL CHECK(resource_id ~ '^R(0[1-9]|[1-3][0-9]|4[0-4])$' AND resource_id <> 'R16'),
 source_object text NOT NULL, capture_hash char(64) NOT NULL CHECK(capture_hash ~ '^[0-9a-f]{64}$'),
 extractor_version text NOT NULL, schema_version text NOT NULL,
 input jsonb NOT NULL, cursor integer NOT NULL DEFAULT 0 CHECK(cursor>=0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','review','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((state='running') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 UNIQUE(resource_id,source_object,capture_hash,extractor_version,schema_version)
);
CREATE INDEX search_knowledge_jobs_work ON ingest.search_knowledge_jobs(next_attempt_at,id) WHERE state IN ('pending','running');
CREATE TABLE ingest.search_knowledge_units (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_id bigint NOT NULL REFERENCES ingest.search_knowledge_jobs(id) ON DELETE RESTRICT,
 unit_key text NOT NULL UNIQUE, annotation jsonb NOT NULL,
 review_id bigint NOT NULL REFERENCES ingest.review_queue(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_knowledge_units_job ON ingest.search_knowledge_units(job_id);
CREATE INDEX search_knowledge_units_review ON ingest.search_knowledge_units(review_id);

CREATE UNIQUE INDEX search_knowledge_review_key ON ingest.review_queue ((payload->>'caseKey')) WHERE payload->>'type'='search_knowledge';
