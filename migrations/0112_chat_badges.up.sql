BEGIN;
-- Las placas (objetos junto al nombre: vinilo, cassette, ampli…) dejan de ser
-- efectos de nombre y ocupan su propia ranura. Así se lleva a la vez una placa
-- y un efecto que pinta las letras (sangre + cassette, por ejemplo).
ALTER TABLE chat.equipped DROP CONSTRAINT equipped_slot_chk;
ALTER TABLE chat.equipped ADD CONSTRAINT equipped_slot_chk
  CHECK (slot IN ('name', 'frame', 'background', 'ambient', 'name_font', 'badge'));

ALTER TABLE chat.effects DROP CONSTRAINT effects_kind_chk;
ALTER TABLE chat.effects ADD CONSTRAINT effects_kind_chk
  CHECK (kind IN ('name', 'frame', 'entry', 'message', 'action', 'sticker', 'background', 'ambient', 'name_font', 'badge'));

-- Los objetos que se vendían como nombre conservan código, inventario y
-- vencimiento: pasan a ser placas. Quien los llevaba puestos los conserva
-- equipados en la ranura nueva. La sincronización del catálogo al arrancar
-- escribe después su manifiesto de placa.
UPDATE chat.effects SET kind = 'badge', updated_at = now()
WHERE code IN ('vinilo', 'cassette', 'ampli', 'cuernos', 'micro', 'corazon-rock', 'rockero',
               'guitarra', 'murcielago', 'bateria', 'ovni', 'vinilo-rodante', 'rockerito');
INSERT INTO chat.equipped (actor_id, slot, effect_id, updated_at)
SELECT q.actor_id, 'badge', q.effect_id, now()
FROM chat.equipped q JOIN chat.effects e ON e.id = q.effect_id
WHERE q.slot = 'name' AND e.kind = 'badge'
ON CONFLICT (actor_id, slot) DO NOTHING;
DELETE FROM chat.equipped q USING chat.effects e
WHERE e.id = q.effect_id AND q.slot = 'name' AND e.kind = 'badge';
COMMIT;
