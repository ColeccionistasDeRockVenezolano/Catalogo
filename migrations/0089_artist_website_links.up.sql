-- Brian (2026-10-18): añadir la web del artista al final de «Síguelo/Síguelos».
-- Reutiliza social_links y su historial reversible, con una URL por artista.
BEGIN;
ALTER TABLE public.social_links DROP CONSTRAINT social_links_platform_ck;
ALTER TABLE public.social_links ADD CONSTRAINT social_links_platform_ck
  CHECK (platform IN ('instagram', 'facebook', 'x', 'tiktok', 'threads', 'bluesky', 'website'));
COMMIT;
