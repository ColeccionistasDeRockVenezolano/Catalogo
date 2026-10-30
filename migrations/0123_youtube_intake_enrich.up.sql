-- 0123 · Segunda pasada de la IA para el video ya enlazado.
--
-- El alta del disco se prepara con la evidencia del video. Cuando esa
-- propuesta se aplica y el video queda enlazado, se lanza una segunda
-- propuesta (investigación de fuentes) para completar la ficha del artista.
-- Aquí se guarda cuál es, para mostrarla en el espacio de YouTube y no
-- duplicarla en cada pasada.

ALTER TABLE ingest.youtube_intake
  ADD COLUMN IF NOT EXISTS enrich_plan_id bigint REFERENCES ingest.ai_curation_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS youtube_intake_enrich_plan_idx ON ingest.youtube_intake(enrich_plan_id);
