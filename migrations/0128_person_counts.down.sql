-- CRV · Migración 0128_person_counts (DOWN): quita los disparadores del core y las tablas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.album_credits', 'public.track_credits', 'public.artist_members',
    'public.albums', 'public.tracks', 'public.artists',
    'ingest.album_attribution_holds', 'ingest.artist_editorial_persons', 'ingest.artist_editorial_policy'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS crv_person_counts_dirty ON %s', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS ingest.crv_person_counts_mark();
DROP TABLE IF EXISTS ingest.person_counts_state;
DROP TABLE IF EXISTS ingest.person_counts_changes;
DROP TABLE IF EXISTS ingest.person_counts;
