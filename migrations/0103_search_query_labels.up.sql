BEGIN;
-- Etapa 3 del buscador, versión 1.6.0 (decisión de Brian del 2026-10-25):
-- consultas reales etiquetadas por una persona. El lote vive en
-- docs/unified-search/stage3/datasets/query-real-labeling-*.json; aquí solo
-- queda la etiqueta humana, atribuida, en el mismo formato que los casos de
-- prueba. La página nunca muestra la lectura del sistema antes de etiquetar.
CREATE TABLE ingest.search_query_labels (
 item_id text NOT NULL CHECK(length(btrim(item_id))>0),
 labeler text NOT NULL CHECK(length(btrim(labeler))>0),
 batch_version text NOT NULL CHECK(length(btrim(batch_version))>0),
 text_sha256 char(64) NOT NULL CHECK(text_sha256 ~ '^[a-f0-9]{64}$'),
 -- 'labeled' trae la etiqueta; 'skipped' deja constancia de que no se supo etiquetar.
 outcome text NOT NULL CHECK(outcome IN ('labeled','skipped')),
 gold jsonb CHECK(gold IS NULL OR jsonb_typeof(gold)='object'),
 note text NOT NULL DEFAULT '',
 labeled_at timestamptz NOT NULL DEFAULT now(),
 CHECK((outcome='labeled')=(gold IS NOT NULL)),
 PRIMARY KEY(item_id,labeler)
);
COMMIT;
