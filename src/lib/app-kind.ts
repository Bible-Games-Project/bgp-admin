/**
 * Two kinds of game live in the console:
 *
 * - Web games, which the console builds and deploys from their GitHub repo
 *   (Capacitor, deploy workflow, preview, addons). They ship to both stores under
 *   one bundle ID, because Capacitor uses one app ID for iOS and Android.
 * - Games made with another engine (Unity, RPG Maker…, like The Lost Sheep).
 *   Their code lives in repos of its own, but they are built and uploaded with
 *   their own tools, so the console keeps no repo for them (github_repo is null)
 *   and only manages their store pages. Their IDs can differ per store, so
 *   bundle_id is their iOS bundle ID and android_package_name their Google Play
 *   package name.
 *
 * Any game can also be on Steam (steam_app_id).
 */

type RepoFields = { github_owner?: string | null; github_repo?: string | null };

type StoreFields = RepoFields & {
  bundle_id?: string | null;
  android_package_name?: string | null;
  steam_app_id?: number | null;
};

/** A web game: the console builds and deploys it from this repo. */
export function isWebGame<T extends RepoFields>(
  app: T,
): app is T & { github_owner: string; github_repo: string } {
  return Boolean(app.github_owner && app.github_repo);
}

export const NOT_A_WEB_GAME_MESSAGE =
  "This isn't a web game, so the console doesn't build or configure it. Only its store pages are managed here.";

/** For server functions that act on a web game's repo: fails clearly instead of calling GitHub with no repo. */
export function requireWebGame<T extends RepoFields>(app: T) {
  if (!isWebGame(app)) throw new Error(NOT_A_WEB_GAME_MESSAGE);
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
    android: app.android_package_name?.trim() || (isWebGame(app) ? bundleId : null),
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
