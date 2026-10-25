BEGIN;
-- Retirar una atribución dudosa de la publicación conserva disco, pistas,
-- enlaces e historia hasta poder establecer su dueño. El bloqueo pertenece
-- al par disco/artista: reatribuirlo no bloquea al nuevo dueño.
CREATE TABLE ingest.album_attribution_holds (
 album_id bigint NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
 artist_id bigint NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(evidence)='array'),
 review_id bigint REFERENCES ingest.review_queue(id),
 run_id bigint NOT NULL REFERENCES ingest.scrape_runs(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolution text,
 PRIMARY KEY(album_id,artist_id),
 CHECK((resolved_at IS NULL)=(resolution IS NULL)),
 CHECK(resolution IS NULL OR length(btrim(resolution))>0)
);
INSERT INTO ingest.change_journal_tables(table_name,mode,policy)
 VALUES('ingest.album_attribution_holds','full','strict');
SELECT ingest.crv_journal_attach('ingest.album_attribution_holds'::regclass,'full');

CREATE OR REPLACE VIEW ingest.catalog_albums AS
 SELECT a.* FROM public.albums a JOIN ingest.catalog_artists r ON r.id=a.artist_id
 WHERE NOT EXISTS(SELECT 1 FROM ingest.album_attribution_holds h
   WHERE h.album_id=a.id AND h.artist_id=a.artist_id AND h.resolved_at IS NULL);

-- La derivación de géneros también debe ignorar atribuciones retiradas.
DO $$ DECLARE body text; BEGIN
 SELECT pg_get_functiondef('ingest.crv_derive_artist_genres(bigint,boolean)'::regprocedure) INTO body;
 IF strpos(body,'FROM public.albums al')=0 THEN
  RAISE EXCEPTION 'Definición de derivación inesperada: revisar la migración';
 END IF;
 EXECUTE replace(body,'FROM public.albums al','FROM ingest.catalog_albums al');
END $$;
CREATE FUNCTION ingest.crv_album_attribution_genres_mark() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  INSERT INTO ingest.artist_genres_pending(artist_id) VALUES(OLD.artist_id) ON CONFLICT DO NOTHING;
 ELSE
  INSERT INTO ingest.artist_genres_pending(artist_id) VALUES(NEW.artist_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER crv_album_attribution_genres_mark
 AFTER INSERT OR UPDATE OR DELETE ON ingest.album_attribution_holds
 FOR EACH ROW EXECUTE FUNCTION ingest.crv_album_attribution_genres_mark();
COMMIT;
