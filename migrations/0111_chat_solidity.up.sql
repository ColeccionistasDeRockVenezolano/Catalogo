BEGIN;
-- La misma clave pertenece a un actor, nunca a toda la comunidad.
ALTER TABLE chat.ledger DROP CONSTRAINT ledger_idempotency_key_key;
ALTER TABLE chat.ledger ADD CONSTRAINT ledger_actor_key_uq UNIQUE (actor_id, idempotency_key);

-- También las adquisiciones gratuitas necesitan un recibo idempotente.
CREATE TABLE chat.purchases (
  actor_id uuid NOT NULL REFERENCES chat.actors(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  effect_code text NOT NULL,
  effect_name text NOT NULL,
  rented_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, idempotency_key)
);
INSERT INTO chat.purchases (actor_id, idempotency_key, effect_code, effect_name, rented_until, created_at)
SELECT l.actor_id, l.idempotency_key, e.code, e.name, i.expires_at, l.created_at
FROM chat.ledger l JOIN chat.effects e ON e.code = l.ref
LEFT JOIN chat.effect_inventory i ON i.actor_id = l.actor_id AND i.effect_id = e.id
WHERE l.reason = 'purchase' AND l.idempotency_key IS NOT NULL;

-- Guardar la elección del ciclo evita cambiarla al crecer el catálogo.
CREATE TABLE chat.daily_covers (
  cycle_date date PRIMARY KEY,
  album_id bigint NOT NULL,
  title text NOT NULL,
  artist text NOT NULL,
  cover_url text NOT NULL
);
CREATE INDEX messages_retention_idx ON chat.messages (created_at, id);
COMMIT;
