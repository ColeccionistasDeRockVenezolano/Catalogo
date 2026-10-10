BEGIN;
CREATE TABLE ingest.entity_verification_research_state (
 entity_kind TEXT NOT NULL CHECK(entity_kind IN ('artist','person','album')),
 entity_id BIGINT NOT NULL,
 snapshot_hash TEXT NOT NULL,
 state JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(entity_kind,entity_id)
);
COMMIT;
