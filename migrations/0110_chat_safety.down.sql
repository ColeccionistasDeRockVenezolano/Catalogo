BEGIN;
DROP TABLE IF EXISTS chat.moderation_log;
DROP TABLE IF EXISTS chat.reports;
DROP TABLE IF EXISTS chat.ip_bans;
ALTER TABLE chat.rooms DROP CONSTRAINT IF EXISTS rooms_slow_mode_chk;
ALTER TABLE chat.rooms DROP COLUMN IF EXISTS slow_mode_seconds;
DROP INDEX IF EXISTS chat.messages_ai_pending_idx;
ALTER TABLE chat.messages DROP CONSTRAINT IF EXISTS messages_moderation_chk;
ALTER TABLE chat.messages
  DROP COLUMN IF EXISTS ip,
  DROP COLUMN IF EXISTS user_agent,
  DROP COLUMN IF EXISTS fingerprint,
  DROP COLUMN IF EXISTS moderation,
  DROP COLUMN IF EXISTS ai_checked_at,
  DROP COLUMN IF EXISTS deleted_by;
DROP INDEX IF EXISTS chat.actors_guest_seen_idx;
DROP INDEX IF EXISTS chat.actors_created_fp_idx;
DROP INDEX IF EXISTS chat.actors_created_ip_idx;
ALTER TABLE chat.actors
  DROP COLUMN IF EXISTS token_version,
  DROP COLUMN IF EXISTS muted_until,
  DROP COLUMN IF EXISTS banned_at,
  DROP COLUMN IF EXISTS ban_reason,
  DROP COLUMN IF EXISTS created_ip,
  DROP COLUMN IF EXISTS created_ua,
  DROP COLUMN IF EXISTS created_fp,
  DROP COLUMN IF EXISTS last_ip,
  DROP COLUMN IF EXISTS last_fp;
COMMIT;
