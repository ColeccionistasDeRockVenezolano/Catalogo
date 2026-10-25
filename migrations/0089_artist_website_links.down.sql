BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.social_links WHERE platform='website') THEN
    RAISE EXCEPTION 'Hay webs registradas: revertir sus runs antes de retirar website.';
  END IF;
END $$;
ALTER TABLE public.social_links DROP CONSTRAINT social_links_platform_ck;
ALTER TABLE public.social_links ADD CONSTRAINT social_links_platform_ck
  CHECK (platform IN ('instagram', 'facebook', 'x', 'tiktok', 'threads', 'bluesky'));
COMMIT;
