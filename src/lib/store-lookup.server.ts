import { createAscApi, findAscApp } from "./asc.server";
import { PlayError, createPlayApi, withEdit } from "./google-play.server";
import { fetchSteamItem, steamIconUrl } from "./steam.server";

/**
 * Checks a store ID before an app published outside the console is registered,
 * so a typo is caught at once instead of surfacing later as an empty Store tab.
 *
 * - An ID the store doesn't know throws, with where to copy the right one from.
 * - A store the console can't check (no credentials, or no permission on that
 *   app yet) returns a warning instead: the Store tab explains how to fix it,
 *   and the app can be registered meanwhile.
 */
export type StoreCheck = { name: string | null; iconUrl: string | null; warning?: string };

export async function checkAppStore(bundleId: string): Promise<StoreCheck> {
  const api = await createAscApi();
  if (!api) {
    return {
      name: null,
      iconUrl: null,
      warning: "App Store Connect is not connected to this console, so the bundle ID was not checked.",
    };
  }
  const app = await findAscApp(api, bundleId);
  if (!app) {
    throw new Error(
      `App Store Connect has no app with the bundle ID ${bundleId}. Copy it from App Store Connect → the app → General → App Information → Bundle ID.`,
    );
  }
  return { name: app.attributes?.name ?? null, iconUrl: await appStoreIconUrl(bundleId) };
}

/** The public iTunes lookup has the icon of any app that is live on the App Store. */
async function appStoreIconUrl(bundleId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=es`,
    );
    const json: any = await res.json();
    const url: string | undefined = json.results?.[0]?.artworkUrl512 ?? json.results?.[0]?.artworkUrl100;
    return url ? url.replace(/\/\d+x\d+bb\./, "/256x256bb.") : null;
  } catch {
    return null;
  }
}

export async function checkGooglePlay(packageName: string): Promise<StoreCheck> {
  const api = await createPlayApi(packageName);
  if (!api) {
    return {
      name: null,
      iconUrl: null,
      warning: "Google Play is not connected to this console, so the package name was not checked.",
    };
  }
  try {
    const { result } = await withEdit(
      api,
      async (edit) => {
        const details = await api.call("GET", `${edit}/details`);
        const language: string | undefined = details.defaultLanguage;
        if (!language) return { name: null, iconUrl: null };
        const [listing, icons] = await Promise.all([
          api.call("GET", `${edit}/listings/${language}`).catch(() => null),
          api.call("GET", `${edit}/listings/${language}/icon`).catch(() => null),
        ]);
        return {
          name: (listing?.title as string | undefined) || null,
          iconUrl: (icons?.images?.[0]?.url as string | undefined) ?? null,
        };
      },
      { commit: false },
    );
    return result;
  } catch (err) {
    if (err instanceof PlayError && err.status === 404) {
      throw new Error(
        `Google Play has no app with the package name ${packageName}. Copy it from Play Console → the app → the line under its name.`,
      );
    }
    if (err instanceof PlayError && (err.status === 401 || err.status === 403)) {
      return {
        name: null,
        iconUrl: null,
        warning: `The console can't see ${packageName} on Google Play yet. In Play Console → Users and permissions → ${api.serviceAccountEmail} → App permissions → Add app, pick it and tick the same permissions as the other games.`,
      };
    }
    throw err;
  }
}

export async function checkSteam(appId: number): Promise<StoreCheck> {
  const item = await fetchSteamItem(appId);
  if (!item) {
    throw new Error(
      `Steam has no public store page with the App ID ${appId}. It is the number in the game's store address: store.steampowered.com/app/<number>.`,
    );
  }
  return { name: item.name || null, iconUrl: steamIconUrl(item) };
}

/** Downloads a store icon and inlines it, the form the apps list stores icons in. */
export async function iconAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    // Store icons are a few KB to ~100 KB; anything far bigger is not an icon.
    if (bytes.length > 400_000) return null;
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
