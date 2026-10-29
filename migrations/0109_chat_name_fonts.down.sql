BEGIN;
DELETE FROM chat.equipped WHERE slot = 'name_font';
DELETE FROM chat.effects WHERE kind = 'name_font';
ALTER TABLE chat.equipped DROP CONSTRAINT equipped_slot_chk;
ALTER TABLE chat.equipped ADD CONSTRAINT equipped_slot_chk
  CHECK (slot IN ('name', 'frame', 'entry', 'message', 'action', 'sticker', 'background', 'ambient'));
ALTER TABLE chat.effects DROP CONSTRAINT effects_kind_chk;
ALTER TABLE chat.effects ADD CONSTRAINT effects_kind_chk
  CHECK (kind IN ('name', 'frame', 'entry', 'message', 'action', 'sticker', 'background', 'ambient'));
COMMIT;
