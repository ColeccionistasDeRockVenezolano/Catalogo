BEGIN;
CREATE TABLE media.artist_gallery (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL CHECK (length(trim(image_url)) > 0),
  category TEXT NOT NULL DEFAULT 'artist' CHECK (category IN ('artist','concert','poster','related')),
  title TEXT,
  description TEXT,
  photo_date DATE,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX artist_gallery_artist_idx ON media.artist_gallery(artist_id, id);
COMMENT ON TABLE media.artist_gallery IS 'Fotografías, conciertos, pósters e imágenes relacionadas. Metadatos editoriales opcionales; cambios auditados y reversibles.';
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES ('media.artist_gallery','full','strict');
SELECT ingest.crv_journal_attach('media.artist_gallery'::regclass,'full');
COMMIT;
