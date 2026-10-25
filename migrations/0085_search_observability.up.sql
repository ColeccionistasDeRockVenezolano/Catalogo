-- Analytics only. No change to public or legacy discovery/search_misses.
CREATE TABLE ingest.search_operations (
 search_id uuid PRIMARY KEY, confirmed_at timestamptz NOT NULL, editorial_date date NOT NULL,
 entry_point text NOT NULL, confirmation text NOT NULL, origin text NOT NULL,
 snapshot jsonb NOT NULL, attempt_at timestamptz NOT NULL,
 had_incident boolean NOT NULL, perceived_ms double precision,
 sample text, normalized text, fingerprint text, query_length integer NOT NULL,
 version text NOT NULL
);
CREATE INDEX search_operations_day_idx ON ingest.search_operations(editorial_date);
CREATE INDEX search_operations_samples_day_idx ON ingest.search_operations(editorial_date) WHERE sample IS NOT NULL;
CREATE INDEX search_operations_fingerprint_idx ON ingest.search_operations(fingerprint);
CREATE TABLE ingest.search_attempts (
 attempt_id uuid PRIMARY KEY, search_id uuid NOT NULL REFERENCES ingest.search_operations(search_id) ON DELETE CASCADE,
 received_at timestamptz NOT NULL, snapshot jsonb NOT NULL
);
CREATE INDEX search_attempts_search_idx ON ingest.search_attempts(search_id);
CREATE TABLE ingest.search_daily (
 editorial_date date PRIMARY KEY, totals jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 version text NOT NULL
);

-- Necessary public trigger: source/model SQL can bypass the API and carry stale
-- decision snapshots. Keep the existing table/IDs; overlay human authority at
-- write time and route contradictions into the existing review queue.
CREATE FUNCTION ingest.search_preserve_emotion_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d ingest.emotion_tag_decisions%ROWTYPE; case_key text;
BEGIN
 SELECT * INTO d FROM ingest.emotion_tag_decisions WHERE tag_key=lower(btrim(NEW.tag)) FOR SHARE;
 IF FOUND THEN
   IF NEW.emotions->>'categoria' IS NOT NULL AND NEW.emotions->>'categoria' IS DISTINCT FROM d.category THEN
     case_key := 'search-editorial:' || md5(d.tag_key || ':' || d.decided_at::text || ':' || coalesce(NEW.emotions->>'categoria','unknown'));
     PERFORM pg_advisory_xact_lock(hashtext(case_key));
     IF NOT EXISTS(SELECT 1 FROM ingest.review_queue WHERE payload->>'caseKey'=case_key) THEN
       INSERT INTO ingest.review_queue(kind,priority,artist_a_id,payload,notes)
       VALUES('manual_review',3,NEW.artist_id,
         jsonb_build_object('caseKey',case_key,'type','search_editorial_contradiction','tag',NEW.tag,
           'attempted',NEW.emotions,'decision',jsonb_build_object('category',d.category,'actor',d.decided_by,'at',d.decided_at,'note',d.note)),
         'Una predicción o fuente contradice una decisión humana vigente. Se conservó la decisión; revisar evidencia antes de cambiarla.');
     END IF;
   END IF;
   NEW.emotions := coalesce(NEW.emotions,'{}'::jsonb) || jsonb_build_object('categoria',d.category,'decision','editorial');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER search_preserve_emotion_decision BEFORE INSERT OR UPDATE ON public.entity_user_tags
 FOR EACH ROW EXECUTE FUNCTION ingest.search_preserve_emotion_decision();
