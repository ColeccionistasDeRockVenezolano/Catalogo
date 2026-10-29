BEGIN;
ALTER TABLE chat.effects DROP CONSTRAINT effects_kind_chk;
ALTER TABLE chat.effects ADD CONSTRAINT effects_kind_chk CHECK (kind IN
  ('name','frame','entry','message','action','sticker','background','ambient','name_font','badge'));
ALTER TABLE chat.equipped DROP CONSTRAINT equipped_slot_chk;
ALTER TABLE chat.equipped ADD CONSTRAINT equipped_slot_chk CHECK (slot IN
  ('name','frame','background','ambient','name_font','badge'));
COMMIT;
