BEGIN;
-- Monedas (etapa E2). Dos saldos desde el primer día: `coins` se gana
-- (curación, actividad) y `credits` se compra. Hoy credits siempre vale 0 y
-- solo un administrador lo acredita; cuando exista pasarela, el cobro solo
-- inserta una entrada en el libro mayor, sin tocar el resto del sistema.
CREATE TABLE IF NOT EXISTS chat.accounts (
  actor_id   uuid PRIMARY KEY REFERENCES chat.actors(id) ON DELETE CASCADE,
  coins      bigint NOT NULL DEFAULT 0 CONSTRAINT accounts_coins_chk CHECK (coins >= 0),
  credits    bigint NOT NULL DEFAULT 0 CONSTRAINT accounts_credits_chk CHECK (credits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Libro mayor de doble entrada. Nunca se actualiza un saldo sin dejar la
-- entrada correspondiente, y `idempotency_key` evita duplicar monedas por
-- reintentos o doble clic.
CREATE TABLE IF NOT EXISTS chat.ledger (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id        uuid NOT NULL REFERENCES chat.actors(id) ON DELETE CASCADE,
  delta_coins     bigint NOT NULL DEFAULT 0,
  delta_credits   bigint NOT NULL DEFAULT 0,
  reason          text NOT NULL
                    CONSTRAINT ledger_reason_chk CHECK (reason IN
                      ('grant','purchase','refund','reward','migration')),
  ref             text,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_delta_chk CHECK (delta_coins <> 0 OR delta_credits <> 0)
);
CREATE INDEX IF NOT EXISTS ledger_actor_idx ON chat.ledger (actor_id, id DESC);
COMMIT;
