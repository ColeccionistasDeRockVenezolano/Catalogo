BEGIN;
-- La sala tiene vida propia: fondo y ambiente por defecto, sin depender de que
-- alguien los lleve equipados. Un usuario puede sustituirlos con los suyos.
UPDATE chat.rooms
SET theme = theme || '{"background":"escenario","ambient":"brasas"}'::jsonb
WHERE slug = 'general';
COMMIT;
