/**
 * Two kinds of app live in the console:
 *
 * - Web games the console builds from their GitHub repo (Capacitor, deploy
 *   workflow, preview, addons). They ship to both stores under one bundle ID,
 *   because Capacitor uses one app ID for iOS and Android.
 * - Games published outside the console (a Unity or RPG Maker game uploaded by
 *   hand, like The Lost Sheep). They have no repo here: the console only manages
 *   their store presence. Their IDs can differ per store, so bundle_id is their
 *   iOS bundle ID and android_package_name their Google Play package name.
 *
 * Any app can also be on Steam (steam_app_id).
 */

type RepoFields = { github_owner?: string | null; github_repo?: string | null };

type StoreFields = RepoFields & {
  bundle_id?: string | null;
  android_package_name?: string | null;
  steam_app_id?: number | null;
};

export function hasRepo<T extends RepoFields>(
  app: T,
): app is T & { github_owner: string; github_repo: string } {
  return Boolean(app.github_owner && app.github_repo);
}

export const NO_REPO_MESSAGE =
  "This app is published outside the console, so it has no GitHub repo to build or configure. Only its store listings are managed here.";

/** For server functions that act on the repo: fails clearly instead of calling GitHub with an empty repo. */
export function requireRepo<T extends RepoFields>(app: T) {
  if (!hasRepo(app)) throw new Error(NO_REPO_MESSAGE);
  return app;
}

export type AppStoreIds = {
  /** App Store Connect bundle ID. */
  ios: string | null;
  /** Google Play package name. */
  android: string | null;
  /** Steam App ID. */
  steam: number | null;
};

export function appStoreIds(app: StoreFields): AppStoreIds {
  const bundleId = app.bundle_id?.trim() || null;
  return {
    ios: bundleId,
    android: app.android_package_name?.trim() || (hasRepo(app) ? bundleId : null),
    steam: app.steam_app_id ?? null,
  };
}

export function isOnAnyStore(ids: AppStoreIds) {
  return Boolean(ids.ios || ids.android || ids.steam);
}

export function steamStoreUrl(appId: number) {
  return `https://store.steampowered.com/app/${appId}`;
}

export function playStoreUrl(packageName: string) {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;
}
