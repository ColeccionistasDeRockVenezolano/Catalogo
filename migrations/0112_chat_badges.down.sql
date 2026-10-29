BEGIN;
-- Las placas vuelven a ser efectos de nombre; si el actor no llevaba otro
-- nombre, la placa vuelve a esa ranura.
INSERT INTO chat.equipped (actor_id, slot, effect_id, updated_at)
SELECT actor_id, 'name', effect_id, now() FROM chat.equipped WHERE slot = 'badge'
ON CONFLICT (actor_id, slot) DO NOTHING;
DELETE FROM chat.equipped WHERE slot = 'badge';
UPDATE chat.effects SET kind = 'name', updated_at = now() WHERE kind = 'badge';
ALTER TABLE chat.equipped DROP CONSTRAINT equipped_slot_chk;
ALTER TABLE chat.equipped ADD CONSTRAINT equipped_slot_chk
  CHECK (slot IN ('name', 'frame', 'background', 'ambient', 'name_font'));
ALTER TABLE chat.effects DROP CONSTRAINT effects_kind_chk;
ALTER TABLE chat.effects ADD CONSTRAINT effects_kind_chk
  CHECK (kind IN ('name', 'frame', 'entry', 'message', 'action', 'sticker', 'background', 'ambient', 'name_font'));
COMMIT;
