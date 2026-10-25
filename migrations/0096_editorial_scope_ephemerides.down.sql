BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ingest.artist_editorial_policy) OR EXISTS(SELECT 1 FROM ingest.ephemerides) THEN
   RAISE EXCEPTION 'Hay decisiones editoriales o efemérides conservadas. No se permite perderlas ni reactivar artistas mediante rollback.';
 END IF;
END $$;
DO $$ DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['public.artists','public.albums','public.tracks','public.artist_members','public.streaming_links','public.social_links','ingest.artist_aliases','ingest.musical_identities','ingest.genre_external_identities'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS crv_editorial_scope ON %s',rel);
 END LOOP;
END $$;
DROP FUNCTION ingest.enforce_artist_editorial_policy();
DROP VIEW ingest.catalog_album_credits, ingest.catalog_track_credits;
DROP VIEW ingest.catalog_credit_artists, ingest.catalog_tracks, ingest.catalog_albums, ingest.catalog_artists;
DELETE FROM ingest.change_journal_tables WHERE table_name IN ('ingest.ephemerides','ingest.artist_editorial_policy','ingest.artist_editorial_names','ingest.artist_editorial_persons','ingest.artist_editorial_identifiers');
DROP TABLE ingest.ephemerides, ingest.artist_editorial_identifiers, ingest.artist_editorial_persons, ingest.artist_editorial_names, ingest.artist_editorial_policy;
DROP FUNCTION ingest.editorial_name_key(text);
COMMIT;
