BEGIN;
-- Captured originals remain on disk; export capture/extraction metadata before downgrade.
ALTER TABLE ingest.person_web_page_cache DROP COLUMN document_metadata;
ALTER TABLE ingest.evidence_documents DROP COLUMN extraction_metadata,DROP COLUMN raw_capture_id;
DROP TABLE ingest.research_source_captures;
COMMIT;
