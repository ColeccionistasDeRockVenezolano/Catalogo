DELETE FROM ingest.curation_autofix_rules
 WHERE detector='artistas_duplicados_evidencia' AND action_key='descartar_duplicado_ia'
   AND created_by='migration';
