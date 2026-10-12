BEGIN;
CREATE TABLE ingest.research_source_captures (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 capture_key TEXT NOT NULL UNIQUE,
 url TEXT NOT NULL,final_url TEXT NOT NULL,
 raw_hash CHAR(64) NOT NULL CHECK(raw_hash ~ '^[0-9a-f]{64}$'),
 stored_path TEXT NOT NULL,content_type TEXT NOT NULL,byte_size BIGINT NOT NULL CHECK(byte_size>=0),
 captured_at TIMESTAMPTZ,
 acquisition_method TEXT NOT NULL CHECK(acquisition_method IN ('http','raw_archive','local_archive','rendered')),
 http_status INTEGER,
 acquisition_complete BOOLEAN NOT NULL,reason TEXT,
 parent_capture_id BIGINT REFERENCES ingest.research_source_captures(id),
 extraction JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX research_source_captures_url ON ingest.research_source_captures(url,id DESC);
CREATE INDEX research_source_captures_parent ON ingest.research_source_captures(parent_capture_id);
ALTER TABLE ingest.evidence_documents ADD COLUMN raw_capture_id BIGINT REFERENCES ingest.research_source_captures(id),ADD COLUMN extraction_metadata JSONB;
CREATE INDEX evidence_documents_raw_capture ON ingest.evidence_documents(raw_capture_id);
ALTER TABLE ingest.person_web_page_cache ADD COLUMN document_metadata JSONB;
COMMIT;
