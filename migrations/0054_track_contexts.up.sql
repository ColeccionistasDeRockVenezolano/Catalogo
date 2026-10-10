BEGIN;
-- Versioned, deliberately bounded vocabulary. These are criteria, not track facts.
CREATE TABLE IF NOT EXISTS ingest.track_context_labels (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 slug TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK (kind IN ('context','mood','energy')),
 name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK (length(trim(definition))>0),
 criterion TEXT NOT NULL CHECK (length(trim(criterion))>0),
 ontology_version TEXT NOT NULL CHECK (length(trim(ontology_version))>0)
);
INSERT INTO ingest.track_context_labels(slug,kind,name,definition,criterion,ontology_version) VALUES
 ('concentration','context','Concentración','Acompañamiento percibido para tareas de atención sostenida.','Revisión de la pista completa o descripción específica; justificar interferencia, regularidad y presencia vocal.','crv-contexts-v1'),
 ('relaxation','context','Relajación','Acompañamiento percibido para un momento de descanso.','Revisión específica que documente calma y ausencia de tensión dominante; no inferir del género.','crv-contexts-v1'),
 ('celebration','context','Celebración','Acompañamiento percibido para una reunión festiva.','Documentar carácter festivo y pulso en esta versión; no inferir de popularidad ni del título.','crv-contexts-v1'),
 ('joyful','mood','Alegre','Carácter musical percibido de alegría.','Justificar el carácter dominante con observaciones específicas; una letra o tonalidad aislada no basta.','crv-contexts-v1'),
 ('melancholic','mood','Melancólico','Carácter musical percibido de melancolía.','Documentar atmósfera e interpretación de esta pista; no constituye una emoción del oyente.','crv-contexts-v1'),
 ('tense','mood','Tenso','Carácter musical percibido de tensión.','Describir tensión sostenida o dominante y sus límites; no inferir de un género.','crv-contexts-v1'),
 ('serene','mood','Sereno','Carácter musical percibido de serenidad.','Documentar estabilidad y calma en la pista concreta; abstenerse ante evidencia insuficiente.','crv-contexts-v1'),
 ('energy-low','energy','Energía baja','Intensidad percibida baja, ordinal y editorial.','Aplicar perceived-energy-v1 con evidencia específica y tres ejes documentados.','crv-contexts-v1'),
 ('energy-medium','energy','Energía media','Intensidad percibida media, ordinal y editorial.','Aplicar perceived-energy-v1 con evidencia específica y tres ejes documentados.','crv-contexts-v1'),
 ('energy-high','energy','Energía alta','Intensidad percibida alta, ordinal y editorial.','Aplicar perceived-energy-v1 con evidencia específica y tres ejes documentados.','crv-contexts-v1')
 ON CONFLICT(slug) DO NOTHING;
-- The rubric also guards direct SQL writes and serving, not only the importer.
CREATE OR REPLACE FUNCTION ingest.track_context_energy_label(data JSONB) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE axis TEXT; ranks INTEGER[];
BEGIN
 IF jsonb_typeof(data)<>'object' OR data IS NULL THEN RETURN NULL; END IF;
 IF data->>'basis' IS NULL OR data->>'basis' NOT IN ('authorized-listening','reviewed-description') THEN RETURN NULL; END IF;
 FOREACH axis IN ARRAY ARRAY['reference','rightsBasis','observations'] LOOP
   IF jsonb_typeof(data->axis)<>'string' OR coalesce(length(trim(data->>axis)),0)=0 THEN RETURN NULL; END IF;
 END LOOP;
 FOREACH axis IN ARRAY ARRAY['activity','dynamics','density'] LOOP
   IF data->>axis IS NULL OR data->>axis NOT IN ('low','medium','high') THEN RETURN NULL; END IF;
 END LOOP;
 SELECT array_agg(n ORDER BY n) INTO ranks FROM unnest(ARRAY[
   array_position(ARRAY['low','medium','high'],data->>'activity'),
   array_position(ARRAY['low','medium','high'],data->>'dynamics'),
   array_position(ARRAY['low','medium','high'],data->>'density')]) n;
 RETURN 'energy-'||(ARRAY['low','medium','high'])[ranks[2]];
END $$;
CREATE TABLE IF NOT EXISTS ingest.track_context_proposals (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 import_key TEXT NOT NULL UNIQUE,
 track_id BIGINT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
 label_id BIGINT NOT NULL REFERENCES ingest.track_context_labels(id) ON DELETE RESTRICT,
 evidence_id BIGINT REFERENCES ingest.claim_evidence(id) ON DELETE RESTRICT,
 origin TEXT NOT NULL CHECK (origin IN ('human','algorithm')),
 proposer TEXT NOT NULL CHECK (length(trim(proposer))>0),
 model_name TEXT,
 model_version TEXT,
 generated_at TIMESTAMPTZ NOT NULL,
 confidence TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
 rationale TEXT NOT NULL CHECK (length(trim(rationale))>0),
 method_version TEXT NOT NULL CHECK (length(trim(method_version))>0),
 method_data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(method_data)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((method_version='context-editorial-v1' AND method_data='{}'::jsonb) OR
        (method_version='perceived-energy-v1' AND ingest.track_context_energy_label(method_data) IS NOT NULL AND origin='human' AND evidence_id IS NOT NULL)),
 CHECK ((origin='human' AND model_name IS NULL AND model_version IS NULL) OR
        (origin='algorithm' AND length(trim(model_name))>0 AND model_name IS NOT NULL AND length(trim(model_version))>0 AND model_version IS NOT NULL))
);
-- No unique(track_id,label_id): contradictory decisions must survive identity merges.
CREATE TABLE IF NOT EXISTS ingest.track_context_assignments (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 import_key TEXT NOT NULL UNIQUE,
 track_id BIGINT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
 label_id BIGINT NOT NULL REFERENCES ingest.track_context_labels(id) ON DELETE RESTRICT,
 proposal_id BIGINT REFERENCES ingest.track_context_proposals(id) ON DELETE RESTRICT,
 evidence_id BIGINT REFERENCES ingest.claim_evidence(id) ON DELETE RESTRICT,
 state TEXT NOT NULL CHECK (state IN ('approved','rejected','withdrawn')),
 confidence TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
 reviewer TEXT NOT NULL CHECK (length(trim(reviewer))>0),
 reason TEXT NOT NULL CHECK (length(trim(reason))>0),
 method_version TEXT NOT NULL CHECK (length(trim(method_version))>0),
 method_data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(method_data)='object'),
 valid_from TIMESTAMPTZ NOT NULL,
 valid_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((method_version='context-editorial-v1' AND method_data='{}'::jsonb) OR
        (method_version='perceived-energy-v1' AND ingest.track_context_energy_label(method_data) IS NOT NULL AND evidence_id IS NOT NULL)),
 CHECK (valid_until IS NULL OR valid_until>valid_from),
 CHECK (state<>'approved' OR evidence_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS ingest.track_context_evaluations (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 import_key TEXT NOT NULL UNIQUE,
 assignment_id BIGINT NOT NULL REFERENCES ingest.track_context_assignments(id) ON DELETE RESTRICT,
 assignment_snapshot JSONB NOT NULL CHECK (jsonb_typeof(assignment_snapshot)='object'),
 verdict TEXT NOT NULL CHECK (verdict IN ('relevant','irrelevant','uncertain')),
 reviewer TEXT NOT NULL CHECK (length(trim(reviewer))>0),
 reason TEXT NOT NULL CHECK (length(trim(reason))>0),
 evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS track_context_proposals_track_idx ON ingest.track_context_proposals(track_id,label_id);
CREATE INDEX IF NOT EXISTS track_context_proposals_label_idx ON ingest.track_context_proposals(label_id);
CREATE INDEX IF NOT EXISTS track_context_proposals_evidence_idx ON ingest.track_context_proposals(evidence_id);
CREATE INDEX IF NOT EXISTS track_context_assignments_track_idx ON ingest.track_context_assignments(track_id,label_id,state);
CREATE INDEX IF NOT EXISTS track_context_assignments_label_idx ON ingest.track_context_assignments(label_id);
CREATE INDEX IF NOT EXISTS track_context_assignments_proposal_idx ON ingest.track_context_assignments(proposal_id);
CREATE INDEX IF NOT EXISTS track_context_assignments_evidence_idx ON ingest.track_context_assignments(evidence_id);
CREATE INDEX IF NOT EXISTS track_context_evaluations_assignment_idx ON ingest.track_context_evaluations(assignment_id);
INSERT INTO ingest.change_journal_tables(table_name,mode,policy) VALUES
 ('ingest.track_context_labels','full','strict'),
 ('ingest.track_context_proposals','full','strict'),
 ('ingest.track_context_assignments','full','strict'),
 ('ingest.track_context_evaluations','full','strict')
 ON CONFLICT(table_name) DO NOTHING;
SELECT ingest.crv_journal_attach_all();
COMMIT;
