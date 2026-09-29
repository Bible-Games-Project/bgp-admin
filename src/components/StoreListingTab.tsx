import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AppStoreListingPanel } from "@/components/AppStoreListingPanel";
import { PlayListingPanel } from "@/components/PlayListingPanel";
import { SteamListingPanel } from "@/components/SteamListingPanel";
import { Notice } from "@/components/StoreListingParts";
import type { AppStoreIds } from "@/lib/app-kind";

type StoreKey = "ios" | "play" | "steam";

export function StoreListingTab({
  appId,
  storeIds,
  external,
}: {
  appId: string;
  storeIds: AppStoreIds;
  /** Not a web game: its store IDs are set one by one in the General tab. */
  external: boolean;
}) {
  const stores: { key: StoreKey; label: string }[] = [
    ...(storeIds.ios ? [{ key: "ios" as const, label: "App Store" }] : []),
    ...(storeIds.android ? [{ key: "play" as const, label: "Google Play" }] : []),
    ...(storeIds.steam ? [{ key: "steam" as const, label: "Steam" }] : []),
  ];
  const [picked, setPicked] = useState<StoreKey | null>(null);
  const store = stores.find((s) => s.key === picked)?.key ?? stores[0]?.key;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Store Listing</h2>
        <p className="text-sm text-muted-foreground">
          What players see on each store — name, description, languages and screenshots — read
          live from it. App Store and Google Play edits are saved straight back; a Steam page can
          only be changed on Steamworks, which the Steam view links to.
        </p>
      </div>

      {!store ? (
        external ? (
          <Notice tone="warn" title="This game has no store ID yet.">
            Add its App Store bundle ID, Google Play package name or Steam App ID in the General
            tab.
          </Notice>
        ) : (
          <Notice tone="warn" title="This app has no bundle ID yet.">
            The stores find the app by its bundle ID. Set it in the General tab first.
          </Notice>
        )
      ) : (
        <>
          {stores.length > 1 && (
            <ToggleGroup
              type="single"
              variant="outline"
              value={store}
              onValueChange={(v) => v && setPicked(v as StoreKey)}
              className="justify-start"
            >
              {stores.map((s) => (
                <ToggleGroupItem key={s.key} value={s.key}>
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          {/* All stay mounted, so switching store never drops unsaved edits. */}
          {storeIds.ios && (
            <div hidden={store !== "ios"}>
              <AppStoreListingPanel appId={appId} />
            </div>
          )}
          {storeIds.android && (
            <div hidden={store !== "play"}>
              <PlayListingPanel appId={appId} />
            </div>
          )}
          {storeIds.steam && (
            <div hidden={store !== "steam"}>
              <SteamListingPanel appId={appId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
