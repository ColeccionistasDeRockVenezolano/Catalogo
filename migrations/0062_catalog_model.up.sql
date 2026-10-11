BEGIN;
CREATE SCHEMA IF NOT EXISTS crv_evidence_archive;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['catalog_works','catalog_edition_details','musical_identities','edition_support_details','support_tracks','scoped_genres'] LOOP
  IF to_regclass('crv_evidence_archive.'||n) IS NOT NULL THEN
   IF to_regclass('ingest.'||n) IS NOT NULL THEN RAISE EXCEPTION 'both active and archived catalog model exist: %',n; END IF;
   EXECUTE format('ALTER TABLE crv_evidence_archive.%I SET SCHEMA ingest',n);
  END IF;
 END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS ingest.catalog_works (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 title text NOT NULL CHECK(length(btrim(title))>0),
 artist_id bigint NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
 notes text
);
CREATE INDEX IF NOT EXISTS catalog_works_artist_idx ON ingest.catalog_works(artist_id);
CREATE TABLE IF NOT EXISTS ingest.catalog_edition_details (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 album_id bigint NOT NULL UNIQUE REFERENCES public.albums(id) ON DELETE CASCADE,
 work_id bigint REFERENCES ingest.catalog_works(id) ON DELETE RESTRICT,
 release_date jsonb CHECK(release_date IS NULL OR ingest.crv_date_value_valid(release_date)),
 edition_name text, notes text
);
CREATE INDEX IF NOT EXISTS catalog_edition_work_idx ON ingest.catalog_edition_details(work_id);
CREATE TABLE IF NOT EXISTS ingest.musical_identities (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
 artist_id bigint NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
 relationship text NOT NULL CHECK(relationship IN ('solo_identity','member','collaborator')),
 period jsonb CHECK(period IS NULL OR ingest.crv_date_value_valid(period)),
 notes text
);
CREATE INDEX IF NOT EXISTS musical_identities_person_idx ON ingest.musical_identities(person_id);
CREATE INDEX IF NOT EXISTS musical_identities_artist_idx ON ingest.musical_identities(artist_id);
CREATE TABLE IF NOT EXISTS ingest.edition_support_details (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 album_id bigint NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
 album_format_id bigint UNIQUE REFERENCES public.album_formats(id) ON DELETE CASCADE,
 format text NOT NULL CHECK(length(btrim(format))>0),
 disc_number integer NOT NULL CHECK(disc_number BETWEEN 1 AND 99),
 notes text
);
CREATE INDEX IF NOT EXISTS edition_support_album_idx ON ingest.edition_support_details(album_id);
CREATE TABLE IF NOT EXISTS ingest.support_tracks (
 support_id bigint NOT NULL REFERENCES ingest.edition_support_details(id) ON DELETE CASCADE,
 track_id bigint NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
 PRIMARY KEY(support_id,track_id)
);
CREATE INDEX IF NOT EXISTS support_tracks_track_idx ON ingest.support_tracks(track_id);
CREATE TABLE IF NOT EXISTS ingest.scoped_genres (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 artist_id bigint REFERENCES public.artists(id) ON DELETE CASCADE,
 person_id bigint REFERENCES public.persons(id) ON DELETE CASCADE,
 album_id bigint REFERENCES public.albums(id) ON DELETE CASCADE,
 track_id bigint REFERENCES public.tracks(id) ON DELETE CASCADE,
 genre_id bigint NOT NULL REFERENCES ingest.genres(id) ON DELETE RESTRICT,
 period jsonb CHECK(period IS NULL OR ingest.crv_date_value_valid(period)),
 notes text,
 CHECK(num_nonnulls(artist_id,person_id,album_id,track_id)=1)
);
CREATE INDEX IF NOT EXISTS scoped_genres_artist_idx ON ingest.scoped_genres(artist_id);
CREATE INDEX IF NOT EXISTS scoped_genres_person_idx ON ingest.scoped_genres(person_id);
CREATE INDEX IF NOT EXISTS scoped_genres_album_idx ON ingest.scoped_genres(album_id);
CREATE INDEX IF NOT EXISTS scoped_genres_track_idx ON ingest.scoped_genres(track_id);
CREATE INDEX IF NOT EXISTS scoped_genres_genre_idx ON ingest.scoped_genres(genre_id);

-- Restore constraints detached only while the layer was parked.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('catalog_works','artist_id','public.artists','CASCADE'),
 ('catalog_edition_details','album_id','public.albums','CASCADE'),
 ('musical_identities','person_id','public.persons','CASCADE'),
 ('musical_identities','artist_id','public.artists','CASCADE'),
 ('edition_support_details','album_id','public.albums','CASCADE'),
 ('edition_support_details','album_format_id','public.album_formats','CASCADE'),
 ('support_tracks','track_id','public.tracks','CASCADE'),
 ('scoped_genres','artist_id','public.artists','CASCADE'),
 ('scoped_genres','person_id','public.persons','CASCADE'),
 ('scoped_genres','album_id','public.albums','CASCADE'),
 ('scoped_genres','track_id','public.tracks','CASCADE'),
 ('scoped_genres','genre_id','ingest.genres','RESTRICT')) AS refs(t,col,parent,action) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=('ingest.'||r.t)::regclass AND conname=r.t||'_'||r.col||'_fkey') THEN
   EXECUTE format('ALTER TABLE ingest.%I ADD CONSTRAINT %I FOREIGN KEY(%I) REFERENCES %s(id) ON DELETE %s',r.t,r.t||'_'||r.col||'_fkey',r.col,r.parent,r.action);
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES ('catalog_edition_details','release_date'),('musical_identities','period'),('scoped_genres','period')) AS dates(t,col) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=('ingest.'||r.t)::regclass AND conname=r.t||'_'||r.col||'_check') THEN
   EXECUTE format('ALTER TABLE ingest.%I ADD CONSTRAINT %I CHECK(%I IS NULL OR ingest.crv_date_value_valid(%I))',r.t,r.t||'_'||r.col||'_check',r.col,r.col);
  END IF;
 END LOOP;
END $$;

-- Historical albums remain distinct editions. No shared work is inferred from a title.
INSERT INTO ingest.catalog_edition_details(album_id) SELECT id FROM public.albums ON CONFLICT(album_id) DO NOTHING;

-- Cross-entity ownership is checked even for SQL callers and undo.
CREATE OR REPLACE FUNCTION ingest.crv_catalog_model_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matched bigint;
BEGIN
 IF TG_TABLE_NAME IN ('catalog_edition_details','edition_support_details','support_tracks') THEN
  EXECUTE format('SELECT * FROM ingest.%I WHERE %s',TG_TABLE_NAME,CASE WHEN TG_TABLE_NAME='support_tracks' THEN 'support_id=$1 AND track_id=$2' ELSE 'id=$1' END) INTO NEW USING coalesce((to_jsonb(NEW)->>'id')::bigint,(to_jsonb(NEW)->>'support_id')::bigint), (to_jsonb(NEW)->>'track_id')::bigint;
  GET DIAGNOSTICS matched = ROW_COUNT;
  IF matched=0 THEN RETURN NULL; END IF;
 END IF;
 IF TG_TABLE_NAME='catalog_edition_details' AND to_jsonb(NEW)->>'work_id' IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.albums a JOIN ingest.catalog_works w ON w.artist_id=a.artist_id WHERE a.id=NEW.album_id AND w.id=NEW.work_id) THEN
   RAISE EXCEPTION 'edition and work belong to different artists' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='edition_support_details' AND to_jsonb(NEW)->>'album_format_id' IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.album_formats WHERE id=NEW.album_format_id AND album_id=NEW.album_id) THEN
   RAISE EXCEPTION 'format belongs to another edition' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='support_tracks' THEN
  IF NOT EXISTS(SELECT 1 FROM ingest.edition_support_details s JOIN public.tracks t ON t.album_id=s.album_id AND t.disc_number=s.disc_number WHERE s.id=NEW.support_id AND t.id=NEW.track_id) THEN
   RAISE EXCEPTION 'track belongs to another edition or disc' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['catalog_edition_details','edition_support_details','support_tracks'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS crv_catalog_model_check ON ingest.%I',n);
  EXECUTE format('CREATE CONSTRAINT TRIGGER crv_catalog_model_check AFTER INSERT OR UPDATE ON ingest.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ingest.crv_catalog_model_check()',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['catalog_works','catalog_edition_details','musical_identities','edition_support_details','support_tracks','scoped_genres'] LOOP
  INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES('ingest.'||n,'full','strict') ON CONFLICT(table_name) DO UPDATE SET mode='full',policy='strict';
  PERFORM ingest.crv_journal_attach(('ingest.'||n)::regclass,'full');
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION ingest.crv_catalog_model_parent_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME IN ('albums','catalog_works') AND EXISTS(
  SELECT 1 FROM ingest.catalog_edition_details e JOIN public.albums a ON a.id=e.album_id JOIN ingest.catalog_works w ON w.id=e.work_id
   WHERE a.artist_id<>w.artist_id AND (CASE WHEN TG_TABLE_NAME='albums' THEN a.id=NEW.id ELSE w.id=NEW.id END)) THEN
  RAISE EXCEPTION 'edition and work belong to different artists' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME IN ('album_formats','albums') AND EXISTS(
  SELECT 1 FROM ingest.edition_support_details s JOIN public.album_formats f ON f.id=s.album_format_id
   WHERE s.album_id<>f.album_id AND (CASE WHEN TG_TABLE_NAME='albums' THEN s.album_id=NEW.id OR f.album_id=NEW.id ELSE f.id=NEW.id END)) THEN
  RAISE EXCEPTION 'format belongs to another edition' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME IN ('tracks','albums') AND EXISTS(
  SELECT 1 FROM ingest.support_tracks st JOIN ingest.edition_support_details s ON s.id=st.support_id JOIN public.tracks t ON t.id=st.track_id
   WHERE (s.album_id<>t.album_id OR s.disc_number<>t.disc_number) AND (CASE WHEN TG_TABLE_NAME='tracks' THEN t.id=NEW.id ELSE s.album_id=NEW.id OR t.album_id=NEW.id END)) THEN
  RAISE EXCEPTION 'track belongs to another edition or disc' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['public.albums','public.album_formats','public.tracks','ingest.catalog_works'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER crv_catalog_model_parent_check AFTER UPDATE ON %s DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ingest.crv_catalog_model_parent_check()',t);
 END LOOP;
END $$;

COMMIT;
