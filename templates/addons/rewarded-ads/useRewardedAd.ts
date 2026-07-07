import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";

// ─── Managed by bgp-admin — do not edit by hand ──────────────────────────────
export const AD_UNIT_ID_IOS = "__ADMOB_REWARDED_AD_UNIT_ID_IOS__";
export const AD_UNIT_ID_ANDROID = "__ADMOB_REWARDED_AD_UNIT_ID_ANDROID__";
// Set to true while testing on device: Google serves fake test ads so your
// AdMob account is not flagged for invalid clicks.
export const IS_TESTING = false;
// ──────────────────────────────────────────────────────────────────────────────

const TEST_AD_UNIT_ID_IOS = "ca-app-pub-3940256099942544/1712485313";
const TEST_AD_UNIT_ID_ANDROID = "ca-app-pub-3940256099942544/5224354917";

function getAdUnitId(): string {
  if (Capacitor.getPlatform() === "ios") {
    return IS_TESTING ? TEST_AD_UNIT_ID_IOS : AD_UNIT_ID_IOS;
  }
  return IS_TESTING ? TEST_AD_UNIT_ID_ANDROID : AD_UNIT_ID_ANDROID;
}

export interface RewardedAdState {
  /** True when an ad is loaded and ready to show. */
  isReady: boolean;
  /** True while an ad is being loaded or shown. */
  isLoading: boolean;
  /**
   * Shows a full rewarded video ad. The user must watch it to the end.
   * `onReward` fires only if the user finished watching; if they close the ad
   * early, it is not called. On the web (no native platform), `onReward` is
   * called immediately so the app remains playable in the browser.
   */
  showAd: (onReward: () => void) => Promise<void>;
}

export function useRewardedAd(): RewardedAdState {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const onRewardRef = useRef<(() => void) | null>(null);
  const rewardEarnedRef = useRef(false);

  const prepare = useCallback(async () => {
    try {
      const { AdMob } = await import("@capacitor-community/admob");
      await AdMob.prepareRewardVideoAd({ adId: getAdUnitId() });
      setIsReady(true);
    } catch (e) {
      console.warn("[Ads] Failed to load rewarded ad:", e);
      setIsReady(false);
    }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    const listeners: { remove: () => Promise<void> }[] = [];

    void (async () => {
      try {
        const { AdMob, RewardAdPluginEvents } = await import("@capacitor-community/admob");

        try {
          await AdMob.requestTrackingAuthorization();
        } catch {
          // Tracking authorization is iOS-only; ignore elsewhere.
        }
        await AdMob.initialize();
        if (cancelled) return;

        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
            rewardEarnedRef.current = true;
          }),
        );
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
            if (rewardEarnedRef.current) {
              rewardEarnedRef.current = false;
              onRewardRef.current?.();
            }
            onRewardRef.current = null;
            setIsLoading(false);
            setIsReady(false);
            void prepare(); // preload the next ad
          }),
        );
        listeners.push(
          await AdMob.addListener(RewardAdPluginEvents.FailedToLoad, (e) => {
            console.warn("[Ads] Rewarded ad failed to load:", e);
            setIsReady(false);
            setIsLoading(false);
          }),
        );

        await prepare();
      } catch (e) {
        console.warn("[Ads] Initialisation failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      for (const l of listeners) void l.remove();
    };
  }, [prepare]);

  const showAd = useCallback(
    async (onReward: () => void) => {
      if (!Capacitor.isNativePlatform()) {
        // In the browser there are no native ads — grant the reward directly.
        onReward();
        return;
      }
      setIsLoading(true);
      try {
        const { AdMob } = await import("@capacitor-community/admob");
        onRewardRef.current = onReward;
        rewardEarnedRef.current = false;
        if (!isReady) await AdMob.prepareRewardVideoAd({ adId: getAdUnitId() });
        await AdMob.showRewardVideoAd();
      } catch (e) {
        console.error("[Ads] Failed to show rewarded ad:", e);
        onRewardRef.current = null;
        setIsLoading(false);
        void prepare();
      }
    },
    [isReady, prepare],
  );

  return { isReady, isLoading, showAd };
}
