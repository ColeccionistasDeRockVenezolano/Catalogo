-- Human evaluation of the stage-2 study and editorial adjudication of RYM→CRV
-- mappings. Brian's decisions live here; analyst files stay proposals.
CREATE TABLE ingest.search_human_evaluations (
 annotation_id text NOT NULL CHECK(length(trim(annotation_id))>0),
 evaluator text NOT NULL CHECK(length(trim(evaluator))>0),
 study_version text NOT NULL CHECK(length(trim(study_version))>0),
 quote_sha256 char(64) NOT NULL CHECK(quote_sha256 ~ '^[a-f0-9]{64}$'),
 -- First pass without seeing the analyst's annotation.
 blind jsonb NOT NULL CHECK(jsonb_typeof(blind)='object'),
 blind_at timestamptz NOT NULL DEFAULT now(),
 -- Second pass after the annotation is revealed.
 verdict text CHECK(verdict IN ('supported','appreciation_error','scope_error','unsupported_generalization','other_error')),
 note text NOT NULL DEFAULT '',
 verdict_at timestamptz,
 CHECK((verdict IS NULL)=(verdict_at IS NULL)),
 PRIMARY KEY(annotation_id,evaluator)
);
CREATE TABLE ingest.search_mapping_adjudications (
 original_term text PRIMARY KEY CHECK(length(trim(original_term))>0),
 review_version text NOT NULL,
 proposed_slug text,
 proposed_relation text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approved','corrected','rejected')),
 target_slug text,
 relation text CHECK(relation IN ('equivalence','specialization','partial','pending')),
 note text NOT NULL DEFAULT '',
 decided_by text NOT NULL CHECK(length(trim(decided_by))>0),
 decided_at timestamptz NOT NULL DEFAULT now(),
 CHECK(decision<>'corrected' OR relation IS NOT NULL)
);
