BEGIN;
DROP TABLE media.artist_documents;
DELETE FROM ingest.change_journal_tables WHERE table_name='media.artist_documents';
DROP INDEX media.artist_gallery_source_idx;
ALTER TABLE media.artist_gallery DROP CONSTRAINT artist_gallery_category_check;
UPDATE media.artist_gallery SET category='related' WHERE category='logo';
ALTER TABLE media.artist_gallery ADD CONSTRAINT artist_gallery_category_check CHECK(category IN ('artist','concert','poster','related'));
ALTER TABLE media.artist_gallery DROP COLUMN source_key,DROP COLUMN source_url,DROP COLUMN tags,DROP COLUMN metadata;
COMMIT;
