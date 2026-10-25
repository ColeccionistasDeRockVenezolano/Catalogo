-- Brian (2026-10-19): el linktree del artista es una página que se guarda en el perfil,
-- no solo una fuente de la que sacar enlaces. Se añade `linktree` al CHECK de
-- `social_links`; el handle es el usuario de linktr.ee.
BEGIN;
ALTER TABLE public.social_links DROP CONSTRAINT social_links_platform_ck;
ALTER TABLE public.social_links ADD CONSTRAINT social_links_platform_ck
  CHECK (platform IN ('instagram', 'facebook', 'x', 'tiktok', 'threads', 'bluesky', 'website', 'store', 'linktree'));
COMMIT;
