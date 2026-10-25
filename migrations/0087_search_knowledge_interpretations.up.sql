-- Comparable model proposals only; the existing review queue remains authoritative.
CREATE TABLE ingest.search_knowledge_interpretations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 unit_id bigint NOT NULL REFERENCES ingest.search_knowledge_units(id) ON DELETE CASCADE,
 model text NOT NULL CHECK(length(trim(model))>0),
 model_revision text NOT NULL CHECK(length(trim(model_revision))>0),
 sdk_version text NOT NULL CHECK(length(trim(sdk_version))>0),
 question_version text NOT NULL CHECK(length(trim(question_version))>0),
 question_hash char(64) NOT NULL CHECK(question_hash ~ '^[a-f0-9]{64}$'),
 input_hash char(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 decisions jsonb NOT NULL CHECK(jsonb_typeof(decisions)='object'),
 routing jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(unit_id,model,model_revision,sdk_version,question_version,question_hash,input_hash)
);
CREATE INDEX search_knowledge_interpretations_unit ON ingest.search_knowledge_interpretations(unit_id,id);

CREATE UNIQUE INDEX search_knowledge_model_conflict_key ON ingest.review_queue ((payload->>'caseKey')) WHERE payload->>'type'='search_knowledge_model_conflict';
