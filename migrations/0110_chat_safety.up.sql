BEGIN;
-- Chat de CRV, etapa 1 del plan de apertura: blindaje antes de abrir al público.
-- Revocación de tokens, silencios y baneos, rastro de conexión (IP, navegador,
-- huella), modo lento por sala, reportes y auditoría de moderación.
-- Ver docs/CHAT.md §«Seguridad y moderación».

-- ── Actores: revocación, sanciones y procedencia ───────────────────────────
-- token_version entra en la firma del token: subirla invalida todos los
-- tokens emitidos (baneo, «cerrar sesiones»). muted_until silencia sin echar.
ALTER TABLE chat.actors
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS muted_until   timestamptz,
  ADD COLUMN IF NOT EXISTS banned_at     timestamptz,
  ADD COLUMN IF NOT EXISTS ban_reason    text,
  ADD COLUMN IF NOT EXISTS created_ip    text,
  ADD COLUMN IF NOT EXISTS created_ua    text,
  ADD COLUMN IF NOT EXISTS created_fp    text,
  ADD COLUMN IF NOT EXISTS last_ip       text,
  ADD COLUMN IF NOT EXISTS last_fp       text;
CREATE INDEX IF NOT EXISTS actors_created_ip_idx ON chat.actors (created_ip, created_at DESC)
  WHERE created_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS actors_created_fp_idx ON chat.actors (created_fp, created_at DESC)
  WHERE created_fp IS NOT NULL;
-- La limpieza de invitados vacíos recorre por antigüedad de la última visita.
CREATE INDEX IF NOT EXISTS actors_guest_seen_idx ON chat.actors (last_seen_at)
  WHERE kind = 'guest' AND claimed_user_id IS NULL;

-- ── Mensajes: procedencia y estado de moderación ───────────────────────────
-- moderation: NULL limpio; 'masked' con palabras enmascaradas; 'review' en
-- revisión (dudoso); 'hidden' oculto por IA, reportes o un moderador.
ALTER TABLE chat.messages
  ADD COLUMN IF NOT EXISTS ip          text,
  ADD COLUMN IF NOT EXISTS user_agent  text,
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS moderation  text,
  ADD COLUMN IF NOT EXISTS ai_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  text;
ALTER TABLE chat.messages DROP CONSTRAINT IF EXISTS messages_moderation_chk;
ALTER TABLE chat.messages ADD CONSTRAINT messages_moderation_chk
  CHECK (moderation IS NULL OR moderation IN ('masked', 'review', 'hidden'));
-- Cola de la clasificación con IA: mensajes de chat aún sin revisar.
CREATE INDEX IF NOT EXISTS messages_ai_pending_idx ON chat.messages (id)
  WHERE ai_checked_at IS NULL AND kind = 'chat' AND deleted_at IS NULL;

-- ── Salas: modo lento ──────────────────────────────────────────────────────
ALTER TABLE chat.rooms
  ADD COLUMN IF NOT EXISTS slow_mode_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE chat.rooms DROP CONSTRAINT IF EXISTS rooms_slow_mode_chk;
ALTER TABLE chat.rooms ADD CONSTRAINT rooms_slow_mode_chk
  CHECK (slow_mode_seconds BETWEEN 0 AND 3600);

-- ── Baneos por IP ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat.ip_bans (
  ip          text PRIMARY KEY,
  reason      text NOT NULL DEFAULT '',
  actor_id    uuid REFERENCES chat.actors(id) ON DELETE SET NULL,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);

-- ── Reportes: de usuarios, de la IA y del detector ─────────────────────────
CREATE TABLE IF NOT EXISTS chat.reports (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       text NOT NULL
                 CONSTRAINT reports_source_chk CHECK (source IN ('user', 'ai', 'detector', 'filter')),
  status       text NOT NULL DEFAULT 'open'
                 CONSTRAINT reports_status_chk CHECK (status IN ('open', 'dismissed', 'actioned')),
  message_id   bigint REFERENCES chat.messages(id) ON DELETE CASCADE,
  target_actor uuid REFERENCES chat.actors(id) ON DELETE SET NULL,
  reporter     uuid REFERENCES chat.actors(id) ON DELETE SET NULL,
  reason       text NOT NULL DEFAULT '',
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  text
);
CREATE INDEX IF NOT EXISTS reports_open_idx ON chat.reports (created_at DESC) WHERE status = 'open';
-- Un usuario reporta un mensaje una sola vez.
CREATE UNIQUE INDEX IF NOT EXISTS reports_user_once_uq ON chat.reports (message_id, reporter)
  WHERE source = 'user';

-- ── Auditoría de moderación ────────────────────────────────────────────────
-- Toda acción (manual o automática) deja fila: quién, sobre quién, por qué.
CREATE TABLE IF NOT EXISTS chat.moderation_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action       text NOT NULL
                 CONSTRAINT moderation_action_chk CHECK (action IN (
                   'delete', 'restore', 'mute', 'unmute', 'kick', 'ban', 'unban',
                   'ip_ban', 'ip_unban', 'slow_mode', 'report_resolve', 'auto_mute', 'auto_hide')),
  moderator    text NOT NULL,
  target_actor uuid REFERENCES chat.actors(id) ON DELETE SET NULL,
  message_id   bigint REFERENCES chat.messages(id) ON DELETE SET NULL,
  ip           text,
  reason       text NOT NULL DEFAULT '',
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_log_created_idx ON chat.moderation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_log_target_idx ON chat.moderation_log (target_actor, created_at DESC);
COMMIT;
