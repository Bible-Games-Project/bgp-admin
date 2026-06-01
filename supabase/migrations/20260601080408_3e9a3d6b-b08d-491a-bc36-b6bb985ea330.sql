ALTER TABLE public.apps
  DROP COLUMN IF EXISTS ios_bundle_id,
  DROP COLUMN IF EXISTS ios_workflow_file,
  DROP COLUMN IF EXISTS android_workflow_file,
  DROP COLUMN IF EXISTS android_play_track,
  DROP COLUMN IF EXISTS android_package_name;