-- 0120 · Precedentes de los descartes que ya existían.
--
-- La tabla de feedback nació después de 1.259 descartes. Se copian una vez para
-- que el dosier de la IA ya tenga memoria de esas decisiones.
INSERT INTO ingest.curation_merge_feedback(kind,a_id,b_id,outcome,source,note)
SELECT d.kind, LEAST(d.a_id,d.b_id), GREATEST(d.a_id,d.b_id), 'distinct', 'human', left(d.note, 1500)
  FROM ingest.curation_distinct_pairs d
 WHERE NOT EXISTS (
   SELECT 1 FROM ingest.curation_merge_feedback f
    WHERE f.kind=d.kind AND f.a_id=LEAST(d.a_id,d.b_id) AND f.b_id=GREATEST(d.a_id,d.b_id)
      AND f.outcome='distinct' AND f.source='human' AND f.run_id IS NULL
 );
