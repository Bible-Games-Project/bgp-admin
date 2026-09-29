import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AppStoreListingPanel } from "@/components/AppStoreListingPanel";
import { PlayListingPanel } from "@/components/PlayListingPanel";
import { Notice } from "@/components/StoreListingParts";

export function StoreListingTab({
  appId,
  bundleId,
}: {
  appId: string;
  bundleId: string | null | undefined;
}) {
  const [store, setStore] = useState<"ios" | "play">("ios");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Store Listing</h2>
        <p className="text-sm text-muted-foreground">
          What players see on the App Store and Google Play — name, description, languages and
          screenshots — read live from each store. Edits here are saved straight back to it.
        </p>
      </div>

      {!bundleId ? (
        <Notice tone="warn" title="This app has no bundle ID yet.">
          The stores find the app by its bundle ID. Set it in the General tab first.
        </Notice>
      ) : (
        <>
          <ToggleGroup
            type="single"
            variant="outline"
            value={store}
            onValueChange={(v) => v && setStore(v as "ios" | "play")}
            className="justify-start"
          >
            <ToggleGroupItem value="ios">App Store</ToggleGroupItem>
            <ToggleGroupItem value="play">Google Play</ToggleGroupItem>
          </ToggleGroup>
          {store === "ios" ? (
            <AppStoreListingPanel appId={appId} />
          ) : (
            <PlayListingPanel appId={appId} />
          )}
        </>
      )}
    </div>
  );
}
