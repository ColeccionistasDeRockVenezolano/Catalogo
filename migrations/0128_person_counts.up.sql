-- ============================================================================
-- CRV · Migración 0128_person_counts (UP)
-- Conteos de participación de las personas, precalculados (Brian, 2026-11-08,
-- punto 2 del plan de rendimiento: «precompute counts», con disparadores en el core).
--
-- QUÉ: `ingest.person_counts` guarda, por persona, sus créditos (disco + pista),
--   sus membresías de banda y la lista de roles, con la misma regla editorial
--   de las vistas `ingest.catalog_album_credits` / `catalog_track_credits`.
--   El listado de personas la lee en vez de expandir ~157.000 filas por página.
--
-- FRESCURA EXACTA, sin bloquear a los escritores:
--   * Disparadores POR SENTENCIA en las tablas de las que dependen esas vistas
--     anotan la transacción en `ingest.person_counts_changes` (una fila por
--     transacción: ON CONFLICT DO NOTHING; no hay fila compartida que bloquear).
--   * Quien lee y encuentra anotaciones visibles recalcula la tabla entera en
--     una foto REPEATABLE READ, con candado consultivo (un recálculo a la vez),
--     y borra solo las anotaciones que esa foto ve. Una escritura que confirma
--     después deja su anotación y fuerza el siguiente recálculo.
--   * `ingest.person_counts_state.built` es false hasta el primer cálculo.
--
-- DECIMOCUARTA EXCEPCIÓN APROBADA AL CORE (Brian, 2026-11-08, «Constrúyelo con
--   triggers»): disparador `crv_person_counts_dirty` en `public.album_credits`,
--   `public.track_credits`, `public.artist_members`, `public.albums`,
--   `public.tracks` y `public.artists`. No cambia columnas ni datos de `public`;
--   el diff de `pg_dump --schema=public` lo filtra por nombre y el down lo quita.
-- ============================================================================

CREATE TABLE ingest.person_counts (
  person_id    bigint PRIMARY KEY,
  credit_count integer NOT NULL,
  band_count   integer NOT NULL,
  roles        text[]  NOT NULL
);

CREATE TABLE ingest.person_counts_changes (
  tx         bigint PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingest.person_counts_state (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  built        boolean NOT NULL DEFAULT false,
  refreshed_at timestamptz
);
INSERT INTO ingest.person_counts_state DEFAULT VALUES;

CREATE FUNCTION ingest.crv_person_counts_mark() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ingest.person_counts_changes (tx) VALUES (txid_current()) ON CONFLICT (tx) DO NOTHING;
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.album_credits', 'public.track_credits', 'public.artist_members',
    'public.albums', 'public.tracks', 'public.artists',
    'ingest.album_attribution_holds', 'ingest.artist_editorial_persons', 'ingest.artist_editorial_policy'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER crv_person_counts_dirty AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s
         FOR EACH STATEMENT EXECUTE FUNCTION ingest.crv_person_counts_mark()', t);
  END LOOP;
END $$;
