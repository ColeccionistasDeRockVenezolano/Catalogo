BEGIN;
-- El esquema anterior no admite claves iguales entre actores: comprobarlo
-- antes de retirar recibos, nunca borrar movimientos para poder revertir.
ALTER TABLE chat.ledger ADD CONSTRAINT ledger_idempotency_key_key UNIQUE (idempotency_key);
ALTER TABLE chat.ledger DROP CONSTRAINT ledger_actor_key_uq;
DROP TABLE chat.purchases;
DROP TABLE chat.daily_covers;
DROP INDEX chat.messages_retention_idx;
COMMIT;
