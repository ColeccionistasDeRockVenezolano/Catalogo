-- Review cases are audit history and deliberately survive removal of staging.
DROP INDEX ingest.search_knowledge_review_key;
DROP TABLE ingest.search_knowledge_units;
DROP TABLE ingest.search_knowledge_jobs;
