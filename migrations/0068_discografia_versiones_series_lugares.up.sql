-- ============================================================================
-- CRV · Migración 0068_discografia_versiones_series_lugares (UP)
-- Plan del primo, etapa 2 (2026-10-12): modelo discográfico y presentación.
-- Decisión de Brian: el álbum es la OBRA (la página) y sus versiones viven
-- dentro; el modelo 0062 (`catalog_works`, `catalog_edition_details`) no se usa
-- para esto. Todo va en `ingest`: el core `public` no se toca.
--
--   * `album_versions`        — versiones de un disco (punto 9): formato y su
--                               descripción («CD, Album, Promo, Cardboard
--                               Sleeve»), n.º de catálogo, país, año o fecha
--                               parcial, portada, notas, «pistas distintas» y
--                               qué discos de la página son suyos.
--   * `album_labels`          — rol de cada sello en el disco o en una versión
--                               (punto 7): sello, distribuidor o licenciatario.
--                               Sustituye en pantalla al único `albums.label_id`
--                               (que sigue siendo el sello principal).
--   * `organization_relations` — sucesión entre organizaciones (Sonorodven →
--                               Rodven → Líderes), con años y SIEMPRE con fuente.
--   * `series` + `series_albums` — series con su número de volumen (punto 13).
--   * `places` + `place_aliases` + `organization_places` — página de lugar
--                               (punto 8): ciudad/región/país con sus variantes
--                               de escritura como alias; estudios ligados a su
--                               lugar.
--   * `credit_statements` + `credit_statement_parts` — créditos en frase del
--                               canal (punto 8): la línea completa y sus partes
--                               enlazadas (rol, persona, estudio, año, lugar).
--   * `membership_details`    — marca de fundador e instrumentos normalizados
--                               por membresía (punto 11), ligada a
--                               `artist_members.id` para no tocar el núcleo.
--
-- Sin CHECK «a ≠ b» en las relaciones a propósito (como 0035): si un día se
-- fusionan dos fichas, la fusión reapunta la FK y no debe fallar.
-- REGLAS DE GOBIERNO: en el diario (0028) para que deshacer el run que las
-- escribió las retire. Cada FK lleva su índice (0013).
-- ============================================================================

BEGIN;
SET LOCAL crv.journal = 'off';

-- ── Versiones (punto 9) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingest.album_versions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  album_id        BIGINT      NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  position        SMALLINT    NOT NULL DEFAULT 1,
  -- «Edición original», «Reedición CD», «Super Deluxe Vinyl Edition».
  title           TEXT,
  format          VARCHAR(60),
  format_details  TEXT,
  catalog_number  VARCHAR(120),
  country         VARCHAR(120),
  release_year    SMALLINT,
  release_date    JSONB,
  cover_url       TEXT,
  notes           TEXT,
  -- La versión trae una lista de pistas distinta de la de la obra.
  distinct_tracks BOOLEAN     NOT NULL DEFAULT false,
  -- Discos (`tracks.disc_number`) de la página que pertenecen a esta versión.
  disc_numbers    SMALLINT[]  NOT NULL DEFAULT '{}',
  is_primary      BOOLEAN     NOT NULL DEFAULT false,
  -- De dónde salió: 'albums' (la versión inicial), 'run-18980', 'operador'…
  source          VARCHAR(60) NOT NULL,
  source_ref      TEXT,
  run_id          BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT album_versions_year_chk CHECK (release_year IS NULL OR release_year BETWEEN 1890 AND 2100),
  -- release_date usa el formato de crv_date_value_valid (0060), pero sin CHECK: así el down de 0060
  -- puede borrar la función sin chocar con esta tabla. Lo validan los scripts que escriben aquí.
  CONSTRAINT album_versions_position_chk CHECK (position BETWEEN 1 AND 999)
);
CREATE INDEX IF NOT EXISTS album_versions_album_idx ON ingest.album_versions (album_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS album_versions_primary_uk ON ingest.album_versions (album_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS album_versions_run_idx ON ingest.album_versions (run_id) WHERE run_id IS NOT NULL;

-- ── Sellos con rol (punto 7) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingest.album_labels (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  album_id        BIGINT      NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  version_id      BIGINT      REFERENCES ingest.album_versions(id) ON DELETE CASCADE,
  organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            VARCHAR(16) NOT NULL,
  position        SMALLINT    NOT NULL DEFAULT 1,
  -- Cómo lo escribió la fuente («PolyGram/Rodven»): el compuesto no se pierde.
  source_text     TEXT,
  notes           TEXT,
  run_id          BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT album_labels_role_chk CHECK (role IN ('label', 'distributor', 'licensee'))
);
CREATE INDEX IF NOT EXISTS album_labels_album_idx ON ingest.album_labels (album_id, position);
CREATE INDEX IF NOT EXISTS album_labels_version_idx ON ingest.album_labels (version_id) WHERE version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS album_labels_org_idx ON ingest.album_labels (organization_id);
CREATE INDEX IF NOT EXISTS album_labels_run_idx ON ingest.album_labels (run_id) WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS album_labels_uk ON ingest.album_labels (album_id, COALESCE(version_id, 0), organization_id, role);

-- ── Sucesión entre organizaciones (punto 7) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ingest.organization_relations (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- La organización posterior (Rodven) y la anterior (Sonorodven).
  from_organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  to_organization_id   BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- from «successor_of» to: Rodven es sucesora de Sonorodven.
  -- from «absorbed_by» to: Rodven fue absorbida por Universal.
  -- from «renamed_from» to: el nombre anterior de la misma empresa.
  -- from «division_of» to: sello o división de otra.
  relation_type        VARCHAR(16) NOT NULL,
  start_year           SMALLINT,
  end_year             SMALLINT,
  -- Solo con fuente (decisión de Brian): cita literal y URL o referencia.
  evidence_note        TEXT        NOT NULL,
  source_urls          TEXT[]      NOT NULL DEFAULT '{}',
  source_ref           TEXT,
  run_id               BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organization_relations_type_chk CHECK (relation_type IN ('successor_of', 'absorbed_by', 'renamed_from', 'division_of')),
  CONSTRAINT organization_relations_source_chk CHECK (length(btrim(evidence_note)) > 0 AND (cardinality(source_urls) > 0 OR source_ref IS NOT NULL)),
  CONSTRAINT organization_relations_years_chk CHECK (start_year IS NULL OR end_year IS NULL OR end_year >= start_year),
  CONSTRAINT organization_relations_pair_uk UNIQUE (from_organization_id, to_organization_id, relation_type)
);
CREATE INDEX IF NOT EXISTS organization_relations_to_idx ON ingest.organization_relations (to_organization_id);
CREATE INDEX IF NOT EXISTS organization_relations_run_idx ON ingest.organization_relations (run_id) WHERE run_id IS NOT NULL;

-- ── Series (punto 13) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingest.series (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title           TEXT        NOT NULL,
  -- La serie de un artista («Colección De Éxitos» de Hugo Blanco) o de un sello.
  artist_id       BIGINT      REFERENCES public.artists(id) ON DELETE SET NULL,
  organization_id BIGINT      REFERENCES public.organizations(id) ON DELETE SET NULL,
  description     TEXT,
  notes           TEXT,
  source          VARCHAR(60) NOT NULL,
  run_id          BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT series_title_chk CHECK (length(btrim(title)) > 0)
);
CREATE INDEX IF NOT EXISTS series_artist_idx ON ingest.series (artist_id) WHERE artist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS series_org_idx ON ingest.series (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS series_run_idx ON ingest.series (run_id) WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ingest.series_albums (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id      BIGINT       NOT NULL REFERENCES ingest.series(id) ON DELETE CASCADE,
  album_id       BIGINT       NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  -- Número para ordenar (1, 2, 10) y cómo lo escribe la fuente («Vol. IV»).
  volume_number  NUMERIC(6,2),
  volume_label   VARCHAR(40),
  run_id         BIGINT       REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT series_albums_uk UNIQUE (series_id, album_id)
);
CREATE INDEX IF NOT EXISTS series_albums_album_idx ON ingest.series_albums (album_id);
CREATE INDEX IF NOT EXISTS series_albums_run_idx ON ingest.series_albums (run_id) WHERE run_id IS NOT NULL;

-- ── Lugares (punto 8, decisión de Brian: página de lugar) ────────────────────
CREATE TABLE IF NOT EXISTS ingest.places (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Nombre canónico para mostrar: «Hollywood, California».
  name        TEXT        NOT NULL,
  place_type  VARCHAR(12) NOT NULL DEFAULT 'city',
  city        TEXT,
  region      TEXT,
  country     TEXT,
  -- La ciudad dentro de su región o país, si existe como lugar.
  parent_id   BIGINT      REFERENCES ingest.places(id) ON DELETE SET NULL,
  notes       TEXT,
  run_id      BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT places_type_chk CHECK (place_type IN ('city', 'region', 'country', 'area')),
  CONSTRAINT places_name_chk CHECK (length(btrim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS places_name_uk ON ingest.places (lower(name));
CREATE INDEX IF NOT EXISTS places_parent_idx ON ingest.places (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS places_run_idx ON ingest.places (run_id) WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ingest.place_aliases (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  place_id      BIGINT      NOT NULL REFERENCES ingest.places(id) ON DELETE CASCADE,
  -- Tal como lo escribió la fuente («Hollywood, CA») y su clave normalizada.
  alias         TEXT        NOT NULL,
  alias_key     TEXT        NOT NULL,
  -- Variante dudosa: queda ligada pero en la cola de revisión.
  needs_review  BOOLEAN     NOT NULL DEFAULT false,
  notes         TEXT,
  run_id        BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT place_aliases_key_uk UNIQUE (alias_key)
);
CREATE INDEX IF NOT EXISTS place_aliases_place_idx ON ingest.place_aliases (place_id);
CREATE INDEX IF NOT EXISTS place_aliases_run_idx ON ingest.place_aliases (run_id) WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ingest.organization_places (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  place_id        BIGINT      NOT NULL REFERENCES ingest.places(id) ON DELETE CASCADE,
  source          VARCHAR(60) NOT NULL,
  run_id          BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organization_places_uk UNIQUE (organization_id, place_id)
);
CREATE INDEX IF NOT EXISTS organization_places_place_idx ON ingest.organization_places (place_id);
CREATE INDEX IF NOT EXISTS organization_places_run_idx ON ingest.organization_places (run_id) WHERE run_id IS NOT NULL;

-- ── Créditos en frase (punto 8) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingest.credit_statements (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  album_id       BIGINT      NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  video_id       BIGINT      REFERENCES media.youtube_videos(id) ON DELETE CASCADE,
  section_kind   VARCHAR(30) NOT NULL,
  -- Orden de la línea dentro de la descripción (para mostrarlas en orden).
  line_number    SMALLINT    NOT NULL,
  -- La línea completa, sin trocear: «Mastered by Bernie Grundman at … (Hollywood, CA)».
  text           TEXT        NOT NULL,
  track_numbers  SMALLINT[]  NOT NULL DEFAULT '{}',
  source         VARCHAR(40) NOT NULL DEFAULT 'youtube_description',
  run_id         BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_statements_text_chk CHECK (length(btrim(text)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_statements_line_uk ON ingest.credit_statements (album_id, COALESCE(video_id, 0), line_number);
CREATE INDEX IF NOT EXISTS credit_statements_video_idx ON ingest.credit_statements (video_id) WHERE video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_statements_run_idx ON ingest.credit_statements (run_id) WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ingest.credit_statement_parts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  statement_id    BIGINT      NOT NULL REFERENCES ingest.credit_statements(id) ON DELETE CASCADE,
  -- Tramo de `text` [start_offset, end_offset) en caracteres (code points).
  start_offset    INTEGER     NOT NULL,
  end_offset      INTEGER     NOT NULL,
  part_type       VARCHAR(12) NOT NULL,
  -- Rol normalizado del tramo de rol («mastering», «mixing»…).
  role_key        VARCHAR(40),
  person_id       BIGINT      REFERENCES public.persons(id) ON DELETE SET NULL,
  artist_id       BIGINT      REFERENCES public.artists(id) ON DELETE SET NULL,
  organization_id BIGINT      REFERENCES public.organizations(id) ON DELETE SET NULL,
  place_id        BIGINT      REFERENCES ingest.places(id) ON DELETE SET NULL,
  year            SMALLINT,
  CONSTRAINT credit_statement_parts_type_chk CHECK (part_type IN ('role', 'person', 'artist', 'organization', 'place', 'year', 'tracks')),
  CONSTRAINT credit_statement_parts_span_chk CHECK (start_offset >= 0 AND end_offset > start_offset)
);
CREATE INDEX IF NOT EXISTS credit_statement_parts_statement_idx ON ingest.credit_statement_parts (statement_id, start_offset);
CREATE INDEX IF NOT EXISTS credit_statement_parts_person_idx ON ingest.credit_statement_parts (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_statement_parts_artist_idx ON ingest.credit_statement_parts (artist_id) WHERE artist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_statement_parts_org_idx ON ingest.credit_statement_parts (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_statement_parts_place_idx ON ingest.credit_statement_parts (place_id) WHERE place_id IS NOT NULL;

-- ── Integrantes: fundador e instrumentos (punto 11) ──────────────────────────
CREATE TABLE IF NOT EXISTS ingest.membership_details (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artist_member_id     BIGINT      NOT NULL REFERENCES public.artist_members(id) ON DELETE CASCADE,
  is_founder           BOOLEAN,
  -- Cita literal que lo afirma y de dónde sale (biografía, fuente).
  founder_evidence     TEXT,
  founder_source       VARCHAR(60),
  -- Claves de la lista fija de instrumentos (src/discography/instruments.ts).
  instruments          TEXT[]      NOT NULL DEFAULT '{}',
  run_id               BIGINT      REFERENCES ingest.scrape_runs(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT membership_details_member_uk UNIQUE (artist_member_id),
  CONSTRAINT membership_details_founder_chk CHECK (is_founder IS NOT TRUE OR founder_evidence IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS membership_details_run_idx ON ingest.membership_details (run_id) WHERE run_id IS NOT NULL;

INSERT INTO ingest.change_journal_tables(table_name, mode, policy) VALUES
  ('ingest.album_versions', 'full', 'strict'),
  ('ingest.album_labels', 'full', 'strict'),
  ('ingest.organization_relations', 'full', 'strict'),
  ('ingest.series', 'full', 'strict'),
  ('ingest.series_albums', 'full', 'strict'),
  ('ingest.places', 'full', 'strict'),
  ('ingest.place_aliases', 'full', 'strict'),
  ('ingest.organization_places', 'full', 'strict'),
  ('ingest.credit_statements', 'full', 'soft'),
  ('ingest.credit_statement_parts', 'full', 'soft'),
  ('ingest.membership_details', 'full', 'strict')
ON CONFLICT (table_name) DO NOTHING;
SELECT ingest.crv_journal_attach_all();

COMMIT;
