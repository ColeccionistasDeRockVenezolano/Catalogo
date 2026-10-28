BEGIN;
-- Chat de CRV (etapa E0): identidad por actor, salas y mensajes.
-- El actor es la identidad estable del chat: hoy un invitado con cookie
-- firmada, mañana la cuenta de CRV que lo reclame (claimed_user_id). Los
-- mensajes cuelgan del actor para que reclamar una cuenta no obligue a
-- reescribir el historial.
CREATE SCHEMA IF NOT EXISTS chat;

CREATE TABLE IF NOT EXISTS chat.actors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL DEFAULT 'guest'
                    CONSTRAINT actors_kind_chk CHECK (kind IN ('guest','member','system')),
  handle          text NOT NULL
                    CONSTRAINT actors_handle_chk CHECK (handle ~ '^[A-Za-z0-9_.-]{3,24}$'),
  display_name    text NOT NULL
                    CONSTRAINT actors_name_chk CHECK (char_length(display_name) BETWEEN 1 AND 40),
  avatar_seed     text NOT NULL DEFAULT 'crv',
  -- Cuenta futura de CRV que reclama este actor. Texto a propósito: la
  -- identidad pública de CRV aún no existe y no queremos atar el tipo.
  claimed_user_id text,
  is_bot          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS actors_handle_uq ON chat.actors (lower(handle));
CREATE INDEX IF NOT EXISTS actors_claimed_idx ON chat.actors (claimed_user_id)
  WHERE claimed_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat.rooms (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE
                CONSTRAINT rooms_slug_chk CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  theme       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

INSERT INTO chat.rooms (slug, name, description, theme)
VALUES (
  'general',
  'La Rockola',
  'La sala de la comunidad de Coleccionistas de Rock Venezolano.',
  '{"accent":"#e50914","coverEffect":"vinilo"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS chat.messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id     integer NOT NULL REFERENCES chat.rooms(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES chat.actors(id) ON DELETE SET NULL,
  body        text NOT NULL
                CONSTRAINT messages_body_chk CHECK (char_length(body) BETWEEN 1 AND 2000),
  kind        text NOT NULL DEFAULT 'chat'
                CONSTRAINT messages_kind_chk CHECK (kind IN ('chat','system','action','sticker')),
  effect_code text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS messages_room_idx ON chat.messages (room_id, id DESC);
CREATE INDEX IF NOT EXISTS messages_actor_idx ON chat.messages (actor_id, id DESC);
COMMIT;
