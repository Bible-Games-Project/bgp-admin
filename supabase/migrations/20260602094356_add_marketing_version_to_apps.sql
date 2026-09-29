-- Add marketing_version field to apps table
-- This allows admins to set custom version numbers (e.g., "1.0", "2.0") for releases
-- If NULL, workflows will fall back to package.json version
-- IF NOT EXISTS: 20260602080632 already adds this column, so a fresh database
-- replaying every migration would otherwise fail here.

ALTER TABLE public.apps
ADD COLUMN IF NOT EXISTS marketing_version text;

COMMENT ON COLUMN public.apps.marketing_version IS 'User-friendly version number displayed in app stores (e.g., "1.0", "2.1"). If NULL, workflows use package.json version.';
