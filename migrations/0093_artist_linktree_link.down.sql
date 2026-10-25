-- Revierte 0093. Exige retirar antes los runs que hayan añadido linktrees.
BEGIN;
ALTER TABLE public.social_links DROP CONSTRAINT social_links_platform_ck;
ALTER TABLE public.social_links ADD CONSTRAINT social_links_platform_ck
  CHECK (platform IN ('instagram', 'facebook', 'x', 'tiktok', 'threads', 'bluesky', 'website', 'store'));
COMMIT;
