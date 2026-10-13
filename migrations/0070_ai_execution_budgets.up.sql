BEGIN;
CREATE TABLE ingest.ai_execution_budgets (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 100),
 max_micro_usd BIGINT NOT NULL CHECK(max_micro_usd>0),
 max_calls INTEGER NOT NULL CHECK(max_calls>0),
 max_tokens BIGINT NOT NULL CHECK(max_tokens>0),
 max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK(max_concurrency>0),
 prices JSONB NOT NULL,
 authorized_by TEXT NOT NULL CHECK(length(btrim(authorized_by))>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ingest.ai_budget_reservations (
 id UUID PRIMARY KEY,
 budget_id TEXT NOT NULL REFERENCES ingest.ai_execution_budgets(id),
 model TEXT NOT NULL,task_kind TEXT NOT NULL,prompt_hash TEXT NOT NULL,
 reserved_micro_usd BIGINT NOT NULL CHECK(reserved_micro_usd>=0),
 charged_micro_usd BIGINT NOT NULL CHECK(charged_micro_usd>=0),
 reserved_tokens BIGINT NOT NULL CHECK(reserved_tokens>=0),
 charged_tokens BIGINT NOT NULL CHECK(charged_tokens>=0),
 tokens_in BIGINT,tokens_out BIGINT,
 state TEXT NOT NULL CHECK(state IN ('reserved','settled','uncertain')),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),settled_at TIMESTAMPTZ
);
CREATE INDEX ai_budget_reservations_budget ON ingest.ai_budget_reservations(budget_id,state);
COMMIT;
