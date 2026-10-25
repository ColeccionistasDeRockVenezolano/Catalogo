-- Brian: «proyectos de venezolanos también son venezolanos». El país de
-- formación/residencia no determina el alcance editorial del proyecto.
BEGIN;
CREATE TABLE ingest.artist_editorial_admissions (
 artist_id bigint PRIMARY KEY REFERENCES public.artists(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)>0),
 previous_exclusion jsonb,
 decided_by text NOT NULL,
 run_id bigint REFERENCES ingest.scrape_runs(id) ON DELETE RESTRICT,
 decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION ingest.protect_editorial_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM ingest.artist_editorial_admissions WHERE artist_id=NEW.artist_id) THEN
   RAISE EXCEPTION USING ERRCODE='PCE02',MESSAGE='Proyecto admitido por vínculo venezolano documentado; el país de origen o residencia no autoriza su exclusión.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crv_protect_editorial_admission BEFORE INSERT OR UPDATE ON ingest.artist_editorial_policy
 FOR EACH ROW EXECUTE FUNCTION ingest.protect_editorial_admission();
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES('ingest.artist_editorial_admissions','full','strict');
SELECT ingest.crv_journal_attach('ingest.artist_editorial_admissions'::regclass,'full');
COMMIT;
