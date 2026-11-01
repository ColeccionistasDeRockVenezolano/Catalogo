-- 0118 · Regla de autocorrección para descartes automáticos de la IA.
--
-- Nace APAGADA: el interruptor maestro `CRV_CURATION_AUTOFIX` también está
-- apagado por defecto. Un administrador debe encenderla desde Curaduría. La
-- acción `descartar_duplicado_ia` vuelve a comprobar en cada ejecución que el
-- veredicto sea `distinct` ≥0,95, sin dudas y sin revisión abierta.

INSERT INTO ingest.curation_autofix_rules(detector, signature, action_key, enabled, note, created_by)
SELECT 'artistas_duplicados_evidencia', NULL, 'descartar_duplicado_ia', false,
       'Descartes automáticos solo con veredicto IA distinct ≥0,95 y sin dudas', 'migration'
WHERE NOT EXISTS (
  SELECT 1 FROM ingest.curation_autofix_rules
   WHERE detector='artistas_duplicados_evidencia' AND action_key='descartar_duplicado_ia'
);
