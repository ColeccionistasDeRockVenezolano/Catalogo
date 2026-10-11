BEGIN;

-- The legacy DATE columns remain exact-day projections. No old day is reinterpreted.
CREATE OR REPLACE FUNCTION ingest.crv_parse_date_text(input text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parts text[]; p text; m text[]; points jsonb[] := '{}'; v jsonb;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  parts := string_to_array(input, '/');
  IF cardinality(parts) NOT IN (1,2) THEN RAISE EXCEPTION 'invalid date interval' USING ERRCODE='23514'; END IF;
  FOREACH p IN ARRAY parts LOOP
    IF p='' AND cardinality(parts)=2 THEN points := array_append(points,'null'::jsonb); CONTINUE; END IF;
    m := regexp_match(p, '^(~)?([0-9]{4})(-([0-9]{2}))?(-([0-9]{2}))?$');
    IF m IS NULL THEN RAISE EXCEPTION 'invalid date precision' USING ERRCODE='23514'; END IF;
    v := jsonb_build_object('kind','point','year',m[2]::integer,'month',m[4]::integer,'day',m[6]::integer,
      'precision',CASE WHEN m[6] IS NOT NULL THEN 'day' WHEN m[4] IS NOT NULL THEN 'month' ELSE 'year' END,
      'approximate',m[1] IS NOT NULL);
    points := array_append(points,v);
  END LOOP;
  v := CASE WHEN cardinality(parts)=1 THEN points[1] ELSE jsonb_build_object('kind','interval','from',points[1],'to',points[2]) END;
  IF NOT ingest.crv_date_value_valid(v) THEN RAISE EXCEPTION 'invalid calendar date' USING ERRCODE='23514'; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION ingest.crv_exact_date_text(input text) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN input ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN input::date END
$$;

-- Bounds are used only to reject provably reversed chronology, never as stored dates.
CREATE OR REPLACE FUNCTION ingest.crv_date_boundary(v jsonb, last_day boolean) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE p jsonb; m integer; BEGIN
 p:=CASE WHEN v->>'kind'='interval' THEN CASE WHEN last_day THEN v->'to' ELSE v->'from' END ELSE v END;
 IF p IS NULL OR p='null'::jsonb OR p->>'approximate'='true' THEN RETURN NULL; END IF;
 m:=coalesce((p->>'month')::integer,CASE WHEN last_day THEN 12 ELSE 1 END);
 IF last_day AND p->'day'='null'::jsonb THEN
  RETURN (make_date((p->>'year')::integer,m,1)+interval '1 month'-interval '1 day')::date;
 END IF;
 RETURN make_date((p->>'year')::integer,m,coalesce((p->>'day')::integer,1));
END $$;

ALTER TABLE public.persons ADD COLUMN birth_date_value text, ADD COLUMN death_date_value text;
UPDATE public.persons SET birth_date_value=birth_date::text, death_date_value=death_date::text;

-- A rollback parks precision. Reapply refuses to overwrite a legacy edit made meanwhile.
DO $$ BEGIN
 IF to_regclass('crv_evidence_archive.person_date_precision') IS NOT NULL THEN
   IF EXISTS (SELECT 1 FROM public.persons p JOIN crv_evidence_archive.person_date_precision a ON a.id=p.id
     WHERE p.birth_date IS DISTINCT FROM a.birth_date OR p.death_date IS DISTINCT FROM a.death_date) THEN
     RAISE EXCEPTION 'person dates changed after rollback; reconcile archived precision first';
   END IF;
   UPDATE public.persons p SET birth_date_value=a.birth_date_value,death_date_value=a.death_date_value
     FROM crv_evidence_archive.person_date_precision a WHERE a.id=p.id;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION ingest.crv_person_date_precision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   NEW.birth_date_value := coalesce(NEW.birth_date_value,NEW.birth_date::text);
   NEW.death_date_value := coalesce(NEW.death_date_value,NEW.death_date::text);
 ELSE
   IF NEW.birth_date_value IS NOT DISTINCT FROM OLD.birth_date_value AND NEW.birth_date IS DISTINCT FROM OLD.birth_date THEN
     NEW.birth_date_value := NEW.birth_date::text;
   END IF;
   IF NEW.death_date_value IS NOT DISTINCT FROM OLD.death_date_value AND NEW.death_date IS DISTINCT FROM OLD.death_date THEN
     NEW.death_date_value := NEW.death_date::text;
   END IF;
 END IF;
 PERFORM ingest.crv_parse_date_text(NEW.birth_date_value), ingest.crv_parse_date_text(NEW.death_date_value);
 IF ingest.crv_date_boundary(ingest.crv_parse_date_text(NEW.death_date_value),true)
    < ingest.crv_date_boundary(ingest.crv_parse_date_text(NEW.birth_date_value),false) THEN
   RAISE EXCEPTION 'death is definitely before birth' USING ERRCODE='23514';
 END IF;
 NEW.birth_date := ingest.crv_exact_date_text(NEW.birth_date_value);
 NEW.death_date := ingest.crv_exact_date_text(NEW.death_date_value);
 RETURN NEW;
END $$;
CREATE TRIGGER crv_person_date_precision BEFORE INSERT OR UPDATE ON public.persons
 FOR EACH ROW EXECUTE FUNCTION ingest.crv_person_date_precision();

COMMIT;
