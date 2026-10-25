-- Brian (2026-10-19): tienda oficial del artista (merch, Bandcamp merch, Shopify,
-- Big Cartel) como enlace propio de «Síguelo/Síguelos». No se usa `website`
-- porque esa plataforma es la web oficial y admite una sola URL por artista;
-- una tienda es otra cosa y puede convivir con la web.
BEGIN;
ALTER TABLE public.social_links DROP CONSTRAINT social_links_platform_ck;
ALTER TABLE public.social_links ADD CONSTRAINT social_links_platform_ck
  CHECK (platform IN ('instagram', 'facebook', 'x', 'tiktok', 'threads', 'bluesky', 'website', 'store'));
COMMIT;
