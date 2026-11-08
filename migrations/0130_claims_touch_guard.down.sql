-- CRV · Migración 0130_claims_touch_guard (DOWN)
DROP TRIGGER IF EXISTS crv_skip_touch_only ON ingest.claims;
DROP FUNCTION IF EXISTS ingest.crv_skip_touch_only();
CREATE INDEX IF NOT EXISTS er_decisions_input_idx
  ON ingest.entity_resolution_decisions (entity_kind, input_name_normalized, created_at DESC);
