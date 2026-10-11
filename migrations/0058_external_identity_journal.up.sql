BEGIN;

-- Resolved identities are editorial state: history undo must conserve them.
INSERT INTO ingest.change_journal_tables(table_name, mode, policy)
VALUES ('ingest.genre_external_identities', 'full', 'strict')
ON CONFLICT (table_name) DO UPDATE SET mode=EXCLUDED.mode, policy=EXCLUDED.policy;
SELECT ingest.crv_journal_attach('ingest.genre_external_identities'::regclass, 'full');

COMMIT;
