BEGIN;
UPDATE chat.rooms
SET theme = theme - 'background' - 'ambient'
WHERE slug = 'general';
COMMIT;
