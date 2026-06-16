ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS bundle_id text;
CREATE UNIQUE INDEX IF NOT EXISTS apps_bundle_id_key ON public.apps (bundle_id) WHERE bundle_id IS NOT NULL;