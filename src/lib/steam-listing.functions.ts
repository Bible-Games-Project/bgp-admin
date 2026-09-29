import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { appStoreIds, steamStoreUrl } from "@/lib/app-kind";
import {
  STEAM_LANGUAGE_NAMES,
  describeSteamItem,
  fetchSteamItem,
  type SteamPage,
} from "@/lib/steam.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

export type SteamListing = Partial<SteamPage> & {
  appId: number;
  storeUrl: string;
  /** Edit Store Page on Steamworks, where every change to the page is made. */
  steamworksUrl: string;
  error?: string;
  /** Steam has no public store page with this App ID. */
  notFound?: boolean;
};

async function loadSteamAppId(supabase: any, appId: string): Promise<number> {
  const { data, error } = await supabase.from("apps").select("*").eq("id", appId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  const steam = appStoreIds(data).steam;
  if (!steam) throw new Error("This app has no Steam App ID. Add it in the General tab.");
  return steam;
}

export const getSteamListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        language: z.enum(STEAM_LANGUAGE_NAMES as [string, ...string[]]).default("english"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SteamListing> => {
    await assertAdmin(context.supabase, context.userId);
    const steamAppId = await loadSteamAppId(context.supabase, data.appId);
    const base = {
      appId: steamAppId,
      storeUrl: steamStoreUrl(steamAppId),
      steamworksUrl: `https://partner.steamgames.com/admin/game/edit/${steamAppId}`,
    };

    try {
      // Everything but the texts is read in English, the console's language.
      const item = await fetchSteamItem(steamAppId, "english");
      if (!item) {
        return {
          ...base,
          notFound: true,
          error: `Steam has no public store page with the App ID ${steamAppId}. Check the number in the store address (store.steampowered.com/app/<number>).`,
        };
      }
      const localized =
        data.language === "english" ? item : ((await fetchSteamItem(steamAppId, data.language)) ?? item);
      return { ...base, ...describeSteamItem(item, localized, data.language) };
    } catch (err) {
      return { ...base, error: (err as Error)?.message ?? "Could not reach Steam." };
    }
  });
