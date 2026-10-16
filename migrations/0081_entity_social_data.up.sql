-- ============================================================================
-- CRV · Migración 0081_entity_social_data (UP)
-- Métricas de escucha, tags de usuario, comentarios y emociones por entidad
-- (artista / álbum / pista) — campaña Last.fm 2026-10-16.
-- Brian, 2026-10-16: «quiero que modifiques el core y vincules estas métricas
-- con artistas/albums/pistas y que se actualicen semanalmente. Me interesan los
-- tags de usuario y quiero las opiniones de la gente porque puedo hacer una
-- clasificación de emociones por música con laya… así cuando se busque algo
-- como "música para tener sexo" hay categorización buena».
-- **Décima excepción aprobada al core**: cuatro tablas nuevas en `public`.
--
--   * entity_metrics   — FOTO de las métricas de escucha (oyentes/scrobbles)
--                        con fecha de captura: el histórico se conserva y
--                        nunca se pisa (refresco semanal por timer; la
--                        consulta «actual» toma la captura más reciente por
--                        entidad y fuente).
--   * entity_user_tags — folksonomía cruda de Last.fm (tag + peso) tal cual la
--                        escriben los usuarios, SIN filtrar por vocabulario:
--                        la interpretación vive en `emotions` (jsonb, Laya).
--   * entity_shouts    — comentarios de usuarios (autor, fecha, texto, URL),
--                        deduplicados por `fingerprint`.
--   * entity_emotions  — agregado clasificado por entidad (emoción + score +
--                        base + detalle): lo que consulta la búsqueda
--                        («música para tener sexo» → emoción «cachonda»).
--
-- Exactamente UNO de artist_id / album_id / track_id por fila; los datos se van
-- con la ficha (ON DELETE CASCADE, como streaming_links). Vocabularios:
-- `source` ('lastfm', …) y `basis` ('tags'|'shouts'|'wiki'|'combined'). La
-- columna `emotion` NO lleva CHECK a propósito: la taxonomía la fija el
-- propietario (no_expresa_emocion · emocion · tristeza · enfocado · libertad ·
-- cachonda · aumenta_mi_aura) y evoluciona con el modelo de clasificación;
-- `model_version` por fila permite re-clasificar sin perder la anterior.
--
-- REGLAS DE GOBIERNO: en el diario (0028, `soft`) para que deshacer el run que
-- los escribió los retire. El diff de `public` (tests/run_all.sh,
-- core-and-schema) y la huella de `crv doctor` (APPROVED_CORE_ADDITIONS)
-- aceptan solo estas cuatro tablas.
-- ============================================================================

BEGIN;
SET LOCAL crv.journal = 'off';

CREATE TABLE IF NOT EXISTS public.entity_metrics (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_id   BIGINT REFERENCES public.artists(id) ON DELETE CASCADE,
  album_id    BIGINT REFERENCES public.albums(id) ON DELETE CASCADE,
  track_id    BIGINT REFERENCES public.tracks(id) ON DELETE CASCADE,
  source      VARCHAR(24) NOT NULL,
  listeners   BIGINT,
  playcount   BIGINT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entity_metrics_entity_ck CHECK (num_nonnulls(artist_id, album_id, track_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_metrics_artist_uk ON public.entity_metrics (artist_id, source, captured_at) WHERE artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_metrics_album_uk ON public.entity_metrics (album_id, source, captured_at) WHERE album_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_metrics_track_uk ON public.entity_metrics (track_id, source, captured_at) WHERE track_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.entity_user_tags (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_id   BIGINT REFERENCES public.artists(id) ON DELETE CASCADE,
  album_id    BIGINT REFERENCES public.albums(id) ON DELETE CASCADE,
  track_id    BIGINT REFERENCES public.tracks(id) ON DELETE CASCADE,
  source      VARCHAR(24) NOT NULL,
  tag         VARCHAR(250) NOT NULL,
  weight      INTEGER NOT NULL DEFAULT 0,
  emotions    JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entity_user_tags_entity_ck CHECK (num_nonnulls(artist_id, album_id, track_id) = 1),
  CONSTRAINT entity_user_tags_tag_ck CHECK (length(btrim(tag)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_user_tags_artist_uk ON public.entity_user_tags (artist_id, source, tag) WHERE artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_user_tags_album_uk ON public.entity_user_tags (album_id, source, tag) WHERE album_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_user_tags_track_uk ON public.entity_user_tags (track_id, source, tag) WHERE track_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.entity_shouts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_id   BIGINT REFERENCES public.artists(id) ON DELETE CASCADE,
  album_id    BIGINT REFERENCES public.albums(id) ON DELETE CASCADE,
  track_id    BIGINT REFERENCES public.tracks(id) ON DELETE CASCADE,
  source      VARCHAR(24) NOT NULL,
  author      VARCHAR(120) NOT NULL,
  posted_text VARCHAR(80),
  posted_at   TIMESTAMPTZ,
  text        TEXT NOT NULL,
  url         TEXT NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  emotions    JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entity_shouts_entity_ck CHECK (num_nonnulls(artist_id, album_id, track_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_shouts_artist_uk ON public.entity_shouts (artist_id, fingerprint) WHERE artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_shouts_album_uk ON public.entity_shouts (album_id, fingerprint) WHERE album_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_shouts_track_uk ON public.entity_shouts (track_id, fingerprint) WHERE track_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.entity_emotions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_id     BIGINT REFERENCES public.artists(id) ON DELETE CASCADE,
  album_id      BIGINT REFERENCES public.albums(id) ON DELETE CASCADE,
  track_id      BIGINT REFERENCES public.tracks(id) ON DELETE CASCADE,
  emotion       VARCHAR(24) NOT NULL,
  score         REAL NOT NULL DEFAULT 0,
  basis         VARCHAR(16) NOT NULL,
  evidence      INTEGER NOT NULL DEFAULT 0,
  detail        JSONB,
  model_version VARCHAR(40),
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entity_emotions_entity_ck CHECK (num_nonnulls(artist_id, album_id, track_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_emotions_artist_uk ON public.entity_emotions (artist_id, emotion, basis) WHERE artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_emotions_album_uk ON public.entity_emotions (album_id, emotion, basis) WHERE album_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entity_emotions_track_uk ON public.entity_emotions (track_id, emotion, basis) WHERE track_id IS NOT NULL;

INSERT INTO ingest.change_journal_tables(table_name, mode, policy)
VALUES ('public.entity_metrics', 'full', 'soft'),
       ('public.entity_user_tags', 'full', 'soft'),
       ('public.entity_shouts', 'full', 'soft'),
       ('public.entity_emotions', 'full', 'soft')
ON CONFLICT (table_name) DO NOTHING;
SELECT ingest.crv_journal_attach_all();

COMMIT;
