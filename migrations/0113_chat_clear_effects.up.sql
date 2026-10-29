BEGIN;
-- Retirada completa del catálogo anterior, solicitada por Brian.
-- ON DELETE CASCADE elimina también posesiones y ranuras equipadas.
-- Se conservan saldos, movimientos, recibos y mensajes del chat.
DELETE FROM chat.effects;
COMMIT;
