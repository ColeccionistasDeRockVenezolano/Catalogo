-- Revierte 0092. Exige retirar antes los runs que hayan añadido tiendas
-- (writePlatformLink(..., null)) para no perder enlaces al recuperar el CHECK.
BEGIN;
ALTER TABLE public.social_links DROP CONSTRAINT social_links_platform_ck;
ALTER TABLE public.social_links ADD CONSTRAINT social_links_platform_ck
  CHECK (platform IN ('instagram', 'facebook', 'x', 'tiktok', 'threads', 'bluesky', 'website'));
COMMIT;
