BEGIN;

-- Feature rollback parks the immutable inventory outside ingest. Restore the
-- same tables (and identity sequences), never reconstruct their evidence.
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['evidence_documents','evidence_reads','evidence_fragments','catalog_facts','catalog_fact_evidence','catalog_fact_bindings'] LOOP
    IF to_regclass('crv_evidence_archive.' || name) IS NOT NULL THEN
      IF to_regclass('ingest.' || name) IS NOT NULL THEN
        RAISE EXCEPTION 'both active and archived evidence inventory exist: %', name;
      END IF;
      EXECUTE format('ALTER TABLE crv_evidence_archive.%I SET SCHEMA ingest', name);
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS ingest.evidence_documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_key TEXT NOT NULL UNIQUE CHECK (document_key ~ '^[0-9a-f]{64}$'),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash = encode(sha256(convert_to(content_text,'UTF8')),'hex')),
  captured_at TIMESTAMPTZ,
  acquisition_method TEXT NOT NULL CHECK (acquisition_method IN ('http','raw_archive','local_archive','search_snippet','unknown')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (acquisition_method <> 'unknown' OR captured_at IS NULL)
);

CREATE TABLE IF NOT EXISTS ingest.evidence_reads (
  document_id BIGINT NOT NULL REFERENCES ingest.evidence_documents(id) ON DELETE RESTRICT,
  read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (document_id, read_at)
);

CREATE TABLE IF NOT EXISTS ingest.evidence_fragments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES ingest.evidence_documents(id) ON DELETE RESTRICT,
  quote TEXT NOT NULL CHECK (length(quote)>0),
  start_offset INTEGER NOT NULL CHECK (start_offset>=0),
  end_offset INTEGER NOT NULL CHECK (end_offset>start_offset),
  selector TEXT,
  offset_unit TEXT NOT NULL DEFAULT 'utf8_byte' CHECK (offset_unit IN ('utf8_byte','database_character')),
  CONSTRAINT evidence_fragments_position_key UNIQUE (document_id,offset_unit,start_offset,end_offset)
);

-- Old parked inventories keep their original database-character coordinates.
-- New fragments use UTF-8 byte coordinates in UTF8 and SQL_ASCII alike.
ALTER TABLE ingest.evidence_fragments ADD COLUMN IF NOT EXISTS offset_unit text NOT NULL DEFAULT 'database_character';
ALTER TABLE ingest.evidence_fragments ALTER COLUMN offset_unit SET DEFAULT 'utf8_byte';
ALTER TABLE ingest.evidence_fragments DROP CONSTRAINT IF EXISTS evidence_fragments_document_id_start_offset_end_offset_key;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ingest.evidence_fragments'::regclass AND conname='evidence_fragments_offset_unit_check') THEN
  ALTER TABLE ingest.evidence_fragments ADD CONSTRAINT evidence_fragments_offset_unit_check CHECK(offset_unit IN ('utf8_byte','database_character'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ingest.evidence_fragments'::regclass AND conname='evidence_fragments_position_key') THEN
  ALTER TABLE ingest.evidence_fragments ADD CONSTRAINT evidence_fragments_position_key UNIQUE(document_id,offset_unit,start_offset,end_offset);
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS ingest.catalog_facts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fact_key TEXT NOT NULL UNIQUE CHECK (fact_key ~ '^[0-9a-f]{64}$'),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('artist','person','organization','album','track')),
  original_subject_id BIGINT NOT NULL CHECK (original_subject_id>0),
  field TEXT,
  relation TEXT,
  value JSONB NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('scalar','date','relation')),
  scope JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scope)='object'),
  period JSONB CHECK (period IS NULL OR jsonb_typeof(period)='object'),
  documentary_state TEXT NOT NULL CHECK (documentary_state IN ('pending','verified','contradicted','unverifiable','editorial')),
  created_by TEXT NOT NULL CHECK (created_by IN ('human','system','ai')),
  operator TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason))>0),
  -- Historical references deliberately do not cascade with operational runs
  -- or claims. The immutable fact remains when its current binding is undone.
  claim_id BIGINT,
  run_id BIGINT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((field IS NOT NULL)::int + (relation IS NOT NULL)::int=1),
  CHECK ((value_type='relation') = (relation IS NOT NULL)),
  CHECK (CASE value_type
    WHEN 'scalar' THEN jsonb_typeof(value) IN ('string','number','boolean','null')
    WHEN 'relation' THEN jsonb_typeof(value)='object'
    WHEN 'date' THEN jsonb_typeof(value)='object' AND coalesce(value->>'kind' IN ('point','interval'),false)
    ELSE false END),
  CHECK (documentary_state NOT IN ('verified','editorial') OR created_by='human')
);
CREATE INDEX IF NOT EXISTS catalog_facts_subject_idx ON ingest.catalog_facts(subject_kind,original_subject_id,id);
CREATE INDEX IF NOT EXISTS catalog_facts_claim_idx ON ingest.catalog_facts(claim_id) WHERE claim_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ingest.catalog_fact_evidence (
  fact_id BIGINT NOT NULL REFERENCES ingest.catalog_facts(id) ON DELETE RESTRICT,
  fragment_id BIGINT NOT NULL REFERENCES ingest.evidence_fragments(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('supports','contradicts','context')),
  PRIMARY KEY (fact_id,fragment_id,role)
);
CREATE INDEX IF NOT EXISTS catalog_fact_evidence_fragment_idx ON ingest.catalog_fact_evidence(fragment_id);

CREATE TABLE IF NOT EXISTS ingest.catalog_fact_bindings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fact_id BIGINT NOT NULL REFERENCES ingest.catalog_facts(id) ON DELETE RESTRICT,
  artist_id BIGINT,
  person_id BIGINT,
  organization_id BIGINT,
  album_id BIGINT,
  track_id BIGINT,
  disposition TEXT NOT NULL DEFAULT 'pending' CHECK (disposition IN ('pending','applied','rejected','superseded')),
  decided_by TEXT,
  decision_reason TEXT,
  CHECK (num_nonnulls(artist_id,person_id,organization_id,album_id,track_id)=1),
  CHECK (disposition='pending' OR (decided_by IS NOT NULL AND decision_reason IS NOT NULL AND length(btrim(decided_by))>0 AND length(btrim(decision_reason))>0)),
  UNIQUE (fact_id)
);
CREATE INDEX IF NOT EXISTS catalog_fact_bindings_artist_idx ON ingest.catalog_fact_bindings(artist_id) WHERE artist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_fact_bindings_person_idx ON ingest.catalog_fact_bindings(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_fact_bindings_organization_idx ON ingest.catalog_fact_bindings(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_fact_bindings_album_idx ON ingest.catalog_fact_bindings(album_id) WHERE album_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_fact_bindings_track_idx ON ingest.catalog_fact_bindings(track_id) WHERE track_id IS NOT NULL;

DO $$ DECLARE kind text; table_name text; constraint_name text; BEGIN
  FOREACH kind IN ARRAY ARRAY['artist','person','organization','album','track'] LOOP
    table_name := CASE kind WHEN 'person' THEN 'persons' ELSE kind || 's' END;
    constraint_name := 'catalog_fact_bindings_' || kind || '_fk';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ingest.catalog_fact_bindings'::regclass AND conname=constraint_name) THEN
      EXECUTE format('ALTER TABLE ingest.catalog_fact_bindings ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE CASCADE',constraint_name,kind || '_id',table_name);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION ingest.crv_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'evidence inventory is immutable; record a new assertion instead of rewriting provenance' USING ERRCODE='23514'; END $$;

CREATE OR REPLACE FUNCTION ingest.crv_evidence_fragment_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE content text; mismatch boolean; BEGIN
  SELECT content_text INTO content FROM ingest.evidence_documents WHERE id=NEW.document_id;
  mismatch := CASE WHEN NEW.offset_unit='utf8_byte' THEN
    substring(convert_to(content,'UTF8') FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset) IS DISTINCT FROM convert_to(NEW.quote,'UTF8')
    ELSE substring(content FROM NEW.start_offset+1 FOR NEW.end_offset-NEW.start_offset) IS DISTINCT FROM NEW.quote END;
  IF mismatch THEN
    RAISE EXCEPTION 'fragment does not match the preserved document at its declared offsets' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION ingest.crv_fact_verified_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.documentary_state='verified' AND NOT EXISTS (
    SELECT 1 FROM ingest.catalog_fact_evidence e
    JOIN ingest.evidence_fragments f ON f.id=e.fragment_id
    JOIN ingest.evidence_documents d ON d.id=f.document_id
    WHERE e.fact_id=NEW.id AND e.role='supports' AND d.captured_at IS NOT NULL
      AND d.acquisition_method IN ('http','raw_archive')) THEN
    RAISE EXCEPTION 'verified fact requires a preserved supporting fragment with known acquisition' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;

-- Validate the stored date representation too, including direct SQL writers.
-- Bounds only compare intervals; they never become asserted calendar days.
CREATE OR REPLACE FUNCTION ingest.crv_date_value_valid(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE y integer; m integer; d integer; first_date date; last_date date; a jsonb; b jsonb;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF value->>'kind'='point' THEN
    IF NOT (value ?& ARRAY['kind','year','month','day','precision','approximate'])
      OR value - ARRAY['kind','year','month','day','precision','approximate'] <> '{}'::jsonb
      OR jsonb_typeof(value->'year') IS DISTINCT FROM 'number'
      OR jsonb_typeof(value->'approximate') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(value->'month') NOT IN ('number','null')
      OR jsonb_typeof(value->'day') NOT IN ('number','null') THEN RETURN false; END IF;
    IF (value->>'year')::numeric NOT BETWEEN 1 AND 9999
      OR trunc((value->>'year')::numeric)<>(value->>'year')::numeric THEN RETURN false; END IF;
    y := (value->>'year')::integer;
    IF value->'month'<>'null'::jsonb THEN
      IF (value->>'month')::numeric NOT BETWEEN 1 AND 12
        OR trunc((value->>'month')::numeric)<>(value->>'month')::numeric THEN RETURN false; END IF;
      m := (value->>'month')::integer;
    END IF;
    IF value->'day'<>'null'::jsonb THEN
      IF m IS NULL OR (value->>'day')::numeric NOT BETWEEN 1 AND 31
        OR trunc((value->>'day')::numeric)<>(value->>'day')::numeric THEN RETURN false; END IF;
      d := (value->>'day')::integer;
    END IF;
    IF value->>'precision' IS DISTINCT FROM (CASE WHEN d IS NOT NULL THEN 'day' WHEN m IS NOT NULL THEN 'month' ELSE 'year' END) THEN RETURN false; END IF;
    PERFORM make_date(y,coalesce(m,1),coalesce(d,1));
    RETURN true;
  ELSIF value->>'kind'='interval' THEN
    IF NOT (value ?& ARRAY['kind','from','to']) OR value - ARRAY['kind','from','to'] <> '{}'::jsonb THEN RETURN false; END IF;
    a := value->'from'; b := value->'to';
    IF a='null'::jsonb AND b='null'::jsonb THEN RETURN false; END IF;
    IF (a<>'null'::jsonb AND (a->>'kind' IS DISTINCT FROM 'point' OR NOT ingest.crv_date_value_valid(a)))
      OR (b<>'null'::jsonb AND (b->>'kind' IS DISTINCT FROM 'point' OR NOT ingest.crv_date_value_valid(b))) THEN RETURN false; END IF;
    IF a<>'null'::jsonb AND b<>'null'::jsonb AND a->>'approximate'='false' AND b->>'approximate'='false' THEN
      first_date := make_date((a->>'year')::integer,coalesce((a->>'month')::integer,1),coalesce((a->>'day')::integer,1));
      last_date := CASE WHEN b->'day'<>'null'::jsonb THEN make_date((b->>'year')::integer,(b->>'month')::integer,(b->>'day')::integer)
        ELSE (make_date((b->>'year')::integer,coalesce((b->>'month')::integer,12),1)+interval '1 month'-interval '1 day')::date END;
      IF first_date>last_date THEN RETURN false; END IF;
    END IF;
    RETURN true;
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION ingest.crv_fact_value_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.value_type='date' AND NOT ingest.crv_date_value_valid(NEW.value))
    OR (NEW.period IS NOT NULL AND NOT ingest.crv_date_value_valid(NEW.period)) THEN
    RAISE EXCEPTION 'fact date or period does not preserve valid calendar precision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION ingest.crv_fact_binding_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; BEGIN
  SELECT subject_kind INTO kind FROM ingest.catalog_facts WHERE id=NEW.fact_id;
  IF (to_jsonb(NEW)->>(kind || '_id')) IS NULL THEN
    RAISE EXCEPTION 'fact binding does not match its subject kind' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['evidence_documents','evidence_reads','evidence_fragments','catalog_facts','catalog_fact_evidence'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS crv_evidence_immutable ON ingest.%I',name);
    EXECUTE format('CREATE TRIGGER crv_evidence_immutable BEFORE UPDATE OR DELETE ON ingest.%I FOR EACH ROW EXECUTE FUNCTION ingest.crv_evidence_immutable()',name);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS crv_evidence_fragment_check ON ingest.evidence_fragments;
CREATE TRIGGER crv_evidence_fragment_check BEFORE INSERT ON ingest.evidence_fragments FOR EACH ROW EXECUTE FUNCTION ingest.crv_evidence_fragment_check();
DROP TRIGGER IF EXISTS crv_fact_value_check ON ingest.catalog_facts;
CREATE TRIGGER crv_fact_value_check BEFORE INSERT ON ingest.catalog_facts FOR EACH ROW EXECUTE FUNCTION ingest.crv_fact_value_check();
DROP TRIGGER IF EXISTS crv_fact_verified_check ON ingest.catalog_facts;
CREATE CONSTRAINT TRIGGER crv_fact_verified_check AFTER INSERT ON ingest.catalog_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ingest.crv_fact_verified_check();
DROP TRIGGER IF EXISTS crv_fact_binding_check ON ingest.catalog_fact_bindings;
CREATE TRIGGER crv_fact_binding_check BEFORE INSERT OR UPDATE ON ingest.catalog_fact_bindings FOR EACH ROW EXECUTE FUNCTION ingest.crv_fact_binding_check();

INSERT INTO ingest.change_journal_tables(table_name,mode,policy)
VALUES ('ingest.catalog_fact_bindings','full','strict')
ON CONFLICT (table_name) DO UPDATE SET mode=EXCLUDED.mode,policy=EXCLUDED.policy;
SELECT ingest.crv_journal_attach('ingest.catalog_fact_bindings'::regclass,'full');

COMMIT;
