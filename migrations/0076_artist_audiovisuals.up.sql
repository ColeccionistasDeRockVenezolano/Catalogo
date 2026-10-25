BEGIN;
CREATE TABLE media.artist_audiovisuals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  video_id BIGINT REFERENCES media.youtube_videos(id) ON DELETE SET NULL,
  seed_upload_id BIGINT REFERENCES ingest.seed_uploads(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  title_key TEXT NOT NULL,
  release_year SMALLINT,
  kind TEXT NOT NULL CHECK (kind IN ('documentary','live_concert','music_video','interview','short','other')),
  description TEXT,
  source_type TEXT,
  allows_music_release BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artist_id, source_key)
);
CREATE UNIQUE INDEX artist_audiovisuals_video_uk ON media.artist_audiovisuals(artist_id,video_id) WHERE video_id IS NOT NULL;
CREATE INDEX artist_audiovisuals_title_idx ON media.artist_audiovisuals(artist_id,title_key);
COMMENT ON TABLE media.artist_audiovisuals IS 'Obras audiovisuales del artista, separadas de los discos. La obra se conserva aunque no haya video disponible. Gasolina / Blues Criollo permanece como disco por decisión de Brian.';
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES ('media.artist_audiovisuals','full','strict');
SELECT ingest.crv_journal_attach('media.artist_audiovisuals'::regclass,'full');
COMMIT;
