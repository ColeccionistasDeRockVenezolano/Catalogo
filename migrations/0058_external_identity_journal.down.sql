BEGIN;

DROP TRIGGER IF EXISTS crv_journal ON ingest.genre_external_identities;
DELETE FROM ingest.change_journal_tables WHERE table_name='ingest.genre_external_identities';
-- Keep historical entries: reversing schema does not erase editorial evidence.

COMMIT;
