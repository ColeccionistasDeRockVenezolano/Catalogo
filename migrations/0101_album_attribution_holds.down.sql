BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ingest.album_attribution_holds) THEN
  RAISE EXCEPTION 'Hay atribuciones retiradas conservadas; el rollback perdería evidencia o reactivaría publicaciones';
 END IF;
END $$;
CREATE OR REPLACE VIEW ingest.catalog_albums AS
 SELECT a.* FROM public.albums a JOIN ingest.catalog_artists r ON r.id=a.artist_id;
DO $$ DECLARE body text; BEGIN
 SELECT pg_get_functiondef('ingest.crv_derive_artist_genres(bigint,boolean)'::regprocedure) INTO body;
 EXECUTE replace(body,'FROM ingest.catalog_albums al','FROM public.albums al');
END $$;
DROP TRIGGER crv_album_attribution_genres_mark ON ingest.album_attribution_holds;
DROP FUNCTION ingest.crv_album_attribution_genres_mark();
DELETE FROM ingest.change_journal_tables WHERE table_name='ingest.album_attribution_holds';
DROP TABLE ingest.album_attribution_holds;
COMMIT;
