BEGIN;
CREATE TABLE ingest.album_classification_decisions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 album_id BIGINT NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
 classification VARCHAR(60) NOT NULL,
 selected BOOLEAN NOT NULL,
 reason TEXT NOT NULL,
 run_id BIGINT REFERENCES ingest.scrape_runs(id),
 UNIQUE(album_id,classification)
);
CREATE VIEW ingest.effective_album_classifications AS
 SELECT c.id,c.album_id,c.classification,c.position,
 c.inferred AND NOT EXISTS(SELECT 1 FROM ingest.album_classification_decisions accepted WHERE accepted.album_id=c.album_id AND accepted.classification=c.classification AND accepted.selected) AS inferred,
 c.seed_upload_id,c.created_at FROM ingest.album_classifications c
 WHERE NOT EXISTS(SELECT 1 FROM ingest.album_classification_decisions d WHERE d.album_id=c.album_id AND d.classification=c.classification AND NOT d.selected);
CREATE TABLE ingest.video_track_decisions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 video_id BIGINT NOT NULL REFERENCES media.youtube_videos(id) ON DELETE CASCADE,
 track_id BIGINT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
 original_start INTEGER NOT NULL CHECK(original_start>=0),
 start_seconds INTEGER NOT NULL CHECK(start_seconds>=0),
 end_seconds INTEGER CHECK(end_seconds>start_seconds),
 suppressed BOOLEAN NOT NULL DEFAULT false,
 reason TEXT NOT NULL,
 run_id BIGINT REFERENCES ingest.scrape_runs(id),
 UNIQUE(video_id,track_id,original_start)
);
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES
 ('ingest.album_classification_decisions','full','strict'),('ingest.video_track_decisions','full','strict');
SELECT ingest.crv_journal_attach_all();
-- Hace editable el sello que antes existía solo como respaldo del core.
INSERT INTO ingest.album_labels(album_id,organization_id,role,notes)
 SELECT a.id,a.label_id,'label','Sello conservado del registro general al conectar el editor'
 FROM public.albums a WHERE a.label_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM ingest.album_labels l LEFT JOIN ingest.album_versions v ON v.id=l.version_id
    WHERE l.album_id=a.id AND (l.version_id IS NULL OR v.is_primary));
COMMIT;
