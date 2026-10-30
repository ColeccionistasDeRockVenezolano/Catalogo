-- 0122 · Alta asistida de videos del canal (espacio «Videos de YouTube»).
--
-- Cada video del canal que necesita trabajo editorial tiene aquí su ancla:
-- los datos leídos del título/descripción, el artista resuelto, el plan de IA
-- que prepara el alta y la revisión de ingesta asociada. El plan de IA sigue
-- anclado a la ficha del artista (ingest.ai_curation_plans): esta tabla es el
-- estado del video, no una segunda cola de propuestas.

CREATE TABLE IF NOT EXISTS ingest.youtube_intake (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  video_id      bigint NOT NULL REFERENCES media.youtube_videos(id) ON DELETE CASCADE,
  status        varchar(20) NOT NULL DEFAULT 'pending',
  artist_name   text,
  album_title   text,
  release_year  smallint,
  album_type    varchar(20),
  track_count   integer NOT NULL DEFAULT 0,
  credit_count  integer NOT NULL DEFAULT 0,
  artist_id     bigint REFERENCES public.artists(id) ON DELETE SET NULL,
  plan_id       bigint REFERENCES ingest.ai_curation_plans(id) ON DELETE SET NULL,
  review_id     bigint REFERENCES ingest.review_queue(id) ON DELETE SET NULL,
  reason        text,
  error         text,
  attempts      integer NOT NULL DEFAULT 0,
  decided_by    varchar(120),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT youtube_intake_video_uk UNIQUE (video_id),
  CONSTRAINT youtube_intake_status_chk CHECK (status IN
    ('pending','planning','ready','linked','review','failed','skipped'))
);

CREATE INDEX IF NOT EXISTS youtube_intake_status_idx ON ingest.youtube_intake(status);
CREATE INDEX IF NOT EXISTS youtube_intake_artist_idx ON ingest.youtube_intake(artist_id);
CREATE INDEX IF NOT EXISTS youtube_intake_plan_idx ON ingest.youtube_intake(plan_id);
