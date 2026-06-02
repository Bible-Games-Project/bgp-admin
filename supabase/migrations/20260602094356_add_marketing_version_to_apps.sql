-- Add marketing_version field to apps table
-- This allows admins to set custom version numbers (e.g., "1.0", "2.0") for releases
-- If NULL, workflows will fall back to package.json version

ALTER TABLE public.apps
ADD COLUMN marketing_version text;

COMMENT ON COLUMN public.apps.marketing_version IS 'User-friendly version number displayed in app stores (e.g., "1.0", "2.1"). If NULL, workflows use package.json version.';
