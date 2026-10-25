-- Brian, 2026-10-21: retirar referencias extranjeras del catálogo público,
-- impedir nuevas altas/conversiones y conservar créditos, personas y hechos.
-- No se borran filas del core: sus FK siguen conservando toda la evidencia.
BEGIN;
CREATE FUNCTION ingest.editorial_name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))
$$;

CREATE TABLE ingest.artist_editorial_policy (
 artist_id bigint PRIMARY KEY REFERENCES public.artists(id) ON DELETE RESTRICT,
 disposition text NOT NULL CHECK(disposition IN ('reference','review')),
 reference_kind text NOT NULL CHECK(reference_kind IN ('person','collective')),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 snapshot jsonb NOT NULL,
 decided_by text NOT NULL,
 run_id bigint REFERENCES ingest.scrape_runs(id) ON DELETE RESTRICT,
 decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ingest.artist_editorial_names (
 artist_id bigint NOT NULL REFERENCES ingest.artist_editorial_policy(artist_id) ON DELETE RESTRICT,
 name text NOT NULL,
 name_key text GENERATED ALWAYS AS (ingest.editorial_name_key(name)) STORED,
 PRIMARY KEY(artist_id,name)
);
CREATE INDEX ON ingest.artist_editorial_names(name_key);
CREATE TABLE ingest.artist_editorial_persons (
 artist_id bigint NOT NULL REFERENCES ingest.artist_editorial_policy(artist_id) ON DELETE RESTRICT,
 person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
 PRIMARY KEY(artist_id,person_id)
);
CREATE INDEX ON ingest.artist_editorial_persons(person_id);
CREATE TABLE ingest.artist_editorial_identifiers (
 artist_id bigint NOT NULL REFERENCES ingest.artist_editorial_policy(artist_id) ON DELETE RESTRICT,
 namespace text NOT NULL, identifier text NOT NULL,
 PRIMARY KEY(artist_id,namespace,identifier)
);
CREATE INDEX ON ingest.artist_editorial_identifiers(namespace,identifier);

CREATE VIEW ingest.catalog_artists AS
 SELECT a.* FROM public.artists a WHERE NOT EXISTS
 (SELECT 1 FROM ingest.artist_editorial_policy p WHERE p.artist_id=a.id);
CREATE VIEW ingest.catalog_albums AS
 SELECT a.* FROM public.albums a JOIN ingest.catalog_artists r ON r.id=a.artist_id;
CREATE VIEW ingest.catalog_tracks AS
 SELECT t.* FROM public.tracks t JOIN ingest.catalog_albums a ON a.id=t.album_id;
-- Los créditos extranjeros siguen teniendo nombre. Una referencia colectiva
-- no recibe enlace a una ficha de artista retirada; un solista va a su persona.
CREATE VIEW ingest.catalog_credit_artists AS
 SELECT a.id,a.name,CASE WHEN p.artist_id IS NULL THEN a.id END AS public_artist_id,
 (SELECT person_id FROM ingest.artist_editorial_persons e WHERE e.artist_id=p.artist_id ORDER BY person_id LIMIT 1) AS reference_person_id
 FROM public.artists a LEFT JOIN ingest.artist_editorial_policy p ON p.artist_id=a.id;
CREATE VIEW ingest.catalog_album_credits AS
 SELECT c.id,c.album_id,COALESCE(c.person_id,r.reference_person_id) AS person_id,
 c.artist_id,c.organization_id,c.credit_type,c.role,c.notes
 FROM public.album_credits c JOIN ingest.catalog_albums a ON a.id=c.album_id
 LEFT JOIN ingest.catalog_credit_artists r ON r.id=c.artist_id;
CREATE VIEW ingest.catalog_track_credits AS
 SELECT c.id,c.track_id,COALESCE(c.person_id,r.reference_person_id) AS person_id,
 c.artist_id,c.organization_id,c.credit_type,c.role,c.notes
 FROM public.track_credits c JOIN ingest.catalog_tracks t ON t.id=c.track_id
 LEFT JOIN ingest.catalog_credit_artists r ON r.id=c.artist_id;

CREATE FUNCTION ingest.enforce_artist_editorial_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blocked boolean := false;
BEGIN
 IF TG_OP='DELETE' THEN NEW := OLD; END IF;
 IF TG_TABLE_NAME='artists' THEN
   blocked := EXISTS(SELECT 1 FROM ingest.artist_editorial_policy WHERE artist_id=NEW.id)
     OR EXISTS(SELECT 1 FROM ingest.artist_editorial_names WHERE name_key=ingest.editorial_name_key(NEW.name));
 ELSIF TG_TABLE_NAME='artist_aliases' THEN
   blocked := EXISTS(SELECT 1 FROM ingest.artist_editorial_policy WHERE artist_id=NEW.artist_id)
     OR EXISTS(SELECT 1 FROM ingest.artist_editorial_names WHERE name_key=ingest.editorial_name_key(NEW.alias));
 ELSIF TG_TABLE_NAME='tracks' THEN
   blocked := EXISTS(SELECT 1 FROM public.albums a JOIN ingest.artist_editorial_policy p ON p.artist_id=a.artist_id WHERE a.id=NEW.album_id);
 ELSIF TG_TABLE_NAME IN ('artist_members','musical_identities') THEN
   blocked := EXISTS(SELECT 1 FROM ingest.artist_editorial_policy WHERE artist_id=NEW.artist_id)
     OR EXISTS(SELECT 1 FROM ingest.artist_editorial_persons WHERE person_id=NEW.person_id);
 ELSIF TG_TABLE_NAME='genre_external_identities' THEN
   IF NEW.entity_kind='artist' THEN
     blocked := EXISTS(SELECT 1 FROM ingest.artist_editorial_policy WHERE artist_id=NEW.entity_id)
       OR EXISTS(SELECT 1 FROM ingest.artist_editorial_identifiers WHERE namespace='genre-source:'||NEW.source_id AND identifier=NEW.external_id);
   END IF;
 ELSIF TG_TABLE_NAME IN ('streaming_links','social_links') THEN
   blocked := EXISTS(SELECT 1 FROM ingest.artist_editorial_policy WHERE artist_id=NEW.artist_id)
     OR (NEW.artist_id IS NOT NULL AND EXISTS(SELECT 1 FROM ingest.artist_editorial_identifiers
       WHERE (namespace='url' AND identifier=NEW.url)
       OR (TG_TABLE_NAME='streaming_links' AND namespace='platform:'||NEW.platform AND identifier=to_jsonb(NEW)->>'external_id')));
 ELSE
   blocked := EXISTS(SELECT 1 FROM ingest.artist_editorial_policy WHERE artist_id=NEW.artist_id);
 END IF;
 IF blocked THEN
   RAISE EXCEPTION USING ERRCODE='PCE01', MESSAGE='Identidad excluida del catálogo de artistas por decisión editorial. Conservar como persona o referencia colectiva; no importar ni convertir.';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['public.artists','public.albums','public.tracks','public.artist_members','public.streaming_links','public.social_links','ingest.artist_aliases','ingest.musical_identities','ingest.genre_external_identities'] LOOP
   EXECUTE format('CREATE TRIGGER crv_editorial_scope BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION ingest.enforce_artist_editorial_policy()',rel);
 END LOOP;
END $$;

CREATE TABLE ingest.ephemerides (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_key text NOT NULL UNIQUE,
 title text NOT NULL CHECK(length(btrim(title))>0),
 description text NOT NULL CHECK(length(btrim(description))>0),
 event_date date,
 event_year smallint NOT NULL CHECK(event_year BETWEEN 1 AND 9999),
 date_note text,
 place text NOT NULL,
 subject_name text NOT NULL,
 original_artist_id bigint, -- procedencia, deliberadamente sin FK ni cascada
 status text NOT NULL CHECK(status IN ('verified','pending','contradicted')),
 sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array' AND jsonb_array_length(sources)>0),
 run_id bigint REFERENCES ingest.scrape_runs(id) ON DELETE RESTRICT,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(event_date IS NULL OR extract(year FROM event_date)=event_year),
 CHECK(status<>'verified' OR event_date IS NOT NULL)
);
CREATE INDEX ON ingest.ephemerides(status,event_date);
-- Diario existente: conservación y eventual deshacer mediante runs.
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES('ingest.artist_editorial_policy','full','strict') ON CONFLICT DO NOTHING;
SELECT ingest.crv_journal_attach('ingest.artist_editorial_policy'::regclass,'full');
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES('ingest.artist_editorial_names','full','strict') ON CONFLICT DO NOTHING;
SELECT ingest.crv_journal_attach('ingest.artist_editorial_names'::regclass,'full');
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES('ingest.artist_editorial_persons','full','strict') ON CONFLICT DO NOTHING;
SELECT ingest.crv_journal_attach('ingest.artist_editorial_persons'::regclass,'full');
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES('ingest.artist_editorial_identifiers','full','strict') ON CONFLICT DO NOTHING;
SELECT ingest.crv_journal_attach('ingest.artist_editorial_identifiers'::regclass,'full');
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES('ingest.ephemerides','full','strict') ON CONFLICT DO NOTHING;
SELECT ingest.crv_journal_attach('ingest.ephemerides'::regclass,'full');
COMMIT;
