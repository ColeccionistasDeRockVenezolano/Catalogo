BEGIN;
SET LOCAL crv.journal = 'off';
DELETE FROM ingest.change_journal_tables WHERE table_name='ingest.lastfm_artist_verifications';
DROP TABLE IF EXISTS ingest.lastfm_artist_verifications;
COMMIT;
