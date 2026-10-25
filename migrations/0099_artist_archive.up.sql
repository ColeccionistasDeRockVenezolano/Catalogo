BEGIN;
CREATE TABLE media.artist_documents (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 artist_id bigint NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
 source_key text NOT NULL,
 category text NOT NULL CHECK(category IN ('interview','article','review','news','event','biography','discography','playlist','other')),
 title text NOT NULL CHECK(length(trim(title))>0),
 content text NOT NULL,
 source_url text,
 archive_url text,
 date_text text,
 location text,
 tags text[] NOT NULL DEFAULT '{}',
 metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(artist_id,source_key)
);
CREATE INDEX artist_documents_artist_idx ON media.artist_documents(artist_id,category,id);
CREATE INDEX artist_documents_tags_idx ON media.artist_documents USING gin(tags);
ALTER TABLE media.artist_gallery ADD COLUMN source_key text,ADD COLUMN source_url text,
 ADD COLUMN tags text[] NOT NULL DEFAULT '{}',ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX artist_gallery_source_idx ON media.artist_gallery(artist_id,source_key) WHERE source_key IS NOT NULL;
ALTER TABLE media.artist_gallery DROP CONSTRAINT artist_gallery_category_check;
ALTER TABLE media.artist_gallery ADD CONSTRAINT artist_gallery_category_check CHECK(category IN ('artist','concert','poster','related','logo'));
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES('media.artist_documents','full','strict');
SELECT ingest.crv_journal_attach('media.artist_documents'::regclass,'full');
COMMIT;
