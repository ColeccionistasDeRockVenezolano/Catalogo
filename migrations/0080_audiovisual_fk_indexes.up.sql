BEGIN;
CREATE INDEX artist_audiovisuals_video_idx ON media.artist_audiovisuals(video_id) WHERE video_id IS NOT NULL;
CREATE INDEX artist_audiovisuals_seed_idx ON media.artist_audiovisuals(seed_upload_id) WHERE seed_upload_id IS NOT NULL;
COMMIT;
