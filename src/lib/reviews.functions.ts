import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { appStoreIds, type AppStoreIds } from "@/lib/app-kind";
import { REPLY_LIMITS, STOREFRONTS_PER_CALL, type StoreReviews } from "./reviews";
import { charCount } from "./store-listing";
import {
  deleteAppStoreReply,
  lookupAppStoreRatings,
  readAppStoreReviews,
  readGooglePlayReviews,
  readSteamReviews,
  replyOnAppStore,
  replyOnGooglePlay,
} from "./reviews.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

async function loadStoreIds(supabase: any, appId: string): Promise<AppStoreIds> {
  const { data, error } = await supabase.from("apps").select("*").eq("id", appId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  return appStoreIds(data);
}

const byApp = z.object({ appId: z.string().uuid() });

/** A game with no ID for a store isn't on it; that is no problem to report. */
const notOnStore = (store: StoreReviews["store"]): StoreReviews => ({
  store,
  found: false,
  reviews: [],
});

export const getAppStoreReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => byApp.parse(input))
  .handler(async ({ data, context }): Promise<StoreReviews> => {
    await assertAdmin(context.supabase, context.userId);
    const { ios } = await loadStoreIds(context.supabase, data.appId);
    return ios ? readAppStoreReviews(ios) : notOnStore("app_store");
  });

export const getGooglePlayReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => byApp.parse(input))
  .handler(async ({ data, context }): Promise<StoreReviews> => {
    await assertAdmin(context.supabase, context.userId);
    const { android } = await loadStoreIds(context.supabase, data.appId);
    return android ? readGooglePlayReviews(android) : notOnStore("google_play");
  });

export const getSteamReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => byApp.parse(input))
  .handler(async ({ data, context }): Promise<StoreReviews> => {
    await assertAdmin(context.supabase, context.userId);
    const { steam } = await loadStoreIds(context.supabase, data.appId);
    return steam ? readSteamReviews(steam) : notOnStore("steam");
  });

/** Public App Store ratings of some storefronts, for several games at once. */
export const getAppStoreRatings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        bundleIds: z.array(z.string().min(1).max(200)).min(1).max(50),
        countries: z
          .array(z.string().regex(/^[a-z]{2}$/))
          .min(1)
          .max(STOREFRONTS_PER_CALL),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return lookupAppStoreRatings(data.bundleIds, data.countries);
  });

export const replyToReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        store: z.enum(["app_store", "google_play"]),
        reviewId: z.string().min(1).max(200),
        text: z.string().trim().min(1, "Write the reply first"),
      })
      .refine((v) => charCount(v.text) <= REPLY_LIMITS[v.store], {
        message: "The reply is longer than the store allows",
        path: ["text"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const ids = await loadStoreIds(context.supabase, data.appId);
    if (data.store === "app_store") {
      if (!ids.ios) throw new Error("This game has no App Store bundle ID.");
      return replyOnAppStore(data.reviewId, data.text);
    }
    if (!ids.android) throw new Error("This game has no Google Play package name.");
    return replyOnGooglePlay(ids.android, data.reviewId, data.text);
  });

/** Google Play has no way to delete a reply from other tools, so only the App Store's. */
export const deleteReviewReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ replyId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await deleteAppStoreReply(data.replyId);
    return { ok: true };
  });
