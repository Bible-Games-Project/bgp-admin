-- Apps published outside this console (a Unity or RPG Maker game, say) have no
-- GitHub repo for the console to build from: it only manages their store
-- presence. Their repo columns stay empty.
ALTER TABLE public.apps
  ALTER COLUMN github_owner DROP NOT NULL,
  ALTER COLUMN github_repo DROP NOT NULL;

ALTER TABLE public.apps
  ADD CONSTRAINT apps_repo_owner_and_name_together
  CHECK ((github_owner IS NULL) = (github_repo IS NULL));

-- An app built from a repo ships to both stores under bundle_id, because
-- Capacitor uses one app ID for iOS and Android. An app published elsewhere can
-- have a different ID on each store: for those, bundle_id is the iOS bundle ID
-- and this column is the Google Play package name.
ALTER TABLE public.apps ADD COLUMN android_package_name text;
CREATE UNIQUE INDEX apps_android_package_name_key
  ON public.apps (android_package_name) WHERE android_package_name IS NOT NULL;
COMMENT ON COLUMN public.apps.android_package_name IS
  'Google Play package name when the app has no repo (bundle_id is then iOS only).';

-- Steam App ID (the number in store.steampowered.com/app/<id>). Steam IDs are
-- unsigned 32-bit, so they need bigint.
ALTER TABLE public.apps ADD COLUMN steam_app_id bigint;
ALTER TABLE public.apps
  ADD CONSTRAINT apps_steam_app_id_positive CHECK (steam_app_id > 0);
CREATE UNIQUE INDEX apps_steam_app_id_key
  ON public.apps (steam_app_id) WHERE steam_app_id IS NOT NULL;
COMMENT ON COLUMN public.apps.steam_app_id IS 'Steam App ID, if the game is on Steam.';

-- Every app is either built from a repo or published on at least one store.
ALTER TABLE public.apps
  ADD CONSTRAINT apps_repo_or_store
  CHECK (
    github_repo IS NOT NULL
    OR bundle_id IS NOT NULL
    OR android_package_name IS NOT NULL
    OR steam_app_id IS NOT NULL
  );
