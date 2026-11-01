DELETE FROM ingest.curation_merge_feedback
 WHERE source='human' AND outcome='distinct' AND run_id IS NULL;
