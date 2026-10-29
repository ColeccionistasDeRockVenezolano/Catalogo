BEGIN;
-- Catálogo de efectos (etapa E1). Cada efecto es un manifiesto declarativo:
-- capas, disparadores y coste. El cliente implementa unos pocos renderers y
-- el catálogo crece sin tocar el cliente (effects-as-data).
CREATE TABLE IF NOT EXISTS chat.effects (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE
                  CONSTRAINT effects_code_chk CHECK (code ~ '^[a-z0-9-]{2,40}$'),
  name          text NOT NULL,
  kind          text NOT NULL
                  CONSTRAINT effects_kind_chk CHECK (kind IN
                    ('name','frame','entry','message','action','sticker','background','ambient')),
  description   text NOT NULL DEFAULT '',
  manifest      jsonb NOT NULL,
  price_coins   integer NOT NULL DEFAULT 0 CONSTRAINT effects_price_coins_chk CHECK (price_coins >= 0),
  price_credits integer NOT NULL DEFAULT 0 CONSTRAINT effects_price_credits_chk CHECK (price_credits >= 0),
  duration_days integer CONSTRAINT effects_duration_chk CHECK (duration_days IS NULL OR duration_days > 0),
  enabled       boolean NOT NULL DEFAULT true,
  sort          integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS effects_kind_idx ON chat.effects (kind, sort);

CREATE TABLE IF NOT EXISTS chat.effect_inventory (
  actor_id    uuid NOT NULL REFERENCES chat.actors(id) ON DELETE CASCADE,
  effect_id   integer NOT NULL REFERENCES chat.effects(id) ON DELETE CASCADE,
  qty         integer NOT NULL DEFAULT 1 CONSTRAINT inventory_qty_chk CHECK (qty >= 0),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  PRIMARY KEY (actor_id, effect_id)
);

-- Ranura equipada por actor. Una por slot (name, frame, entry…). El efecto
-- solo se pinta si sigue en el inventario y no ha caducado.
CREATE TABLE IF NOT EXISTS chat.equipped (
  actor_id  uuid NOT NULL REFERENCES chat.actors(id) ON DELETE CASCADE,
  slot      text NOT NULL
              CONSTRAINT equipped_slot_chk CHECK (slot IN
                ('name','frame','entry','message','action','sticker','background','ambient')),
  effect_id integer NOT NULL REFERENCES chat.effects(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, slot)
);
COMMIT;
