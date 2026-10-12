-- ============================================================================
-- CRV · Migración 0063_album_discs (UP)
-- Nombre de cada disco dentro de un álbum (Brian, 2026-10-11: los discos
-- partidos en varias fichas —Lado A/B, CD 1/2, DVD, volúmenes del mismo año,
-- reediciones— van en UNA página con una lista de pistas por disco, y cada
-- lista lleva el nombre que da la fuente).
-- **Octava excepción aprobada al core**: una tabla nueva en `public`.
--
-- Cada fila nombra UN disco (`tracks.disc_number`) de UN álbum: «Lado A»,
-- «CD 2», «DVD», «Vol. 3», «Reedición CD (1992)». Sin fila, la web numera
-- («Disco 2») y, si el álbum tiene un solo disco, no pone encabezado.
-- Si el álbum se borra se va con él; al fusionar, `mergeInto` repunta la FK
-- (la fusión «como disco siguiente» renumera antes para no chocar).
--
-- `public.album_disc_links`: el enlace de escucha de UN disco (Spotify,
-- Deezer…). `streaming_links` admite uno por plataforma y álbum; al juntar
-- «Vol. 1» y «Vol. 2», el Vol. 2 tiene su propio álbum en cada plataforma y
-- sin esta tabla se perdía. Mismas columnas que `streaming_links`, UNIQUE por
-- álbum+disco+plataforma.
--
-- REGLAS DE GOBIERNO: en el diario (0028, `soft`) para que deshacer el run que
-- la escribió la retire. El diff de `public` (tests/run_all.sh,
-- core-and-schema) y la huella de `crv doctor` (APPROVED_CORE_ADDITIONS)
-- aceptan solo estas dos tablas.
-- ============================================================================

BEGIN;
SET LOCAL crv.journal = 'off';

CREATE TABLE IF NOT EXISTS public.album_discs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  album_id    BIGINT NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  disc_number SMALLINT NOT NULL,
  title       VARCHAR(120) NOT NULL,
  notes       TEXT,
  CONSTRAINT album_discs_disc_number_ck CHECK (disc_number BETWEEN 1 AND 99),
  CONSTRAINT album_discs_title_ck CHECK (length(btrim(title)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS album_discs_album_disc_uk ON public.album_discs (album_id, disc_number);

CREATE TABLE IF NOT EXISTS public.album_disc_links (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  album_id    BIGINT NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  disc_number SMALLINT NOT NULL,
  platform    VARCHAR(24) NOT NULL,
  url         TEXT NOT NULL,
  external_id VARCHAR(120),
  method      VARCHAR(16) NOT NULL,
  source      VARCHAR(40) NOT NULL,
  verified    BOOLEAN NOT NULL DEFAULT false,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT album_disc_links_disc_number_ck CHECK (disc_number BETWEEN 1 AND 99)
);
CREATE UNIQUE INDEX IF NOT EXISTS album_disc_links_album_disc_platform_uk ON public.album_disc_links (album_id, disc_number, platform);

INSERT INTO ingest.change_journal_tables(table_name, mode, policy)
VALUES ('public.album_discs', 'full', 'soft'), ('public.album_disc_links', 'full', 'soft')
ON CONFLICT (table_name) DO NOTHING;
SELECT ingest.crv_journal_attach_all();

COMMIT;
