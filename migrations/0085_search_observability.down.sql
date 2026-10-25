DROP TRIGGER search_preserve_emotion_decision ON public.entity_user_tags;
DROP FUNCTION ingest.search_preserve_emotion_decision();
-- Export analytics first if retained history is required.
DROP TABLE ingest.search_attempts;
DROP TABLE ingest.search_operations;
DROP TABLE ingest.search_daily;
