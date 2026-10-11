BEGIN;
CREATE SCHEMA IF NOT EXISTS crv_evidence_archive;
CREATE TABLE IF NOT EXISTS crv_evidence_archive.person_date_precision (
 id bigint PRIMARY KEY, birth_date date, death_date date, birth_date_value text, death_date_value text
);
INSERT INTO crv_evidence_archive.person_date_precision SELECT id,birth_date,death_date,birth_date_value,death_date_value FROM public.persons
 ON CONFLICT(id) DO UPDATE SET birth_date=EXCLUDED.birth_date,death_date=EXCLUDED.death_date,
 birth_date_value=EXCLUDED.birth_date_value,death_date_value=EXCLUDED.death_date_value;
DROP TRIGGER crv_person_date_precision ON public.persons;
ALTER TABLE public.persons DROP COLUMN birth_date_value, DROP COLUMN death_date_value;
DROP FUNCTION ingest.crv_person_date_precision();
DROP FUNCTION ingest.crv_date_boundary(jsonb,boolean);
DROP FUNCTION ingest.crv_exact_date_text(text);
DROP FUNCTION ingest.crv_parse_date_text(text);
COMMIT;
