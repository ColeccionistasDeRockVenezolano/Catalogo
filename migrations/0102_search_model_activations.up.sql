BEGIN;
-- Etapa 3 del buscador: registro atribuido y reversible de los modelos de Laya
-- activados por tarea. Solo se agregan filas; desactivar es otra fila. Activar
-- no publica nada en el buscador público: la etapa 4 decide su uso.
CREATE TABLE ingest.search_model_activations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 task text NOT NULL CHECK(task IN ('query_interpretation','evidence_typed_decision','claim_extraction')),
 action text NOT NULL CHECK(action IN ('activate','deactivate')),
 model_id text NOT NULL CHECK(model_id ~ '^[a-z0-9][a-z0-9.-]{1,80}$'),
 base_revision char(40) NOT NULL CHECK(base_revision ~ '^[a-f0-9]{40}$'),
 weights_sha256 char(64) CHECK(weights_sha256 ~ '^[a-f0-9]{64}$'),
 card jsonb NOT NULL CHECK(jsonb_typeof(card)='object'),
 evaluation_path text NOT NULL CHECK(length(btrim(evaluation_path))>0),
 evaluation_sha256 char(64) NOT NULL CHECK(evaluation_sha256 ~ '^[a-f0-9]{64}$'),
 criteria_version text NOT NULL CHECK(length(btrim(criteria_version))>0),
 passed boolean NOT NULL,
 actor text NOT NULL CHECK(length(btrim(actor))>0),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 run_id bigint NOT NULL REFERENCES ingest.scrape_runs(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 -- Una tarea que no cumple sus umbrales no se activa.
 CHECK(action='deactivate' OR passed)
);
CREATE INDEX search_model_activations_task ON ingest.search_model_activations(task,id DESC);

CREATE FUNCTION ingest.crv_search_model_activations_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'El registro de activaciones solo admite filas nuevas; para revertir, registrar una desactivación';
END $$;
CREATE TRIGGER search_model_activations_append_only BEFORE UPDATE OR DELETE ON ingest.search_model_activations
 FOR EACH ROW EXECUTE FUNCTION ingest.crv_search_model_activations_append_only();

-- Modelo vigente por tarea: la última fila decide; una desactivación deja la tarea sin modelo.
CREATE VIEW ingest.search_model_active AS
 SELECT * FROM (SELECT DISTINCT ON (task) task,action,model_id,base_revision,weights_sha256,evaluation_path,evaluation_sha256,criteria_version,actor,reason,run_id,created_at,id
   FROM ingest.search_model_activations ORDER BY task,id DESC) last
 WHERE action='activate';
COMMIT;
